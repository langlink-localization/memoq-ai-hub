const {
  buildHistorySummary
} = require('./runtimeHistoryBuilder');
const {
  ensureIntegrationPreferences
} = require('./runtimeState');

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
  buildHistoryMetrics,
  buildHistorySummary,
  buildIntegrationConfig
};
