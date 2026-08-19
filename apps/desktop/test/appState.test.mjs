import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFallbackAppState,
  normalizeAppStatePayload,
  preserveProviderHistoryMetrics
} from '../src/renderer/src/appState.mjs';

test('app state normalization restores nested defaults and rejects malformed collections', () => {
  const normalized = normalizeAppStatePayload({
    startup: { status: 'ready' },
    dashboard: {
      checklist: 'invalid',
      runtimeStatus: {
        previewStatus: { status: 'connected' }
      }
    },
    contextBuilder: {
      profiles: null,
      defaultProfileId: 42,
      translationCacheBypassProfileIds: ['profile-1', '', null]
    },
    historyExplorer: {
      items: 'invalid',
      insights: {
        totalRequests: 3,
        providerBreakdown: null
      }
    }
  });

  assert.equal(normalized.startup.status, 'ready');
  assert.equal(normalized.dashboard.runtimeStatus.previewStatus.status, 'connected');
  assert.deepEqual(normalized.dashboard.checklist, []);
  assert.deepEqual(normalized.contextBuilder.profiles, []);
  assert.equal(normalized.contextBuilder.defaultProfileId, '42');
  assert.deepEqual(normalized.contextBuilder.translationCacheBypassProfileIds, ['profile-1']);
  assert.deepEqual(normalized.historyExplorer.items, []);
  assert.equal(normalized.historyExplorer.insights.totalRequests, 3);
  assert.deepEqual(normalized.historyExplorer.insights.providerBreakdown, []);
});

test('fallback app state keeps desktop sections available before the first refresh', () => {
  const fallback = createFallbackAppState();

  assert.equal(fallback.productName, 'memoQ AI Hub');
  assert.equal(fallback.startup.status, 'starting');
  assert.deepEqual(fallback.contextBuilder.profiles, []);
  assert.deepEqual(fallback.providerHub.providers, []);
  assert.deepEqual(fallback.historyExplorer.items, []);
});

test('provider refresh keeps already-loaded history metrics by provider id', () => {
  const result = preserveProviderHistoryMetrics({
    providerHub: {
      providers: [
        { id: 'provider-1', name: 'Updated provider' },
        { id: 'provider-2', name: 'New provider' }
      ]
    }
  }, {
    providerHub: {
      providers: [{
        id: 'provider-1',
        successRate24h: 0.95,
        avgLatencyMs: 320
      }]
    }
  });

  assert.deepEqual(result.providerHub.providers[0], {
    id: 'provider-1',
    name: 'Updated provider',
    successRate24h: 0.95,
    avgLatencyMs: 320
  });
  assert.deepEqual(result.providerHub.providers[1], {
    id: 'provider-2',
    name: 'New provider'
  });
});
