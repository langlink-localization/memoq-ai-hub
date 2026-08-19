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

function createRuntimeProviderExecution(options = {}) {
  const rescueConcurrency = Number.isFinite(Number(options.rescueConcurrency))
    ? Math.max(1, Math.floor(Number(options.rescueConcurrency)))
    : 2;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const providerSlots = new Map();
  const providerRateLimits = new Map();
  const throughputStats = new Map();

  function getRouteKey(route, slotKind = '') {
    const baseKey = `${String(route?.provider?.id || '')}:${String(route?.model?.id || route?.model?.modelName || '')}`;
    return slotKind ? `${baseKey}:${slotKind}` : baseKey;
  }

  function getThroughputRecorder(route) {
    const routeKey = getRouteKey(route);
    let recorder = throughputStats.get(routeKey);
    if (!recorder) {
      recorder = createThroughputStatsRecorder(24);
      throughputStats.set(routeKey, recorder);
    }
    return recorder;
  }

  function getThroughputStats(route) {
    return getThroughputRecorder(route).snapshot();
  }

  function recordThroughputAttempts(route, attempts = []) {
    getThroughputRecorder(route).record(attempts);
  }

  function getThroughputSettings(route) {
    return resolveThroughputSettings(route, getThroughputStats(route));
  }

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

  function getRetryAttempts(route, isBatch = false) {
    if (route?.model?.retryEnabled === false) return 0;
    const configured = Number(route?.model?.retryAttempts);
    const fallback = isBatch ? 0 : 2;
    const budget = Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : fallback;
    return Math.min(isBatch ? 1 : 2, budget);
  }

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

  async function run({ route, isBatch = false, rescue = false, execute }) {
    const maxRetries = getRetryAttempts(route, isBatch);
    let retryCount = 0;
    let totalQueuedMs = 0;
    let totalRateLimitedWaitMs = 0;
    let retryAfterSeconds = null;

    while (true) {
      try {
        const result = await withProviderRateLimit(route, async (rateLimitedWaitMs) => {
          totalRateLimitedWaitMs += rateLimitedWaitMs;
          return withProviderSlot(route, async (queuedMs) => {
            totalQueuedMs += queuedMs;
            return execute({ retryCount, queuedMs, totalQueuedMs, rateLimitedWaitMs, totalRateLimitedWaitMs, retryAfterSeconds });
          }, { rescue });
        });
        return { ...result, retryCount, queuedMs: totalQueuedMs, rateLimitedWaitMs: totalRateLimitedWaitMs, retryAfterSeconds };
      } catch (error) {
        if (error instanceof PromptTemplateError) throw error;
        const mapped = error?.mappedError || mapProviderError(error);
        retryAfterSeconds = normalizeRetryAfterSeconds(mapped?.retryAfterSeconds)
          ?? extractRetryAfterSeconds(mapped?.message || error?.message || '');
        if (retryCount >= maxRetries || !shouldRetryProviderError(mapped)) {
          const finalError = new Error(mapped.message);
          finalError.mappedError = mapped;
          finalError.retryCount = retryCount;
          finalError.queuedMs = totalQueuedMs;
          finalError.rateLimitedWaitMs = totalRateLimitedWaitMs;
          finalError.retryAfterSeconds = retryAfterSeconds;
          throw finalError;
        }
        retryCount += 1;
        await sleep(computeRetryDelayMs(mapped, retryCount));
      }
    }
  }

  return { getThroughputSettings, getThroughputStats, recordThroughputAttempts, run };
}

module.exports = { createRuntimeProviderExecution };
