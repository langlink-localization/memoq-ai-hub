'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeProviderExecution } = require('../src/runtime/runtimeProviderExecution');

function createRoute(model = {}) {
  return {
    provider: { id: 'provider-1', type: 'openai-compatible', baseUrl: 'https://example.test/v1' },
    model: { id: 'model-1', modelName: 'model-1', ...model },
    capabilities: {}
  };
}

test('provider execution owns retry accounting and preserves mapped errors', async () => {
  const delays = [];
  const execution = createRuntimeProviderExecution({
    sleep: async (delayMs) => delays.push(delayMs)
  });
  let attempts = 0;

  const result = await execution.run({
    route: createRoute({ retryAttempts: 1 }),
    execute: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('provider timed out');
        error.mappedError = { code: 'PROVIDER_TIMEOUT', message: 'provider timed out' };
        throw error;
      }
      return { text: 'translated' };
    }
  });

  assert.equal(result.text, 'translated');
  assert.equal(result.retryCount, 1);
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [250]);
});

test('provider execution isolates rescue concurrency from normal route settings', async () => {
  const execution = createRuntimeProviderExecution({ rescueConcurrency: 2 });
  const route = createRoute({ retryEnabled: false, providerConcurrency: 4 });
  let active = 0;
  let maxActive = 0;

  await Promise.all(Array.from({ length: 5 }, () => execution.run({
    route,
    rescue: true,
    execute: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { text: 'ok' };
    }
  })));

  assert.equal(maxActive, 2);
});

test('provider execution keeps adaptive throughput history scoped to each route', () => {
  const execution = createRuntimeProviderExecution();
  const unstableRoute = createRoute();
  const stableRoute = {
    ...createRoute(),
    provider: { id: 'provider-2', type: 'openai', baseUrl: 'https://api.openai.com/v1' }
  };

  execution.recordThroughputAttempts(unstableRoute, [{
    providerId: 'provider-1',
    success: false,
    latencyMs: 1000,
    errorCode: 'PROVIDER_TIMEOUT'
  }]);

  assert.equal(execution.getThroughputSettings(unstableRoute).status, 'backing_off');
  assert.equal(execution.getThroughputStats(unstableRoute).timeouts, 1);
  assert.equal(execution.getThroughputStats(stableRoute).completed, 0);
});
