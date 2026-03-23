const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHistoryMetrics,
  buildHistorySummary,
  buildIntegrationConfig
} = require('../src/runtime/runtimeHistoryIntegrationSupport');

test('runtime history integration support returns null metrics when no matching provider entries exist', () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-03-22T12:00:00.000Z');
  try {
    assert.deepEqual(buildHistoryMetrics([], 'provider-a'), {
      successRate24h: null,
      avgLatencyMs: null,
      timeoutCount24h: 0,
      rateLimitCount24h: 0,
      exactCacheHitCount24h: 0,
      adaptiveCacheHitCount24h: 0,
      batchFallbackCount24h: 0
    });
  } finally {
    Date.now = originalNow;
  }
});

test('runtime history integration support calculates provider metrics within the last 24 hours only', () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-03-22T12:00:00.000Z');
  try {
    const metrics = buildHistoryMetrics([
      { providerId: 'provider-a', status: 'success', latencyMs: 100, completedAt: '2026-03-22T11:00:00.000Z' },
      {
        providerId: 'provider-a',
        status: 'failed',
        latencyMs: '150',
        completedAt: '2026-03-22T10:00:00.000Z',
        attempts: [{ errorCode: 'PROVIDER_TIMEOUT' }]
      },
      {
        providerId: 'provider-a',
        status: 'success',
        latencyMs: 'n/a',
        completedAt: '2026-03-22T09:00:00.000Z',
        attempts: [
          { cacheKind: 'exact' },
          { cacheKind: 'adaptive' },
          { errorCode: 'PROVIDER_RATE_LIMITED' }
        ],
        finalizedByFallbackRoute: true,
        effectiveExecutionMode: 'batch'
      },
      { providerId: 'provider-b', status: 'success', latencyMs: 50, completedAt: '2026-03-22T11:00:00.000Z' },
      { providerId: 'provider-a', status: 'success', latencyMs: 40, completedAt: '2026-03-20T11:59:59.000Z' }
    ], 'provider-a');

    assert.deepEqual(metrics, {
      successRate24h: 66.7,
      avgLatencyMs: 125,
      timeoutCount24h: 1,
      rateLimitCount24h: 1,
      exactCacheHitCount24h: 1,
      adaptiveCacheHitCount24h: 1,
      batchFallbackCount24h: 1
    });
  } finally {
    Date.now = originalNow;
  }
});

test('runtime history integration support normalizes integration config and applies overrides', () => {
  const config = buildIntegrationConfig({
    integrationPreferences: {
      memoqVersion: '11.0',
      customInstallDir: 'C:\\memoQ',
      selectedInstallDir: ''
    }
  }, {
    selectedInstallDir: 'D:\\Apps\\memoQ'
  });

  assert.deepEqual(config, {
    memoqVersion: '11',
    customInstallDir: 'C:\\memoQ',
    selectedInstallDir: 'D:\\Apps\\memoQ'
  });
});

test('runtime history integration support builds concise history summaries from first two visible segments', () => {
  assert.deepEqual(buildHistorySummary({
    segments: [
      { sourceText: ' One ', targetText: '' },
      { sourceText: 'Two', targetText: ' Zwei ' },
      { sourceText: 'Three', targetText: 'Drei' }
    ]
  }), {
    segmentCount: 3,
    segmentSummary: 'One | Zwei'
  });
});
