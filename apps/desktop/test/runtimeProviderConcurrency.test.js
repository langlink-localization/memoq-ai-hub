const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeProviderService } = require('../src/runtime/runtimeProviderService');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function harness(overrides = {}) {
  let state = { providers: [{ id: 'p1', name: 'Provider', type: 'openai', baseUrl: 'https://api.openai.com/v1',
    secretRef: 'secret1', models: [{ id: 'm1', modelName: 'test-model', enabled: true }], status: 'unknown' }], profiles: [], assets: [] };
  const loadState = () => structuredClone(state);
  const saveState = (next) => { state = structuredClone(next); };
  return {
    read: loadState,
    change: (change) => { const next = loadState(); change(next); saveState(next); },
    service: createRuntimeProviderService({
      loadState, saveState, loadHistoryEntries: () => [], nowIso: () => '2026-09-12T05:00:00.000Z',
      secretStore: { get: async () => 'test-key', set: async () => {}, delete: async () => {}, has: () => true },
      providerRegistry: { testConnection: async () => ({ ok: true, message: 'Connected', latencyMs: 1 }) },
      ...overrides
    })
  };
}

test('provider save preserves other state written while the secret store is pending', async () => {
  const gate = deferred();
  const h = harness({ secretStore: { set: () => gate.promise, has: () => true } });
  const pending = h.service.saveProvider({ id: 'p1', apiKey: 'sk-test-placeholder', name: 'Renamed' });
  h.change((state) => { state.profiles.push({ id: 'profile-new' }); state.assets.push({ id: 'asset-new' }); });
  gate.resolve();
  await pending;
  assert.equal(h.read().profiles[0].id, 'profile-new');
  assert.equal(h.read().assets[0].id, 'asset-new');
  assert.equal(h.read().providers[0].name, 'Renamed');
  assert.equal(Object.hasOwn(h.read().providers[0], 'apiKey'), false);
});

test('provider save does not recreate a provider deleted during secret persistence', async () => {
  const gate = deferred();
  const h = harness({ secretStore: { set: () => gate.promise, has: () => true } });
  const pending = h.service.saveProvider({ id: 'p1', apiKey: 'sk-test-placeholder' });
  h.change((state) => { state.providers = []; });
  gate.resolve();
  await assert.rejects(pending, /not found/);
  assert.equal(h.read().providers.length, 0);
});

test('connection completion merges status into fresh state without losing profiles', async () => {
  const gate = deferred();
  const h = harness({ providerRegistry: { testConnection: () => gate.promise } });
  const pending = h.service.testProviderConnection('p1');
  await Promise.resolve();
  h.change((state) => { state.profiles.push({ id: 'new-profile' }); });
  gate.resolve({ ok: true, message: 'Connected', latencyMs: 3 });
  await pending;
  assert.equal(h.read().providers[0].status, 'connected');
  assert.equal(h.read().profiles[0].id, 'new-profile');
});

test('connection completion cannot revive a deleted provider or mark changed settings connected', async () => {
  for (const remove of [true, false]) {
    const gate = deferred();
    const h = harness({ providerRegistry: { testConnection: () => gate.promise } });
    const pending = h.service.testProviderConnection('p1');
    await Promise.resolve();
    h.change((state) => { if (remove) state.providers = []; else state.providers[0].baseUrl = 'https://example.com/v1'; });
    gate.resolve({ ok: true, message: 'Connected', latencyMs: 3 });
    await pending;
    if (remove) assert.equal(h.read().providers.length, 0);
    else assert.equal(h.read().providers[0].status, 'unknown');
  }
});

test('older connection test cannot overwrite a newer test result', async () => {
  const gates = [deferred(), deferred()];
  let calls = 0;
  const h = harness({ providerRegistry: { testConnection: () => gates[calls++].promise } });
  const older = h.service.testProviderConnection('p1');
  const newer = h.service.testProviderConnection('p1');
  await Promise.resolve();
  gates[1].resolve({ ok: true, message: 'Connected', latencyMs: 2 });
  await newer;
  gates[0].resolve({ ok: false, message: 'Old failure', latencyMs: 9 });
  await older;
  assert.equal(h.read().providers[0].status, 'connected');
  assert.equal(h.read().providers[0].lastLatencyMs, 2);
});
