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
    glossaryAssetId: 'asset-glossary',
    customTmAssetId: 'asset-custom-tm'
  });
  assert.deepEqual(profile.assetBindings, [
    { assetId: 'asset-glossary', purpose: 'glossary' },
    { assetId: 'asset-custom-tm', purpose: 'custom_tm' }
  ]);
  assert.deepEqual(profile.customTmMatchBuckets, ['101%', '100%', '95-99', '85-94', '75-84']);
});

test('runtimeState keeps QA opt-ins off by default and normalizes project rules', () => {
  const defaults = ensureProfile({});
  assert.equal(defaults.qaRealtimeAiEnabled, false);
  assert.equal(defaults.qaIncludeSummary, false);
  assert.equal(defaults.qaIncludeFullText, false);
  const profile = ensureProfile({ qaRealtimeAiEnabled: true, qaIncludeSummary: true, qaRules: [{ id: 'r', type: 'regex', pattern: 'TODO', severity: 'major', category: 'style' }] });
  assert.equal(profile.qaRealtimeAiEnabled, true);
  assert.equal(profile.qaRules[0].id, 'r');
});

test('runtimeState normalizes custom TM match bucket selections', () => {
  assert.deepEqual(ensureProfile({ customTmMatchBuckets: ['95-99', 'invalid', '95-99', '<75'] }).customTmMatchBuckets, ['95-99', '<75']);
  assert.deepEqual(ensureProfile({ customTmMatchBuckets: [] }).customTmMatchBuckets, ['101%', '100%', '95-99', '85-94', '75-84']);
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
    capabilities: { responseFormat: 'json-object', throughputMode: 'fast', normalizedConfidenceScore: true },
    models: [{ modelName: 'custom-model', concurrencyLimit: 0, retryAttempts: -1, responseFormat: 'text', throughputMode: 'custom', maxBatchSegments: 12, maxBatchCharacters: 24000, providerConcurrency: 2, contextWindowTokens: 256000, maxOutputTokens: 8192 }]
  });
  const openaiProvider = ensureProvider({
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: [{ modelName: 'gpt-5.4-mini' }]
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
  assert.equal(provider.capabilities.throughputMode, 'fast');
  assert.equal(provider.capabilities.normalizedConfidenceScore, true);
  assert.equal(provider.models[0].responseFormat, 'text');
  assert.equal(provider.models[0].throughputMode, 'custom');
  assert.equal(provider.models[0].maxBatchSegments, 12);
  assert.equal(provider.models[0].maxBatchCharacters, 24000);
  assert.equal(provider.models[0].providerConcurrency, 2);
  assert.equal(provider.models[0].contextWindowTokens, 256000);
  assert.equal(provider.models[0].maxOutputTokens, 8192);
  assert.equal(provider.models[0].concurrencyLimit, 1);
  assert.equal(openaiProvider.models[0].concurrencyLimit, 2);
  assert.equal(provider.models[0].retryAttempts, 2);
  assert.equal(rule.ruleName, 'New Rule');
  assert.equal(rule.priority, 99);
  assert.equal(asset.fileSize, 12);
  assert.deepEqual(asset.tbManualMapping, { srcColumn: 'Source', tgtColumn: 'Target' });
  assert.deepEqual(asset.tbLanguagePair, { source: 'EN', target: 'ZH' });
  assert.equal(integration.memoqVersion, '11');
  assert.equal(integration.customInstallDir, 'C:\\memoQ');
});
