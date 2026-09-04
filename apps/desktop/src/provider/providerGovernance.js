/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function clampPositiveInteger(value, fallback) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(normalized));
}

/**
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
function parseRateLimitHint(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return {
      raw: '',
      requestsPerMinute: null,
      requestsPerSecond: null,
      concurrent: null,
      recommendedConcurrency: 1
    };
  }

  const lower = raw.toLowerCase();
  const numberMatch = lower.match(/(\d+(?:\.\d+)?)/);
  const numericValue = numberMatch ? Number(numberMatch[1]) : null;
  let requestsPerMinute = null;
  let requestsPerSecond = null;
  let concurrent = null;

  if (numericValue !== null) {
    if (/(concurrent|parallel|slots?)/.test(lower)) {
      concurrent = clampPositiveInteger(numericValue, 1);
    } else if (/(rps|req(?:uests?)?\s*\/\s*sec|per\s*second)/.test(lower)) {
      requestsPerSecond = numericValue;
    } else if (/(rpm|req(?:uests?)?\s*\/\s*min|per\s*minute|min\b)/.test(lower)) {
      requestsPerMinute = numericValue;
    } else if (numericValue <= 10) {
      concurrent = clampPositiveInteger(numericValue, 1);
    } else {
      requestsPerMinute = numericValue;
    }
  }

  let recommendedConcurrency = 1;
  if (concurrent) {
    recommendedConcurrency = Math.min(8, clampPositiveInteger(concurrent, 1));
  } else if (requestsPerSecond) {
    recommendedConcurrency = Math.min(8, Math.max(1, Math.floor(requestsPerSecond)));
  } else if (requestsPerMinute) {
    if (requestsPerMinute >= 180) recommendedConcurrency = 4;
    else if (requestsPerMinute >= 120) recommendedConcurrency = 3;
    else if (requestsPerMinute >= 60) recommendedConcurrency = 2;
  }

  return {
    raw,
    requestsPerMinute,
    requestsPerSecond,
    concurrent,
    recommendedConcurrency
  };
}

/**
 * @param {any} error
 * @returns {boolean}
 */
function shouldRetryProviderError(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  return ['PROVIDER_TIMEOUT', 'PROVIDER_NETWORK_FAILED', 'PROVIDER_RATE_LIMITED'].includes(code);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeRetryAfterSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  }
  return null;
}

/**
 * @param {unknown} message
 * @returns {number | null}
 */
function extractRetryAfterSeconds(message) {
  const normalized = String(message || '').toLowerCase();
  const retryAfterMatch = normalized.match(/retry[-\s]?after[^0-9]*(\d+(?:\.\d+)?)/i);
  if (!retryAfterMatch) {
    return null;
  }
  const seconds = Number(retryAfterMatch[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * @param {any} error
 * @param {unknown} retryIndex
 * @returns {number}
 */
function computeRetryDelayMs(error, retryIndex) {
  const retryAfterSeconds = normalizeRetryAfterSeconds(error?.retryAfterSeconds)
    ?? extractRetryAfterSeconds(error?.message || '');
  if (retryAfterSeconds !== null) {
    return Math.max(250, Math.round(retryAfterSeconds * 1000));
  }

  const attempt = clampPositiveInteger(retryIndex, 1);
  return Math.min(4000, 250 * (2 ** (attempt - 1)));
}

/**
 * @typedef {Object} SemaphoreTicket
 * @property {number} queuedMs
 * @property {() => void} release
 */

/**
 * @param {unknown=} limit
 * @returns {{ acquire: () => Promise<SemaphoreTicket> }}
 */
function createSemaphore(limit = 1) {
  let active = 0;
  /** @type {Array<(...args: any[]) => void>} */
  const queue = [];
  const normalizedLimit = clampPositiveInteger(limit, 1);

  function release() {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    if (next) {
      active += 1;
      next();
    }
  }

  return {
    async acquire() {
      const queuedAt = Date.now();
      if (active < normalizedLimit) {
        active += 1;
        return {
          queuedMs: 0,
          release
        };
      }

      await new Promise((resolve) => {
        queue.push(resolve);
      });

      return {
        queuedMs: Date.now() - queuedAt,
        release
      };
    }
  };
}

/**
 * @typedef {Object} RateLimitTicket
 * @property {number} rateLimitedWaitMs
 */

/**
 * @param {{ requestsPerWindow?: unknown, windowMs?: unknown, smoothness?: unknown }=} options
 * @returns {{ acquire: () => Promise<RateLimitTicket> }}
 */
function createRateLimiter({ requestsPerWindow, windowMs, smoothness = 1 } = {}) {
  const normalizedRequests = clampPositiveInteger(requestsPerWindow, 0);
  const normalizedWindowMs = clampPositiveInteger(windowMs, 0);
  const normalizedSmoothness = Number.isFinite(Number(smoothness)) && Number(smoothness) > 0
    ? Number(smoothness)
    : 1;

  if (!normalizedRequests || !normalizedWindowMs) {
    return {
      async acquire() {
        return { rateLimitedWaitMs: 0 };
      }
    };
  }

  /** @type {number[]} */
  let timestamps = [];
  let lastIssuedAt = 0;
  /** @type {Promise<any>} */
  let queue = Promise.resolve();

  /**
   * @param {number} delayMs
   * @returns {Promise<void>}
   */
  async function wait(delayMs) {
    if (!delayMs || delayMs <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  /**
   * @param {number} now
   * @returns {void}
   */
  function trim(now) {
    timestamps = timestamps.filter((timestamp) => now - timestamp < normalizedWindowMs);
  }

  return {
    async acquire() {
      const queuedAt = Date.now();
      const run = queue.then(async () => {
        while (true) {
          const now = Date.now();
          trim(now);

          let waitMs = 0;
          if (timestamps.length >= normalizedRequests) {
            waitMs = Math.max(waitMs, normalizedWindowMs - (now - timestamps[0]));
          }

          const minIntervalMs = Math.max(0, Math.round((normalizedWindowMs / normalizedRequests) * normalizedSmoothness));
          if (lastIssuedAt && minIntervalMs > 0) {
            waitMs = Math.max(waitMs, minIntervalMs - (now - lastIssuedAt));
          }

          if (waitMs <= 0) {
            const issuedAt = Date.now();
            trim(issuedAt);
            timestamps.push(issuedAt);
            lastIssuedAt = issuedAt;
            return {
              rateLimitedWaitMs: Math.max(0, issuedAt - queuedAt)
            };
          }

          await wait(waitMs);
        }
      });

      queue = run.catch(() => {});
      return run;
    }
  };
}

module.exports = {
  computeRetryDelayMs,
  createRateLimiter,
  createSemaphore,
  extractRetryAfterSeconds,
  normalizeRetryAfterSeconds,
  parseRateLimitHint,
  shouldRetryProviderError
};
