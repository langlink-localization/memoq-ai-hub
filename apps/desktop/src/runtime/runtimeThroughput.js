const SUPPORTED_THROUGHPUT_MODES = new Set(['auto', 'reliable', 'fast', 'custom']);

function clampPositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(numeric));
}

function normalizeThroughputMode(value, fallback = 'auto') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const aliases = {
    balanced: 'auto',
    adaptive: 'auto',
    safe: 'reliable',
    stability: 'reliable',
    speed: 'fast',
    manual: 'custom'
  };
  const candidate = aliases[normalized] || normalized;
  if (SUPPORTED_THROUGHPUT_MODES.has(candidate)) {
    return candidate;
  }
  return SUPPORTED_THROUGHPUT_MODES.has(fallback) ? fallback : 'auto';
}

function isOpenAICompatibleRoute(route = {}) {
  return String(route?.provider?.type || '').trim().toLowerCase() === 'openai-compatible';
}

function isDeepSeekRoute(route = {}) {
  const baseUrl = String(route?.provider?.baseUrl || '').trim().toLowerCase();
  const modelName = String(route?.model?.modelName || route?.model?.id || '').trim().toLowerCase();
  return baseUrl.includes('deepseek') || modelName.startsWith('deepseek-');
}

function getContextTier(route = {}) {
  const configured = Number(route?.model?.contextWindowTokens || route?.model?.contextTokens || 0);
  const modelName = String(route?.model?.modelName || '').trim().toLowerCase();
  if (Number.isFinite(configured) && configured >= 1000000) {
    return 'huge';
  }
  if (Number.isFinite(configured) && configured >= 256000) {
    return 'large';
  }
  if (modelName.includes('128k') || modelName.includes('256k') || modelName.includes('1m')) {
    return modelName.includes('1m') ? 'huge' : 'large';
  }
  return 'standard';
}

function getBaseDefaults(route = {}) {
  if (isDeepSeekRoute(route) || isOpenAICompatibleRoute(route)) {
    return {
      maxBatchSegments: 5,
      maxBatchCharacters: 6000,
      providerConcurrency: 2,
      batchAttemptTimeoutMs: 45000,
      singleAttemptTimeoutMs: 75000
    };
  }

  return {
    maxBatchSegments: 8,
    maxBatchCharacters: 12000,
    providerConcurrency: 2,
    batchAttemptTimeoutMs: 60000,
    singleAttemptTimeoutMs: 90000
  };
}

function summarizeThroughputStats(stats = {}) {
  const completed = clampPositiveInteger(stats.completed || stats.total || 0, 0);
  const successes = clampPositiveInteger(stats.successes || 0, 0);
  const failures = clampPositiveInteger(stats.failures || 0, 0);
  const timeouts = clampPositiveInteger(stats.timeouts || 0, 0);
  const rateLimits = clampPositiveInteger(stats.rateLimits || 0, 0);
  const formatErrors = clampPositiveInteger(stats.formatErrors || 0, 0);
  const latencies = Array.isArray(stats.latenciesMs)
    ? stats.latenciesMs.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0)
    : [];
  const sortedLatencies = [...latencies].sort((left, right) => left - right);
  const p95LatencyMs = sortedLatencies.length
    ? sortedLatencies[Math.min(sortedLatencies.length - 1, Math.ceil(sortedLatencies.length * 0.95) - 1)]
    : null;
  const successRate = completed > 0 ? successes / completed : 0;
  const unstable = failures > 0 || timeouts > 0 || rateLimits > 0 || formatErrors > 0;
  const stable = completed >= 5 && successRate >= 0.95 && !unstable && (p95LatencyMs === null || p95LatencyMs <= 45000);

  return {
    completed,
    successes,
    failures,
    timeouts,
    rateLimits,
    formatErrors,
    p95LatencyMs,
    successRate,
    stable,
    unstable
  };
}

function resolveThroughputSettings(route = {}, stats = {}) {
  const capabilities = route?.capabilities || {};
  const model = route?.model || {};
  const mode = normalizeThroughputMode(model.throughputMode || capabilities.throughputMode || 'auto');
  const base = getBaseDefaults(route);
  const summary = summarizeThroughputStats(stats);
  const contextTier = getContextTier(route);

  let maxBatchSegments = clampPositiveInteger(capabilities.maxBatchSegments, base.maxBatchSegments);
  let maxBatchCharacters = clampPositiveInteger(capabilities.maxBatchCharacters, base.maxBatchCharacters);
  let providerConcurrency = clampPositiveInteger(model.providerConcurrency, base.providerConcurrency);
  let batchAttemptTimeoutMs = clampPositiveInteger(model.batchAttemptTimeoutMs, base.batchAttemptTimeoutMs);
  let singleAttemptTimeoutMs = clampPositiveInteger(model.singleAttemptTimeoutMs, base.singleAttemptTimeoutMs);
  let status = 'starting';
  const compatibleRoute = isDeepSeekRoute(route) || isOpenAICompatibleRoute(route);

  if (mode === 'auto' && compatibleRoute) {
    maxBatchSegments = Math.min(maxBatchSegments, base.maxBatchSegments);
    maxBatchCharacters = Math.min(maxBatchCharacters, base.maxBatchCharacters);
  }

  if (mode === 'custom') {
    maxBatchSegments = clampPositiveInteger(model.maxBatchSegments, maxBatchSegments);
    maxBatchCharacters = clampPositiveInteger(model.maxBatchCharacters, maxBatchCharacters);
    providerConcurrency = clampPositiveInteger(model.providerConcurrency || model.concurrencyLimit, providerConcurrency);
    batchAttemptTimeoutMs = clampPositiveInteger(model.batchAttemptTimeoutMs, batchAttemptTimeoutMs);
    singleAttemptTimeoutMs = clampPositiveInteger(model.singleAttemptTimeoutMs, singleAttemptTimeoutMs);
    status = 'custom';
  } else if (mode === 'reliable') {
    maxBatchSegments = Math.min(maxBatchSegments, compatibleRoute ? 3 : 6);
    maxBatchCharacters = Math.min(maxBatchCharacters, compatibleRoute ? 6000 : 9000);
    providerConcurrency = 1;
    status = 'reliable';
  } else if (mode === 'fast') {
    const targetSegments = contextTier === 'huge' ? 32 : 16;
    const targetCharacters = contextTier === 'huge' ? 40000 : 24000;
    maxBatchSegments = Math.max(maxBatchSegments, targetSegments);
    maxBatchCharacters = Math.max(maxBatchCharacters, targetCharacters);
    providerConcurrency = Math.max(providerConcurrency, compatibleRoute ? 2 : 4);
    status = 'fast';
  } else if (summary.unstable) {
    maxBatchSegments = Math.max(compatibleRoute ? 2 : 1, Math.floor(maxBatchSegments / 2));
    maxBatchCharacters = Math.max(1000, Math.floor(maxBatchCharacters / 2));
    providerConcurrency = 1;
    status = 'backing_off';
  } else if (summary.stable) {
    if (contextTier === 'huge') {
      maxBatchSegments = Math.max(maxBatchSegments, 32);
      maxBatchCharacters = Math.max(maxBatchCharacters, 40000);
    } else if (contextTier === 'large') {
      maxBatchSegments = Math.max(maxBatchSegments, 16);
      maxBatchCharacters = Math.max(maxBatchCharacters, 24000);
    } else if (!compatibleRoute) {
      maxBatchSegments = Math.max(maxBatchSegments, 12);
      maxBatchCharacters = Math.max(maxBatchCharacters, 16000);
    }
    status = 'stable';
  }

  const outputTokenLimit = Number(model.maxOutputTokens || 0);
  if (Number.isFinite(outputTokenLimit) && outputTokenLimit > 0 && outputTokenLimit < 4096) {
    maxBatchSegments = Math.min(maxBatchSegments, 4);
    maxBatchCharacters = Math.min(maxBatchCharacters, 6000);
    status = status === 'fast' ? 'output_limited' : status;
  }

  return {
    mode,
    status,
    contextTier,
    maxBatchSegments,
    maxBatchCharacters,
    providerConcurrency,
    batchAttemptTimeoutMs,
    singleAttemptTimeoutMs,
    stats: summary
  };
}

function createThroughputStatsRecorder(limit = 24) {
  const rows = [];
  const normalizedLimit = clampPositiveInteger(limit, 24);

  return {
    record(attempts = []) {
      for (const attempt of Array.isArray(attempts) ? attempts : []) {
        if (!attempt || attempt.providerId === 'cache' || attempt.providerId === 'adaptive-cache') {
          continue;
        }
        const errorCode = String(attempt.errorCode || attempt.error?.code || '').trim().toUpperCase();
        const message = String(attempt.error?.message || attempt.errorMessage || '').toLowerCase();
        rows.push({
          success: attempt.success === true,
          latencyMs: Number(attempt.latencyMs),
          errorCode,
          formatError: errorCode === 'PROVIDER_REQUEST_FAILED'
            && (
              message.includes('json')
              || message.includes('schema')
              || message.includes('index')
              || message.includes('tag')
              || message.includes('translation')
            )
        });
      }
      while (rows.length > normalizedLimit) {
        rows.shift();
      }
    },
    snapshot() {
      const successes = rows.filter((row) => row.success).length;
      return {
        completed: rows.length,
        successes,
        failures: rows.length - successes,
        timeouts: rows.filter((row) => row.errorCode === 'PROVIDER_TIMEOUT').length,
        rateLimits: rows.filter((row) => row.errorCode === 'PROVIDER_RATE_LIMITED').length,
        formatErrors: rows.filter((row) => row.formatError).length,
        latenciesMs: rows.map((row) => row.latencyMs).filter((value) => Number.isFinite(value) && value >= 0)
      };
    }
  };
}

module.exports = {
  SUPPORTED_THROUGHPUT_MODES,
  createThroughputStatsRecorder,
  isDeepSeekRoute,
  normalizeThroughputMode,
  resolveThroughputSettings,
  summarizeThroughputStats
};
