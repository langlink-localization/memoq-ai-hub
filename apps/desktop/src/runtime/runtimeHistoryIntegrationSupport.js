const {
  buildHistorySummary
} = require('./runtimeHistoryBuilder');
const {
  hasHistoryFallback,
  SLOW_HISTORY_LATENCY_MS
} = require('./runtimeHistory');
const {
  ensureIntegrationPreferences
} = require('./runtimeState');

/**
 * @param {any[]} historyEntries
 * @param {unknown} providerId
 * @returns {Record<string, any>}
 */
function buildHistoryMetrics(historyEntries, providerId) {
  const threshold = Date.now() - (24 * 60 * 60 * 1000);
  const scoped = historyEntries.filter((entry) => (
    entry.providerId === providerId
    && entry.completedAt
    && new Date(entry.completedAt).getTime() >= threshold
  ));
  if (!scoped.length) {
    return {
      successRate24h: null,
      avgLatencyMs: null,
      timeoutCount24h: 0,
      rateLimitCount24h: 0,
      exactCacheHitCount24h: 0,
      adaptiveCacheHitCount24h: 0,
      batchFallbackCount24h: 0
    };
  }
  const successes = scoped.filter((entry) => entry.status === 'success').length;
  const latencies = scoped.map((entry) => Number(entry.latencyMs)).filter((value) => Number.isFinite(value));
  const attempts = scoped.flatMap((entry) => (Array.isArray(entry.attempts) ? entry.attempts : []));
  return {
    successRate24h: Number(((successes / scoped.length) * 100).toFixed(1)),
    avgLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
    timeoutCount24h: attempts.filter((attempt) => String(attempt?.errorCode || '').trim().toUpperCase() === 'PROVIDER_TIMEOUT').length,
    rateLimitCount24h: attempts.filter((attempt) => String(attempt?.errorCode || '').trim().toUpperCase() === 'PROVIDER_RATE_LIMITED').length,
    exactCacheHitCount24h: attempts.filter((attempt) => String(attempt?.cacheKind || '').trim().toLowerCase() === 'exact').length,
    adaptiveCacheHitCount24h: attempts.filter((attempt) => String(attempt?.cacheKind || '').trim().toLowerCase() === 'adaptive').length,
    batchFallbackCount24h: scoped.filter((entry) => entry.finalizedByFallbackRoute === true && entry.effectiveExecutionMode === 'batch').length
  };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function roundPercent(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Number((/** @type {number} */ (value)).toFixed(1));
}

/**
 * @param {number[]=} values
 * @returns {number | null}
 */
function average(values = []) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return null;
  }
  return Math.round(finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeLatency(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

/**
 * @param {Record<string, any>=} entry
 * @returns {number}
 */
function normalizeSegmentCount(entry = {}) {
  const explicit = Number(entry.segmentCount);
  if (Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }
  return Array.isArray(entry.segments) ? entry.segments.length : 0;
}

/**
 * @param {Record<string, any>=} entry
 * @returns {any[]}
 */
function collectAttempts(entry = {}) {
  return Array.isArray(entry.attempts) ? entry.attempts : [];
}

/**
 * @param {Record<string, any>=} attempt
 * @returns {boolean}
 */
function isTimeoutAttempt(attempt = {}) {
  const errorCode = String(attempt?.errorCode || '').trim().toUpperCase();
  return errorCode === 'PROVIDER_TIMEOUT' || errorCode === 'TRANSLATION_TIMEOUT';
}

/**
 * @param {Record<string, any>=} attempt
 * @returns {boolean}
 */
function isRateLimitAttempt(attempt = {}) {
  return String(attempt?.errorCode || '').trim().toUpperCase() === 'PROVIDER_RATE_LIMITED';
}

/**
 * @param {Record<string, any>=} entry
 * @returns {boolean}
 */
function isBatchFallback(entry = {}) {
  return hasHistoryFallback(entry);
}

/**
 * @param {unknown=} providerId
 * @returns {Record<string, any>}
 */
function createProviderMetricAccumulator(providerId = '') {
  return {
    providerId: String(providerId || '').trim(),
    scopedCount: 0,
    successCount: 0,
    latencyTotal: 0,
    latencyCount: 0,
    timeoutCount: 0,
    rateLimitCount: 0,
    exactCacheHitCount: 0,
    adaptiveCacheHitCount: 0,
    batchFallbackCount: 0
  };
}

/**
 * @param {Record<string, any>=} accumulator
 * @returns {Record<string, any>}
 */
function finalizeProviderMetrics(accumulator = createProviderMetricAccumulator()) {
  return {
    successRate24h: accumulator.scopedCount
      ? Number(((accumulator.successCount / accumulator.scopedCount) * 100).toFixed(1))
      : null,
    avgLatencyMs: accumulator.latencyCount
      ? Math.round(accumulator.latencyTotal / accumulator.latencyCount)
      : null,
    timeoutCount24h: accumulator.timeoutCount,
    rateLimitCount24h: accumulator.rateLimitCount,
    exactCacheHitCount24h: accumulator.exactCacheHitCount,
    adaptiveCacheHitCount24h: accumulator.adaptiveCacheHitCount,
    batchFallbackCount24h: accumulator.batchFallbackCount
  };
}

/**
 * @param {any[]=} historyEntries
 * @param {number=} nowMs
 * @returns {Map<string, any>}
 */
function buildHistoryMetricsByProvider(historyEntries = [], nowMs = Date.now()) {
  const threshold = nowMs - (24 * 60 * 60 * 1000);
  const metricsByProvider = new Map();

  for (const entry of Array.isArray(historyEntries) ? historyEntries : []) {
    const providerId = String(entry?.providerId || '').trim();
    const completedAtMs = new Date(entry?.completedAt || '').getTime();
    if (!providerId || !Number.isFinite(completedAtMs) || completedAtMs < threshold) {
      continue;
    }

    const current = metricsByProvider.get(providerId) || createProviderMetricAccumulator(providerId);
    const latency = normalizeLatency(entry?.latencyMs);
    current.scopedCount += 1;
    if (String(entry?.status || '').trim().toLowerCase() === 'success') {
      current.successCount += 1;
    }
    if (latency !== null) {
      current.latencyTotal += latency;
      current.latencyCount += 1;
    }
    for (const attempt of collectAttempts(entry)) {
      if (isTimeoutAttempt(attempt)) {
        current.timeoutCount += 1;
      }
      if (isRateLimitAttempt(attempt)) {
        current.rateLimitCount += 1;
      }
      const cacheKind = String(attempt?.cacheKind || '').trim().toLowerCase();
      if (cacheKind === 'exact') {
        current.exactCacheHitCount += 1;
      } else if (cacheKind === 'adaptive') {
        current.adaptiveCacheHitCount += 1;
      }
    }
    if (entry.finalizedByFallbackRoute === true && entry.effectiveExecutionMode === 'batch') {
      current.batchFallbackCount += 1;
    }
    metricsByProvider.set(providerId, current);
  }

  return new Map(Array.from(metricsByProvider.entries())
    .map(([providerId, accumulator]) => [providerId, finalizeProviderMetrics(accumulator)]));
}

/**
 * @param {any[]=} historyEntries
 * @returns {Record<string, any>}
 */
function buildHistoryInsights(historyEntries = []) {
  const entries = Array.isArray(historyEntries) ? historyEntries : [];
  const totalRequests = entries.length;
  let totalSegments = 0;
  let successCount = 0;
  let latencyTotal = 0;
  let latencyCount = 0;
  let slowRequestCount = 0;

  for (const entry of entries) {
    const status = String(entry?.status || '').trim().toLowerCase();
    const segmentCount = normalizeSegmentCount(entry);
    const latency = normalizeLatency(entry?.latencyMs);
    totalSegments += segmentCount;
    if (status === 'success') {
      successCount += 1;
    }
    if (latency !== null) {
      latencyTotal += latency;
      latencyCount += 1;
      if (latency > SLOW_HISTORY_LATENCY_MS) {
        slowRequestCount += 1;
      }
    }
  }

  const failedCount = Math.max(0, totalRequests - successCount);
  const successRate = totalRequests ? roundPercent((successCount / totalRequests) * 100) : null;
  const avgLatencyMs = latencyCount ? Math.round(latencyTotal / latencyCount) : null;

  /** @type {any[]} */
  const providerBreakdown = [];

  const attentionItems = [];
  if (totalRequests > 0 && successRate !== null && successRate < 75) {
    attentionItems.push({ key: 'success-rate-critical', severity: 'error', code: 'successRateCritical', values: { value: successRate }, filter: { issue: 'failed' } });
  } else if (totalRequests > 0 && successRate !== null && successRate < 90) {
    attentionItems.push({ key: 'success-rate-warning', severity: 'warning', code: 'successRateWarning', values: { value: successRate }, filter: { issue: 'failed' } });
  }

  if (slowRequestCount > 0) {
    attentionItems.push({ key: 'slow-requests-present', severity: 'warning', code: 'slowRequestsPresent', values: { count: slowRequestCount }, filter: { issue: 'slow' } });
  }

  return {
    totalRequests,
    totalSegments,
    successCount,
    failedCount,
    successRate,
    avgLatencyMs,
    slowRequestCount,
    timeoutCount: 0,
    rateLimitCount: 0,
    exactCacheHitCount: 0,
    adaptiveCacheHitCount: 0,
    cacheHitCount: 0,
    cacheHitRate: null,
    batchFallbackCount: 0,
    providerBreakdown,
    attentionItems: attentionItems.slice(0, 5)
  };
}

/**
 * @param {Record<string, any>} state
 * @param {Record<string, any>=} overrides
 * @returns {Record<string, any>}
 */
function buildIntegrationConfig(state, overrides = {}) {
  const preferences = ensureIntegrationPreferences({
    ...(state?.integrationPreferences || {}),
    ...overrides
  });

  return {
    memoqVersion: preferences.memoqVersion,
    customInstallDir: preferences.customInstallDir,
    selectedInstallDir: preferences.selectedInstallDir
  };
}

module.exports = {
  buildHistoryInsights,
  buildHistoryMetrics,
  buildHistoryMetricsByProvider,
  buildHistorySummary,
  buildIntegrationConfig
};
