const test = require('node:test');
const assert = require('node:assert/strict');

const { getProviderDraftSeed } = require('../src/renderer/src/providerDraftDefaults');

test('compatible provider drafts avoid OpenAI-native model defaults', () => {
  const seed = getProviderDraftSeed('openai-compatible');

  assert.equal(seed.requestPath, '/chat/completions');
  assert.deepEqual(seed.modelNames, []);
});

test('official openai drafts keep the official default model', () => {
  const seed = getProviderDraftSeed('openai');

  assert.equal(seed.requestPath, '/responses');
  assert.deepEqual(seed.modelNames, ['gpt-5.4-mini']);
});
