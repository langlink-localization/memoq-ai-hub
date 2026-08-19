import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getProviderTypeLabel,
  getStatusTagMeta,
  normalizeProviderFilterText
} from '../src/renderer/src/pages/providers/providerPresentation.mjs';

const t = (key) => key;

test('provider presentation normalizes connection status tags', () => {
  assert.deepEqual(getStatusTagMeta('healthy', t), {
    color: 'green',
    label: 'providers.statusConnected'
  });
  assert.deepEqual(getStatusTagMeta('failed', t), {
    color: 'red',
    label: 'providers.statusFailed'
  });
  assert.deepEqual(getStatusTagMeta('unknown', t), {
    color: 'default',
    label: 'providers.statusNotTested'
  });
});

test('provider presentation owns type labels and case-insensitive search text', () => {
  assert.equal(getProviderTypeLabel('openai', t), 'providers.typeOpenAI');
  assert.equal(getProviderTypeLabel('openai-compatible', t), 'providers.typeOpenAICompatible');
  assert.equal(getProviderTypeLabel('custom', t), 'providers.typeCustom');
  assert.equal(normalizeProviderFilterText('  GPT Model  '), 'gpt model');
});
