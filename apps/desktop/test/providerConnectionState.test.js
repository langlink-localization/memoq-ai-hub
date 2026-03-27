const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModule() {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../src/renderer/src/pages/providers/providerConnectionState.mjs')).href;
  return import(moduleUrl);
}

test('decorated provider items surface failed draft test status', async () => {
  const { decorateProvidersWithConnectionStatus } = await loadModule();
  const [provider] = decorateProvidersWithConnectionStatus({
    providers: [{ id: 'provider_1', status: 'not_tested' }],
    draftsById: { provider_1: { dirtyFields: ['name'] } },
    testStatesById: { provider_1: { fingerprint: 'fp-1', status: 'failed', testedAt: '2026-03-27T00:00:00.000Z' } },
    buildFingerprint: () => 'fp-1',
    hasDraftChanges: () => true
  });

  assert.equal(provider.status, 'failed');
});

test('decorated provider items reset to not_tested when connection fields changed after a prior test', async () => {
  const { decorateProvidersWithConnectionStatus } = await loadModule();
  const [provider] = decorateProvidersWithConnectionStatus({
    providers: [{ id: 'provider_1', status: 'failed' }],
    draftsById: { provider_1: { dirtyFields: ['apiKey'] } },
    testStatesById: { provider_1: { fingerprint: 'fp-old', status: 'failed', testedAt: '2026-03-27T00:00:00.000Z' } },
    buildFingerprint: () => 'fp-new',
    hasDraftChanges: () => true
  });

  assert.equal(provider.status, 'not_tested');
});

test('decorated provider items expose transient connection snapshots for successful draft tests', async () => {
  const { decorateProvidersWithConnectionStatus } = await loadModule();
  const [provider] = decorateProvidersWithConnectionStatus({
    providers: [{
      id: 'provider_1',
      status: 'not_tested',
      lastCheckedAt: '',
      lastLatencyMs: null,
      lastError: ''
    }],
    draftsById: { provider_1: { dirtyFields: ['name'] } },
    testStatesById: {
      provider_1: {
        fingerprint: 'fp-1',
        status: 'connected',
        message: 'Connection ok',
        testedAt: '2026-03-27T00:00:00.000Z',
        latencyMs: 42
      }
    },
    buildFingerprint: () => 'fp-1',
    hasDraftChanges: () => true
  });

  assert.equal(provider.status, 'connected');
  assert.deepEqual(provider.connectionSnapshot, {
    status: 'connected',
    testedAt: '2026-03-27T00:00:00.000Z',
    latencyMs: 42,
    message: 'Connection ok',
    lastError: '',
    hasPreviousTest: true
  });
});

test('invalidated draft tests keep previous test presence but clear effective health details', async () => {
  const { decorateProvidersWithConnectionStatus } = await loadModule();
  const [provider] = decorateProvidersWithConnectionStatus({
    providers: [{
      id: 'provider_1',
      status: 'connected',
      lastCheckedAt: '2026-03-26T00:00:00.000Z',
      lastLatencyMs: 15,
      lastError: ''
    }],
    draftsById: { provider_1: { dirtyFields: ['apiKey'] } },
    testStatesById: {
      provider_1: {
        fingerprint: 'fp-old',
        status: 'connected',
        message: 'Connection ok',
        testedAt: '2026-03-27T00:00:00.000Z',
        latencyMs: 42
      }
    },
    buildFingerprint: () => 'fp-new',
    hasDraftChanges: () => true
  });

  assert.equal(provider.status, 'not_tested');
  assert.equal(provider.connectionSnapshot.status, 'not_tested');
  assert.equal(provider.connectionSnapshot.message, '');
  assert.equal(provider.connectionSnapshot.lastError, '');
  assert.equal(provider.connectionSnapshot.hasPreviousTest, true);
});
