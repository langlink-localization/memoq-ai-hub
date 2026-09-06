'use strict';

const { PromptTemplateError } = require('../shared/promptTemplate');
const { mapProviderError } = require('../provider/providerRegistry');
const {
  computeRetryDelayMs,
  createRateLimiter,
  createSemaphore,
  extractRetryAfterSeconds,
  normalizeRetryAfterSeconds,
  parseRateLimitHint,
  shouldRetryProviderError
} = require('../provider/providerGovernance');
const {
  createThroughputStatsRecorder,
  resolveThroughputSettings
} = require('./runtimeThroughput');

/**
 * @param {any} options
 */
function createRuntimeProviderExecution(options = {}) {
  const rescueConcurrency = Number.isFinite(Number(options.rescueConcurrency))
    ? Math.max(1, Math.floor(Number(options.rescueConcurrency)))
    : 2;
  const sleep = options.sleep || ((/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const providerSlots = new Map();
  const providerRateLimits = new Map();
  const throughputStats = new Map();

  /**
   * @param {any} route
   * @param {any} slotKind
   */
  function getRouteKey(route, slotKind = '') {
    const baseKey = `${String(route?.provider?.id || '')}:${String(route?.model?.id || route?.model?.modelName || '')}`;
    return slotKind ? `${baseKey}:${slotKind}` : baseKey;
  }

  /**
   * @param {any} route
   */
  function getThroughputRecorder(route) {
    const routeKey = getRouteKey(route);
    let recorder = throughputStats.get(routeKey);
    if (!recorder) {
      recorder = createThroughputStatsRecorder(24);
      throughputStats.set(routeKey, recorder);
    }
    return recorder;
  }

  /**
   * @param {any} route
   */
  function getThroughputStats(route) {
    return getThroughputRecorder(route).snapshot();
  }

  /**
   * @param {any} route
   * @param {any} attempts
   */
  function recordThroughputAttempts(route, attempts = []) {
    getThroughputRecorder(route).record(attempts);
  }

  /**
   * @param {any} route
   */
  function getThroughputSettings(route) {
    return resolveThroughputSettings(route, getThroughputStats(route));
  }

  /**
   * @param {any} route
   */
  function getConcurrencyLimit(route) {
    const throughput = getThroughputSettings(route);
    if (Number.isFinite(Number(throughput.providerConcurrency)) && Number(throughput.providerConcurrency) > 0) {
      const throughputLimit = Math.max(1, Math.floor(Number(throughput.providerConcurrency)));
      const parsed = parseRateLimitHint(route?.model?.rateLimitHint || '');
      return parsed.raw
        ? Math.max(1, Math.min(throughputLimit, parsed.recommendedConcurrency || throughputLimit))
        : throughputLimit;
    }

    const explicitLimit = Number(route?.model?.concurrencyLimit);
    if (Number.isFinite(explicitLimit) && explicitLimit > 0) {
      return Math.max(1, Math.floor(explicitLimit));
    }

    const parsed = parseRateLimitHint(route?.model?.rateLimitHint || '');
    return Math.max(1, parsed.recommendedConcurrency || 1);
  }

  /**
   * @param {any} route
   */
  function getRateLimiterConfig(route) {
    const parsed = parseRateLimitHint(route?.model?.rateLimitHint || '');
    if (parsed.requestsPerSecond && parsed.requestsPerSecond > 0) {
      return { requestsPerWindow: Math.max(1, Math.floor(parsed.requestsPerSecond)), windowMs: 1000, smoothness: 1 };
    }
    if (parsed.requestsPerMinute && parsed.requestsPerMinute > 0) {
      return { requestsPerWindow: Math.max(1, Math.floor(parsed.requestsPerMinute)), windowMs: 60000, smoothness: 1 };
    }
    return null;
  }

  /**
   * @param {any} route
   * @param {any} isBatch
   */
  function getRetryAttempts(route, isBatch = false) {
    if (route?.model?.retryEnabled === false) return 0;
    const configured = Number(route?.model?.retryAttempts);
    const fallback = isBatch ? 0 : 2;
    const budget = Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : fallback;
    return Math.min(isBatch ? 1 : 2, budget);
  }

  /**
   * @param {any} route
   * @param {any} operation
   * @param {any} executionOptions
   */
  async function withProviderSlot(route, operation, executionOptions = {}) {
    const slotKind = executionOptions.rescue === true ? 'rescue' : '';
    const routeKey = getRouteKey(route, slotKind);
    const concurrencyLimit = slotKind === 'rescue' ? rescueConcurrency : getConcurrencyLimit(route);
    let semaphore = providerSlots.get(routeKey);
    if (!semaphore || semaphore.limit !== concurrencyLimit) {
      semaphore = { limit: concurrencyLimit, gate: createSemaphore(concurrencyLimit) };
      providerSlots.set(routeKey, semaphore);
    }
    const slot = await semaphore.gate.acquire();
    try {
      return await operation(slot.queuedMs);
    } finally {
      slot.release();
    }
  }

  /**
   * @param {any} route
   * @param {any} operation
   */
  async function withProviderRateLimit(route, operation) {
    const routeKey = getRouteKey(route);
    const limiterConfig = getRateLimiterConfig(route);
    if (!limiterConfig) return operation(0);
    const configKey = JSON.stringify(limiterConfig);
    let limiter = providerRateLimits.get(routeKey);
    if (!limiter || limiter.configKey !== configKey) {
      limiter = { configKey, gate: createRateLimiter(limiterConfig) };
      providerRateLimits.set(routeKey, limiter);
    }
    const acquisition = await limiter.gate.acquire();
    return operation(acquisition.rateLimitedWaitMs || 0);
  }

  /**
   * @param {any} _
   */
  async function run({ route, isBatch = false, rescue = false, execute }) {
    const maxRetries = getRetryAttempts(route, isBatch);
    let retryCount = 0;
    let totalQueuedMs = 0;
    let totalRateLimitedWaitMs = 0;
    /** @type {number | null} */
    let retryAfterSeconds = null;

    while (true) {
      try {
        const result = await withProviderRateLimit(route, async (/** @type {number} */ rateLimitedWaitMs) => {
          totalRateLimitedWaitMs += rateLimitedWaitMs;
          return withProviderSlot(route, async (/** @type {number} */ queuedMs) => {
            totalQueuedMs += queuedMs;
            return execute({ retryCount, queuedMs, totalQueuedMs, rateLimitedWaitMs, totalRateLimitedWaitMs, retryAfterSeconds });
          }, { rescue });
        });
        return { ...result, retryCount, queuedMs: totalQueuedMs, rateLimitedWaitMs: totalRateLimitedWaitMs, retryAfterSeconds };
      } catch (/** @type {any} */ error) {
        if (error instanceof PromptTemplateError) throw error;
        const mapped = error?.mappedError || mapProviderError(error);
        retryAfterSeconds = normalizeRetryAfterSeconds(mapped?.retryAfterSeconds)
          ?? extractRetryAfterSeconds(mapped?.message || error?.message || '');
        if (retryCount >= maxRetries || !shouldRetryProviderError(mapped)) {
          throw Object.assign(new Error(mapped.message), {
            mappedError: mapped,
            retryCount,
            queuedMs: totalQueuedMs,
            rateLimitedWaitMs: totalRateLimitedWaitMs,
            retryAfterSeconds
          });
        }
        retryCount += 1;
        await sleep(computeRetryDelayMs(mapped, retryCount));
      }
    }
  }

  return { getThroughputSettings, getThroughputStats, recordThroughputAttempts, run };
}

module.exports = { createRuntimeProviderExecution };
