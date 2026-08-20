const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createRuntime } = require('../src/runtime/runtime');
const { buildPrompt } = require('../src/provider/providerPromptBuilder');
const { normalizePromptPresets, validatePromptPreset } = require('../src/shared/promptPresets');

function createMemorySecretStore() {
  const values = new Map();
  return {
    has: (id) => values.has(id),
    get: async (id) => values.get(id) || '',
    set: async (id, value) => values.set(id, String(value || '')),
    delete: async (id) => values.delete(id)
  };
}

test('prompt preset normalization seeds built-ins and preserves edited built-ins', () => {
  const seeded = normalizePromptPresets([]);
  assert.ok(seeded.some((item) => item.scope === 'qa'));
  assert.ok(seeded.some((item) => item.scope === 'translate'));
  assert.ok(seeded.some((item) => item.scope === 'polish'));

  const edited = normalizePromptPresets([{ ...seeded[0], name: 'Edited QA' }]);
  assert.equal(edited.find((item) => item.id === seeded[0].id).name, 'Edited QA');
  assert.throws(() => validatePromptPreset({
    name: 'Invalid', scope: 'qa', systemPrompt: '{{glossary-text}}', userPrompt: '{{source-text}}'
  }), /cannot use/i);
});

test('runtime requires an explicit complete secret adapter', async () => {
  await assert.rejects(() => createRuntime({}), /complete secretStore adapter is required/);
  await assert.rejects(() => createRuntime({ secretStore: { has() {} } }), /complete secretStore adapter is required/);
});

test('runtime exposes prompt preset CRUD and QA resolves preset templates and rules', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-prompt-presets-'));
  let qaRequest = null;
  const runtime = await createRuntime({
    appDataRoot: tempRoot,
    secretStore: createMemorySecretStore(),
    providerRegistry: {
      testConnection: async () => ({ ok: true, latencyMs: 1, message: 'ok' }),
      checkQuality: async (payload) => {
        qaRequest = payload;
        return { output: JSON.stringify({ findings: [] }), latencyMs: 2 };
      }
    }
  });
  try {
    const initial = runtime.getAppState({ includeHistoryExplorer: false }).promptPresets;
    assert.ok(initial.length >= 6);
    const custom = runtime.savePromptPreset({
      name: 'Custom QA', scope: 'qa', style: '',
      systemPrompt: 'Review {{source-language}} to {{target-language}}.',
      userPrompt: 'Source: {{source-text}}\nTarget: {{target-text}}',
      rules: [{ instruction: 'Check the requested brand voice.' }]
    });
    const provider = await runtime.saveProvider({ name: 'QA Provider', type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'test-key', models: [{ modelName: 'qa-model', enabled: true }] });
    const profile = await runtime.saveProfile({ name: 'QA Profile', providerId: provider.id });
    await runtime.checkQaSegment({
      profileId: profile.id,
      segment: { source: 'Hello', target: 'Bonjour' },
      document: { id: 'preset-doc', name: 'Preset doc' },
      languages: { source: 'en', target: 'fr' },
      prompt: { presetId: custom.id, additionalInstruction: 'Check grammar.' },
      ai: { enabled: true, providerId: provider.id, model: provider.models[0].id }
    });
    assert.equal(qaRequest.promptTemplate.systemPrompt, custom.systemPrompt);
    assert.ok(qaRequest.naturalLanguageRules.some((item) => /brand voice/.test(item.instruction)));
    assert.equal(qaRequest.additionalInstruction, 'Check grammar.');

    const copy = runtime.savePromptPreset({ ...custom, id: '', name: 'Custom QA Copy' });
    assert.notEqual(copy.id, custom.id);
    assert.equal(runtime.deletePromptPreset(copy.id).deleted, true);
    const restored = runtime.restoreBuiltinPromptPreset('builtin-qa-default');
    assert.equal(restored.builtin, true);
  } finally {
    runtime.dispose?.();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('assistant additional instructions are isolated in the stable system prompt', () => {
  const result = buildPrompt({
    sourceLanguage: 'en', targetLanguage: 'fr', sourceText: 'Hello', requestType: 'Plaintext',
    profile: { assistantAdditionalInstruction: 'Use a concise formal register.' }
  });
  assert.match(result.systemPrompt, /## Additional Instructions/);
  assert.match(result.systemPrompt, /Use a concise formal register/);
});
