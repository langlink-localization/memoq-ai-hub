const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ensureProfile,
  ensureProvider,
  ensureRule,
  ensureAsset,
  ensureIntegrationPreferences,
  normalizeState
} = require('../src/runtime/runtimeState');

test('runtimeState maps role-based asset selections into legacy bindings', () => {
  const profile = ensureProfile({
    name: 'Asset Selection Profile',
    assetSelections: {
      glossaryAssetId: 'asset-glossary',
      customTmAssetId: 'asset-custom-tm',
      briefAssetId: 'asset-brief'
    }
  });

  assert.deepEqual(profile.assetSelections, {
    glossaryAssetId: 'asset-glossary'
  });
  assert.deepEqual(profile.assetBindings, [
    { assetId: 'asset-glossary', purpose: 'glossary' }
  ]);
});

test('runtimeState removes profile provider bindings that point to unsupported providers', () => {
  const normalized = normalizeState({
    profiles: [{
      id: 'profile-1',
      name: 'Profile',
      providerId: 'removed-provider',
      interactiveProviderId: 'removed-provider',
      interactiveModelId: 'model-1',
      fallbackProviderId: 'kept-provider',
      fallbackModelId: 'model-2'
    }],
    providers: [
      { id: 'removed-provider', type: 'unsupported-provider' },
      { id: 'kept-provider', type: 'openai', baseUrl: 'https://api.openai.com/v1', models: [{ id: 'model-2', modelName: 'gpt-4.1-mini' }] }
    ],
    defaultProfileId: 'profile-1'
  });

  assert.equal(normalized.providers.length, 1);
  assert.equal(normalized.providers[0].id, 'kept-provider');
  assert.equal(normalized.profiles[0].providerId, '');
  assert.equal(normalized.profiles[0].interactiveProviderId, '');
  assert.equal(normalized.profiles[0].interactiveModelId, '');
  assert.equal(normalized.profiles[0].fallbackProviderId, 'kept-provider');
  assert.equal(normalized.profiles[0].fallbackModelId, 'model-2');
  assert.equal(normalized.defaultProfileId, 'profile-1');
});

test('runtimeState normalizes providers, rules, assets, and integration preferences with stable defaults', () => {
  const provider = ensureProvider({
    id: 'provider-1',
    type: 'openai-compatible',
    baseUrl: 'https://example.com',
    requestPath: 'chat/completions',
    capabilities: { responseFormat: 'json-object' },
    models: [{ modelName: 'custom-model', concurrencyLimit: 0, retryAttempts: -1, responseFormat: 'text' }]
  });
  const rule = ensureRule({ ruleName: '  ', priority: 'not-a-number' });
  const asset = ensureAsset({
    id: 'asset-1',
    type: 'glossary',
    name: 'Glossary',
    fileSize: '12',
    tbManualMapping: { srcColumn: ' Source ', tgtColumn: ' Target ' },
    tbLanguagePair: { source: ' EN ', target: ' ZH ' }
  });
  const integration = ensureIntegrationPreferences({ memoqVersion: '99', customInstallDir: ' C:\\memoQ ' });

  assert.equal(provider.requestPath, '/chat/completions');
  assert.equal(provider.capabilities.responseFormat, 'json_object');
  assert.equal(provider.models[0].responseFormat, 'text');
  assert.equal(provider.models[0].concurrencyLimit, 1);
  assert.equal(provider.models[0].retryAttempts, 2);
  assert.equal(rule.ruleName, 'New Rule');
  assert.equal(rule.priority, 99);
  assert.equal(asset.fileSize, 12);
  assert.deepEqual(asset.tbManualMapping, { srcColumn: 'Source', tgtColumn: 'Target' });
  assert.deepEqual(asset.tbLanguagePair, { source: 'EN', target: 'ZH' });
  assert.equal(integration.memoqVersion, '11');
  assert.equal(integration.customInstallDir, 'C:\\memoQ');
});
