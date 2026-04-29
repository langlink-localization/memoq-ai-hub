const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeThroughputMode,
  resolveThroughputSettings,
  summarizeThroughputStats
} = require('../src/runtime/runtimeThroughput');

test('throughput auto chooses safe initial defaults by provider family', () => {
  const openai = resolveThroughputSettings({
    provider: { type: 'openai', baseUrl: 'https://api.openai.com/v1' },
    model: { modelName: 'gpt-5.4-mini', concurrencyLimit: 2 },
    capabilities: { throughputMode: 'auto', maxBatchSegments: 8, maxBatchCharacters: 12000 }
  });
  const compatible = resolveThroughputSettings({
    provider: { type: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1' },
    model: { modelName: 'deepseek-v4-flash', concurrencyLimit: 1 },
    capabilities: { throughputMode: 'auto', maxBatchSegments: 6, maxBatchCharacters: 8000 }
  });

  assert.deepEqual(
    { segments: openai.maxBatchSegments, chars: openai.maxBatchCharacters, concurrency: openai.providerConcurrency },
    { segments: 8, chars: 12000, concurrency: 2 }
  );
  assert.deepEqual(
    { segments: compatible.maxBatchSegments, chars: compatible.maxBatchCharacters, concurrency: compatible.providerConcurrency },
    { segments: 5, chars: 6000, concurrency: 2 }
  );
  assert.equal(compatible.batchAttemptTimeoutMs, 45000);
  assert.equal(compatible.singleAttemptTimeoutMs, 75000);
});

test('throughput auto scales up only after stable high-context history', () => {
  const route = {
    provider: { type: 'openai', baseUrl: 'https://api.openai.com/v1' },
    model: { modelName: 'gpt-large-context', concurrencyLimit: 2, contextWindowTokens: 256000 },
    capabilities: { throughputMode: 'auto', maxBatchSegments: 8, maxBatchCharacters: 12000 }
  };

  const starting = resolveThroughputSettings(route);
  const stable = resolveThroughputSettings(route, {
    completed: 8,
    successes: 8,
    failures: 0,
    timeouts: 0,
    rateLimits: 0,
    formatErrors: 0,
    latenciesMs: [8000, 9000, 10000, 11000, 12000, 13000, 14000, 15000]
  });

  assert.equal(starting.status, 'starting');
  assert.equal(starting.maxBatchSegments, 8);
  assert.equal(stable.status, 'stable');
  assert.equal(stable.maxBatchSegments, 16);
  assert.equal(stable.maxBatchCharacters, 24000);
});

test('throughput auto backs off after timeout, rate limit, or format instability', () => {
  const unstable = resolveThroughputSettings({
    provider: { type: 'openai', baseUrl: 'https://api.openai.com/v1' },
    model: { modelName: 'gpt-5.4-mini', concurrencyLimit: 2 },
    capabilities: { throughputMode: 'auto', maxBatchSegments: 8, maxBatchCharacters: 12000 }
  }, {
    completed: 4,
    successes: 3,
    failures: 1,
    timeouts: 1,
    rateLimits: 0,
    formatErrors: 0,
    latenciesMs: [10000, 11000, 12000]
  });

  assert.equal(unstable.status, 'backing_off');
  assert.equal(unstable.maxBatchSegments, 4);
  assert.equal(unstable.providerConcurrency, 1);
});

test('throughput auto backs off compatible providers to small batches after timeout', () => {
  const unstable = resolveThroughputSettings({
    provider: { type: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1' },
    model: { modelName: 'deepseek-v4-flash' },
    capabilities: { throughputMode: 'auto', maxBatchSegments: 5, maxBatchCharacters: 6000 }
  }, {
    completed: 3,
    successes: 2,
    failures: 1,
    timeouts: 1,
    rateLimits: 0,
    formatErrors: 0,
    latenciesMs: [10000, 12000]
  });

  assert.equal(unstable.status, 'backing_off');
  assert.equal(unstable.maxBatchSegments, 2);
  assert.equal(unstable.maxBatchCharacters, 3000);
  assert.equal(unstable.providerConcurrency, 1);
});

test('throughput normalization keeps custom mode explicit', () => {
  assert.equal(normalizeThroughputMode('safe'), 'reliable');
  assert.equal(normalizeThroughputMode('manual'), 'custom');
  assert.equal(summarizeThroughputStats({ completed: 5, successes: 5, latenciesMs: [1, 2, 3, 4, 5] }).stable, true);
});
