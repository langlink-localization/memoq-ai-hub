'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRuntimeProfileService } = require('../src/runtime/runtimeProfileService');
const { createRuntimeProviderService } = require('../src/runtime/runtimeProviderService');
const { createRuntimeAssetService } = require('../src/runtime/runtimeAssetService');

function createStateHarness(initialState) {
  let state = structuredClone(initialState);
  return {
    loadState: () => state,
    saveState: (nextState) => { state = nextState; },
    getState: () => state
  };
}

test('profile service owns profile lifecycle and mapping resolution', () => {
  const harness = createStateHarness({
    profiles: [
      { id: 'profile_default', name: 'Default' },
      { id: 'profile_client', name: 'Client' }
    ],
    mappingRules: [],
    defaultProfileId: 'profile_default'
  });
  const deletedProfiles = [];
  const service = createRuntimeProfileService({
    ...harness,
    createId: () => 'profile_copy',
    onProfileDeleted: (profileId) => deletedProfiles.push(profileId)
  });

  const rule = service.saveMappingRule({
    id: 'rule_client',
    ruleName: 'Client rule',
    profileId: 'profile_client',
    priority: 100,
    conditions: [{ field: 'client', operator: 'equals', value: 'Acme' }]
  });
  const match = service.testMapping({ client: 'Acme' });
  const copy = service.duplicateProfile('profile_client');

  assert.equal(rule.profileId, 'profile_client');
  assert.equal(match.profile.id, 'profile_client');
  assert.equal(match.rule.id, 'rule_client');
  assert.equal(copy.id, 'profile_copy');
  assert.throws(() => service.deleteProfile('profile_client'), /still used by mapping rules/i);

  service.deleteMappingRule('rule_client');
  assert.deepEqual(service.deleteProfile('profile_client'), { ok: true });
  assert.deepEqual(deletedProfiles, ['profile_client']);
});

test('provider service owns draft testing, discovery, secrets, and reference guards', async () => {
  const harness = createStateHarness({ providers: [], profiles: [] });
  const secrets = new Map();
  const calls = [];
  const service = createRuntimeProviderService({
    ...harness,
    loadHistoryEntries: () => [],
    secretStore: {
      get: async (key) => secrets.get(key) || '',
      set: async (key, value) => { secrets.set(key, value); },
      delete: async (key) => { secrets.delete(key); },
      has: (key) => secrets.has(key)
    },
    providerRegistry: {
      testConnection: async (request) => {
        calls.push(request);
        return { ok: true, message: 'Connected', latencyMs: 12 };
      },
      discoverModels: async () => ({ ok: true, models: [{ modelName: 'model-discovered' }] })
    },
    nowIso: () => '2026-08-20T00:00:00.000Z'
  });
  const providerDraft = {
    id: 'provider_1',
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test-value',
    models: [{ id: 'model_1', modelName: 'model-1', enabled: true }],
    defaultModelId: 'model_1'
  };

  const testResult = await service.testProviderDraft(providerDraft);
  const saved = await service.saveProvider(providerDraft);
  const discovered = await service.discoverProviderModels({ id: saved.id });

  assert.equal(testResult.status, 'connected');
  assert.equal(calls[0].modelName, 'model-1');
  assert.equal(saved.hasSecret, true);
  assert.equal(Object.hasOwn(saved, 'apiKey'), false);
  assert.equal(discovered.models[0].modelName, 'model-discovered');

  harness.getState().profiles.push({ id: 'profile_1', name: 'Profile', providerId: saved.id });
  await assert.rejects(service.deleteProvider(saved.id), /still referenced by: Profile/i);
});

test('asset service owns imported file lifecycle and parsed-cache eviction', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-ai-hub-assets-'));
  const assetsDir = path.join(tempRoot, 'assets');
  fs.mkdirSync(assetsDir);
  const sourcePath = path.join(tempRoot, 'brief.txt');
  fs.writeFileSync(sourcePath, 'Project brief', 'utf8');
  const harness = createStateHarness({ assets: [], profiles: [] });
  const parsedAssetCache = new Map();
  const service = createRuntimeAssetService({
    ...harness,
    assetsDir,
    parsedAssetCache,
    createId: () => 'asset_1',
    nowIso: () => '2026-08-20T00:00:00.000Z'
  });

  try {
    const asset = service.importAssetFromPath('brief', sourcePath);
    parsedAssetCache.set(`${asset.id}:${asset.sha256}`, { parsed: true });

    assert.equal(fs.existsSync(asset.storedPath), true);
    assert.equal(asset.fileSize, Buffer.byteLength('Project brief'));
    assert.deepEqual(service.deleteAsset(asset.id), { ok: true });
    assert.equal(fs.existsSync(asset.storedPath), false);
    assert.equal(parsedAssetCache.size, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
