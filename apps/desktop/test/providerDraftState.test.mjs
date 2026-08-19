import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProviderFingerprint,
  buildProviderModelCatalog,
  buildProviderRequestPreview,
  createDraftProviderModel,
  createProviderDraft,
  getPreferredProviderModel,
  isDraftProvider
} from '../src/renderer/src/providerDraftState.mjs';

test('provider draft state creates provider-family defaults without inventing compatible models', () => {
  const compatible = createProviderDraft('openai-compatible');
  const official = createProviderDraft('openai');

  assert.equal(compatible.requestPath, '/chat/completions');
  assert.deepEqual(compatible.models, []);
  assert.equal(compatible.enabled, true);
  assert.equal(official.requestPath, '/responses');
  assert.equal(official.models[0].modelName, 'gpt-5.4-mini');
});

test('provider draft state owns model selection, discovery catalog, and request preview', () => {
  const first = createDraftProviderModel('model-b');
  const second = { ...createDraftProviderModel('model-a'), enabled: false };
  const provider = {
    type: 'openai-compatible',
    baseUrl: 'https://example.test/v1/',
    requestPath: '/chat/completions',
    defaultModelId: second.id,
    models: [first, second]
  };

  assert.equal(getPreferredProviderModel(provider).id, first.id);
  assert.deepEqual(buildProviderModelCatalog(provider, ['model-c', 'model-a']), ['model-a', 'model-b', 'model-c']);
  assert.equal(buildProviderRequestPreview(provider), 'https://example.test/v1/chat/completions');
});

test('provider draft identity and fingerprints remain deterministic for editor change detection', () => {
  const provider = {
    id: 'draft_provider_1',
    name: 'Provider',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: [{ id: 'model-1', modelName: 'gpt-5.4-mini', enabled: true }]
  };

  assert.equal(isDraftProvider(provider), true);
  assert.equal(buildProviderFingerprint(provider), buildProviderFingerprint(structuredClone(provider)));
  assert.notEqual(buildProviderFingerprint(provider), buildProviderFingerprint({ ...provider, name: 'Changed' }));
});
