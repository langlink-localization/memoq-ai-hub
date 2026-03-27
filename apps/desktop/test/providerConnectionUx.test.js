const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getEnabledModelCount,
  getProviderConnectionHelperText,
  isProviderConnectionTestDisabled,
  shouldSuggestModelDiscovery
} = require('../src/renderer/src/providerConnectionUx');

function createTranslator() {
  const values = {
    'providers.testingDraft': 'Testing the current draft...',
    'providers.connectionReady': 'Draft connectivity looks good. You can save now.',
    'providers.compatibleModelRequiredHint': 'Add or discover at least one enabled model for this endpoint before testing.',
    'providers.modelRequiredHint': 'Add at least one enabled model before testing this draft.',
    'providers.compatibleTestBeforeSaveHint': 'Add or discover a model accepted by this endpoint, then test the draft before saving.',
    'providers.testBeforeSaveHint': 'Test the current draft first. Save is enabled only after a successful connectivity check.',
    'providers.testAfterChangesHint': 'Connection-related fields changed after the last test. Test the current draft again before saving.',
    'providers.discoverModelsHint': 'Try Discover Models to load model IDs accepted by this endpoint.'
  };
  return (key) => values[key] || key;
}

test('compatible failed test states surface the provider error and discovery hint', () => {
  const text = getProviderConnectionHelperText({
    provider: {
      type: 'openai-compatible',
      models: [{ modelName: 'gpt-5.4-mini', enabled: true }]
    },
    status: 'failed',
    statusLabel: 'Failed',
    message: '403 Author openai is banned',
    t: createTranslator()
  });

  assert.match(text, /403 Author openai is banned/);
  assert.match(text, /Discover Models/);
});

test('compatible drafts with no enabled model show a model-specific hint', () => {
  const text = getProviderConnectionHelperText({
    provider: {
      type: 'openai-compatible',
      models: []
    },
    status: 'not_tested',
    statusLabel: 'Not tested',
    message: '',
    t: createTranslator()
  });

  assert.equal(text, 'Add or discover at least one enabled model for this endpoint before testing.');
});

test('compatible drafts with no enabled model disable test connection', () => {
  assert.equal(isProviderConnectionTestDisabled({
    type: 'openai-compatible',
    models: []
  }), true);
  assert.equal(isProviderConnectionTestDisabled({
    type: 'openai-compatible',
    models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
  }), false);
  assert.equal(getEnabledModelCount({
    type: 'openai-compatible',
    models: [{ modelName: 'gpt-4.1-mini', enabled: false }]
  }), 0);
});

test('discovery hint detection targets banned-author style failures', () => {
  assert.equal(shouldSuggestModelDiscovery('403 Author openai is banned'), true);
  assert.equal(shouldSuggestModelDiscovery('401 unauthorized'), false);
});

test('drafts that changed after a previous test prompt the user to re-test instead of saying not tested', () => {
  const text = getProviderConnectionHelperText({
    provider: {
      type: 'openai-compatible',
      models: [{ modelName: 'openai/gpt-5.4-mini', enabled: true }]
    },
    status: 'not_tested',
    statusLabel: 'Not tested',
    message: '',
    hasPreviousTest: true,
    t: createTranslator()
  });

  assert.equal(text, 'Connection-related fields changed after the last test. Test the current draft again before saving.');
});
