const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeRetryDelayMs,
  createRateLimiter,
  parseRateLimitHint,
  shouldRetryProviderError
} = require('../src/provider/providerGovernance');

test('parseRateLimitHint derives safe concurrency from rpm and explicit concurrency hints', () => {
  assert.equal(parseRateLimitHint('60 rpm').recommendedConcurrency, 2);
  assert.equal(parseRateLimitHint('2 concurrent').recommendedConcurrency, 2);
  assert.equal(parseRateLimitHint('').recommendedConcurrency, 1);
});

test('shouldRetryProviderError only retries transient provider failures', () => {
  assert.equal(shouldRetryProviderError({ code: 'PROVIDER_TIMEOUT' }), true);
  assert.equal(shouldRetryProviderError({ code: 'PROVIDER_NETWORK_FAILED' }), true);
  assert.equal(shouldRetryProviderError({ code: 'PROVIDER_RATE_LIMITED' }), true);
  assert.equal(shouldRetryProviderError({ code: 'PROVIDER_AUTH_FAILED' }), false);
});

test('computeRetryDelayMs honors retry-after hints when available', () => {
  assert.equal(computeRetryDelayMs({ message: 'retry-after 2' }, 1), 2000);
  assert.equal(computeRetryDelayMs({ retryAfterSeconds: 3 }, 1), 3000);
  assert.equal(computeRetryDelayMs({ message: 'timeout' }, 2), 500);
});

test('createRateLimiter spaces requests inside a fixed window', async () => {
  const limiter = createRateLimiter({ requestsPerWindow: 2, windowMs: 100, smoothness: 1 });

  const first = await limiter.acquire();
  const second = await limiter.acquire();
  const third = await limiter.acquire();

  assert.ok(first.rateLimitedWaitMs >= 0);
  assert.ok(second.rateLimitedWaitMs >= 30);
  assert.ok(third.rateLimitedWaitMs >= 30);
  assert.ok(Math.max(second.rateLimitedWaitMs, third.rateLimitedWaitMs) >= 40);
});
