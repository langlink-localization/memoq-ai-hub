const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const providerRegistryModulePath = require.resolve('../src/provider/providerRegistry');

class DefaultOpenAI {
  constructor() {
    this.responses = { create: async () => ({ output_text: 'OK' }) };
    this.chat = {
      completions: {
        create: async () => ({ choices: [{ message: { content: 'OK' } }] })
      }
    };
    this.models = { list: async () => ({ data: [] }) };
  }
}

DefaultOpenAI.OpenAI = DefaultOpenAI;
DefaultOpenAI.default = DefaultOpenAI;

function createProviderRegistry(options = {}) {
  return withMockedModules({ openai: DefaultOpenAI }, (providerRegistryModule) => (
    providerRegistryModule.createProviderRegistry(options)
  ));
}

function parseBatchTranslations(...args) {
  return withMockedModules({ openai: DefaultOpenAI }, (providerRegistryModule) => (
    providerRegistryModule.parseBatchTranslations(...args)
  ));
}

function createPromptCacheKey(...args) {
  return withMockedModules({ openai: DefaultOpenAI }, (providerRegistryModule) => (
    providerRegistryModule.createPromptCacheKey(...args)
  ));
}

function withMockedModules(mockedModules, callback) {
  const originalLoad = Module._load;
  delete require.cache[providerRegistryModulePath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mockedModules, request)) {
      return mockedModules[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return callback(require(providerRegistryModulePath));
  } finally {
    Module._load = originalLoad;
    delete require.cache[providerRegistryModulePath];
  }
}

function createMockOpenAI(overrides = {}) {
  const calls = {
    constructs: [],
    responses: [],
    chats: [],
    models: []
  };

  class MockOpenAI {
    constructor(config = {}) {
      calls.constructs.push(config);

      const handleResponses = async (request, requestOptions) => {
        calls.responses.push({ config, request, requestOptions });
        return overrides.responsesCreate
          ? overrides.responsesCreate(request, config, requestOptions)
          : { output_text: 'OK' };
      };

      this.responses = {
        create: handleResponses,
        parse: handleResponses
      };
      this.chat = {
        completions: {
          create: async (request, requestOptions) => {
            calls.chats.push({ config, request, requestOptions });
            return overrides.chatCreate
              ? overrides.chatCreate(request, config, requestOptions)
              : {
                choices: [
                  { message: { content: 'OK' } }
                ]
              };
          }
        }
      };
      this.models = {
        list: async (params, requestOptions) => {
          calls.models.push({ config, params, requestOptions });
          return overrides.modelsList
            ? overrides.modelsList(config, params, requestOptions)
            : { data: [] };
        }
      };
    }
  }

  MockOpenAI.OpenAI = MockOpenAI;
  MockOpenAI.default = MockOpenAI;

  return { MockOpenAI, calls };
}

test('provider registry sanitizeProvider applies provider defaults', () => {
  const registry = createProviderRegistry();
  const provider = registry.sanitizeProvider({ type: 'openai-compatible', baseUrl: '', models: [] });

  assert.equal(provider.type, 'openai-compatible');
  assert.match(provider.baseUrl, /api\.openai\.com/);
});

test('provider registry testConnection reports success with the current openai client path', async () => {
  const { MockOpenAI, calls } = createMockOpenAI();

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.testConnection({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
      apiKey: 'test-key',
      modelName: 'gpt-4.1-mini',
      timeoutMs: 1000
    });

    assert.equal(result.ok, true);
    assert.equal(result.message, 'Connection test succeeded.');
    assert.equal(calls.responses.length, 1);
    assert.equal(calls.responses[0].request.model, 'gpt-4.1-mini');
    assert.equal(calls.constructs[0].baseURL, 'https://api.openai.com/v1');
  });
});

test('provider registry maps legacy request types to the new formatting semantics', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({ output_text: '```html\n<p>Hello</p>\n```' })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.translateSegment({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceText: 'Hello',
      tmSource: '',
      tmTarget: '',
      metadata: {},
      profile: {},
      requestType: 'Html'
    });

    assert.match(calls.responses[0].request.instructions, /Preserve formatting tags and inline structure exactly\./);
    assert.equal(result.text, '<p>Hello</p>');
  });
});

test('provider registry strips markup from plaintext responses', async () => {
  const { MockOpenAI } = createMockOpenAI({
    responsesCreate: async () => ({ output_text: '<b>Hello</b>' })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.translateSegment({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceText: 'Hello',
      tmSource: '',
      tmTarget: '',
      metadata: {},
      profile: {},
      requestType: 'Plaintext'
    });

    assert.equal(result.text, 'Hello');
  });
});

test.skip('provider registry builds structured metadata prompts instead of raw metadata json', async () => {
  const prompts = [];
  const registry = createProviderRegistry({
    sdkLoader: async () => ({
      generateText: async (request) => {
        prompts.push(request.prompt);
        return { text: 'Bonjour' };
      },
      createOpenAI: () => (modelName) => ({ modelName }),
      createGoogleGenerativeAI: () => (modelName) => ({ modelName })
    })
  });

  await registry.translateSegment({
    provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
    apiKey: 'test',
    modelName: 'gpt-4.1-mini',
    sourceText: 'Hello',
    tmSource: 'Hello',
    tmTarget: 'Bonjour',
    metadata: {
      PorjectID: 'PRJ-1',
      client: 'ACME',
      domain: 'Legal',
      documentId: 'DOC-1',
      projectGuid: 'GUID-1'
    },
    profile: { useMetadata: true, useBestFuzzyTm: true },
    requestType: 'Plaintext'
  });

  assert.match(prompts[0], /Project context:/);
  assert.match(prompts[0], /Project ID: PRJ-1/);
  assert.match(prompts[0], /Client: ACME/);
  assert.match(prompts[0], /Translation memory hints:/);
  assert.doesNotMatch(prompts[0], /Metadata:\s*\{/);
});

test.skip('provider registry includes preview-context sections when enabled', async () => {
  const prompts = [];
  const registry = createProviderRegistry({
    sdkLoader: async () => ({
      generateText: async (request) => {
        prompts.push(request.prompt);
        return { text: 'Bonjour' };
      },
      createOpenAI: () => (modelName) => ({ modelName }),
      createGoogleGenerativeAI: () => (modelName) => ({ modelName })
    })
  });

  await registry.translateSegment({
    provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
    apiKey: 'test',
    modelName: 'gpt-4.1-mini',
    sourceText: 'Hello',
    tmSource: '',
    tmTarget: '',
    metadata: { documentId: 'DOC-1' },
    previewContext: { documentName: 'Guide', summary: 'User manual for setup.' },
    segmentPreviewContext: {
      targetText: '旧译文',
      above: 'Install the app.',
      below: 'Restart the service.',
      aboveSourceText: 'Install the app.',
      belowSourceText: 'Restart the service.',
      aboveTargetText: '',
      belowTargetText: ''
    },
    profile: {
      useMetadata: true,
      usePreviewContext: true,
      usePreviewSummary: true,
      usePreviewTargetText: true,
      usePreviewAboveBelow: true
    },
    requestType: 'Plaintext'
  });

  assert.match(prompts[0], /Preview document context:/);
  assert.match(prompts[0], /Document name: Guide/);
  assert.match(prompts[0], /## Document Context[\s\S]*Summary: User manual for setup\./);
  assert.match(prompts[0], /Current target text: 旧译文/);
  assert.match(prompts[0], /Above source context:\s*Install the app\./);
  assert.match(prompts[0], /Below source context:\s*Restart the service\./);
  assert.doesNotMatch(prompts[0], /current target segments/i);
});

test('provider registry renders prompt placeholders for single-segment translation', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: { translation: 'Bonjour' },
      output_text: 'Bonjour'
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await registry.translateSegment({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      sourceText: 'Hello',
      tmSource: 'Hello',
      tmTarget: 'Bonjour',
      metadata: {},
      previewContext: { summary: 'A greeting section.' },
      segmentPreviewContext: { targetText: 'Salut' },
      profile: {
        systemPrompt: 'Translate from {{source-language}} to {{target-language}}.',
        userPrompt: 'Source={{source-text}} TM={{tm-target-text}} Current={{target-text}} Summary={{summary-text}}'
      },
      requestType: 'Plaintext'
    });
  });

  assert.match(calls.responses[0].request.instructions, /Translate from EN to FR\./);
  assert.match(calls.responses[0].request.instructions, /## Document Context[\s\S]*Summary: A greeting section\./);
  assert.match(calls.responses[0].request.input, /"sharedInstructions": \{\s+"profileInstructions": "Source=Hello TM=Bonjour Current=Salut Summary=A greeting section\."/);
});

test('provider registry injects profile translation style into the stable system prompt', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: {
        translations: [{ index: 0, text: 'Bonjour' }]
      },
      output_text: '{"translations":[{"index":0,"text":"Bonjour"}]}'
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await registry.translateSegment({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      sourceText: 'Hello',
      tmSource: '',
      tmTarget: '',
      metadata: {},
      profile: {
        translationStyle: 'Use concise UI copy with stable product terminology.'
      },
      requestType: 'Plaintext'
    });
  });

  assert.match(calls.responses[0].request.instructions, /## Translation Style[\s\S]*Use concise UI copy with stable product terminology\./);
  assert.match(calls.responses[0].request.input, /"sharedInstructions": \{\s+"profileInstructions": ""\s+\}/);
});

test('provider registry renders glossary, brief, and custom TM placeholders', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: { translation: 'Bonjour' },
      output_text: 'Bonjour'
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await registry.translateSegment({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      sourceText: 'Install now',
      tmSource: 'Install now',
      tmTarget: 'Installez maintenant',
      metadata: {},
      previewContext: { summary: 'Install flow.' },
      profile: {
        useCustomTm: true,
        userPrompt: '[Glossary:\n]{{glossary-text}}[\nEnd glossary]\n[TB:\n]{{tb-metadata-text}}[\nEnd TB]\n[Brief:\n]{{brief-text}}[\nEnd brief]\nCustom={{custom-tm-target-text}}'
      },
      assetContext: {
        glossaryText: 'Required terminology:\n- "install" => "installer"',
        tbMetadataText: 'TB language pair: EN -> FR\nEntry domain: Setup',
        briefText: 'Use imperative voice.'
      },
      requestType: 'Plaintext'
    });
  });

  assert.match(calls.responses[0].request.input, /"sharedInstructions": \{\s+"profileInstructions": "Glossary:\\nRequired terminology:/);
  assert.match(calls.responses[0].request.input, /\\"install\\" => \\"installer\\"/);
  assert.match(calls.responses[0].request.input, /TB language pair: EN -> FR/);
  assert.match(calls.responses[0].request.input, /Entry domain: Setup/);
  assert.match(calls.responses[0].request.input, /Use imperative voice\./);
  assert.match(calls.responses[0].request.input, /Custom=Installez maintenant/);
});

test('provider registry renders per-segment TB instructions in batch mode', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: {
        translations: [
          { index: 0, text: '工作区' },
          { index: 1, text: '偏好设置' }
        ]
      },
      output_text: JSON.stringify({
        translations: [
          { index: 0, text: '工作区' },
          { index: 1, text: '偏好设置' }
        ]
      })
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await registry.translateBatch({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      segments: [
        {
          index: 0,
          sourceText: 'workspace',
          tmSource: '',
          tmTarget: '',
          tbContext: { glossaryText: 'Required terminology:\n- "workspace" => "工作区"' }
        },
        {
          index: 1,
          sourceText: 'Preferences',
          tmSource: '',
          tmTarget: '',
          tbContext: { glossaryText: 'Required terminology:\n- "Preferences" => "偏好设置"' }
        }
      ],
      metadata: {},
      profile: {
        userPrompt: '{{glossary-text}}'
      },
      requestType: 'Plaintext',
      assetContext: {}
    });
  });

  assert.match(calls.responses[0].request.input, /workspace\\" => \\"工作区/);
  assert.match(calls.responses[0].request.input, /Preferences\\" => \\"偏好设置/);
});

test('provider registry emits tm hints and terminology as structured per-segment payload data', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: { translation: 'Bonjour' },
      output_text: 'Bonjour'
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await registry.translateSegment({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      sourceText: 'Restart workspace',
      tmSource: 'Restart workspace',
      tmTarget: 'Redemarrer l’espace de travail',
      metadata: {},
      profile: {
        userPrompt: '{{source-text}}'
      },
      tbContext: {
        glossaryText: 'Required terminology:\n- "workspace" => "espace de travail"',
        tbMetadataText: 'TB language pair: EN -> FR',
        termHits: [
          { entryId: 'tb-1', sourceTerm: 'workspace', targetTerm: 'espace de travail', forbidden: false }
        ]
      },
      requestType: 'Plaintext'
    });
  });

  assert.match(calls.responses[0].request.input, /"tmHints":\s*\{\s*"sourceText":\s*"Restart workspace"/);
  assert.match(calls.responses[0].request.input, /"tmHints":\s*\{[\s\S]*"targetText":\s*"Redemarrer l’espace de travail"/);
  assert.match(calls.responses[0].request.input, /"terminology":\s*\{\s*"instructions":\s*"Required terminology:/);
  assert.match(calls.responses[0].request.input, /"matches":\s*\[[\s\S]*"sourceTerm":\s*"workspace"/);
  assert.doesNotMatch(calls.responses[0].request.instructions, /Required terminology:/);
  assert.doesNotMatch(calls.responses[0].request.instructions, /Redemarrer l’espace de travail/);
});

test('provider registry removes wrapped glossary and brief sections when empty', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: { translation: 'Bonjour' },
      output_text: 'Bonjour'
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await registry.translateSegment({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceText: 'Hello',
      tmSource: '',
      tmTarget: '',
      metadata: {},
      profile: {
        userPrompt: '[Glossary:\n]{{glossary-text}}[\nEnd glossary][Brief:\n]{{brief-text}}[\nEnd brief]'
      },
      assetContext: {},
      requestType: 'Plaintext'
    });
  });

  assert.doesNotMatch(calls.responses[0].request.input, /Glossary:/);
  assert.doesNotMatch(calls.responses[0].request.input, /Brief:/);
});

test('provider registry attaches provider-side prompt cache fields when enabled', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: { translation: 'Bonjour' },
      output_text: 'Bonjour',
      usage: { prompt_tokens_details: { cached_tokens: 12 } }
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.translateSegment({
      provider: { id: 'provider-1', type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      sourceText: 'Hello',
      tmSource: '',
      tmTarget: '',
      metadata: {},
      profile: {},
      requestType: 'Plaintext',
      requestOptions: {
        providerPromptCacheEnabled: true,
        promptCacheTtlHint: '24h'
      }
    });

    assert.equal(calls.responses[0].request.prompt_cache_retention, '24h');
    assert.ok(calls.responses[0].request.prompt_cache_key);
    assert.equal(result.promptCache.layer, 'provider');
    assert.equal(result.promptCache.hit, true);
  });
});

test('provider registry uses local prompt cache for identical rendered requests', async () => {
  let providerCalls = 0;
  const localCache = new Map();
  const { MockOpenAI } = createMockOpenAI({
    responsesCreate: async () => {
      providerCalls += 1;
      return {
        output_parsed: { translation: 'Bonjour' },
        output_text: 'Bonjour'
      };
    }
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();
    const baseRequest = {
      provider: { id: 'provider-1', type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      sourceText: 'Hello',
      tmSource: '',
      tmTarget: '',
      metadata: {},
      profile: {},
      requestType: 'Plaintext',
      requestOptions: {
        readPromptCache: (key) => localCache.get(key) || '',
        writePromptCache: (key, text) => localCache.set(key, text),
        localPromptCacheEnabled: true
      }
    };

    const first = await registry.translateSegment(baseRequest);
    const second = await registry.translateSegment(baseRequest);

    assert.equal(providerCalls, 1);
    assert.equal(first.promptCache.layer, 'none');
    assert.equal(second.promptCache.layer, 'local');
    assert.equal(second.promptCache.hit, true);
  });
});

test('createPromptCacheKey changes when rendered prompt content changes', () => {
  const provider = { id: 'provider-1', type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' };
  const first = createPromptCacheKey({
    provider,
    modelName: 'gpt-4.1-mini',
    requestType: 'Plaintext',
    sourceLanguage: 'EN',
    targetLanguage: 'FR',
    systemPrompt: 'System',
    prompt: 'Hello'
  });
  const second = createPromptCacheKey({
    provider,
    modelName: 'gpt-4.1-mini',
    requestType: 'Plaintext',
    sourceLanguage: 'EN',
    targetLanguage: 'FR',
    systemPrompt: 'System',
    prompt: 'Hello again'
  });

  assert.notEqual(first, second);
});

test('provider registry renders per-segment prompt placeholders in batch mode', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: {
        translations: [
          { index: 0, text: 'A' },
          { index: 1, text: 'B' }
        ]
      },
      output_text: '{"translations":[{"index":0,"text":"A"},{"index":1,"text":"B"}]}'
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await registry.translateBatch({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      profile: {
        useBestFuzzyTm: true,
        promptTemplates: {
          batch: {
            userPrompt: 'Translate {{source-text}} with TM {{tm-target-text}}.'
          }
        }
      },
      requestType: 'Plaintext',
      metadata: {},
      segments: [
        { index: 0, sourceText: 'Hello', tmSource: 'Hello', tmTarget: '你好', segmentMetadata: { segmentIndex: 0 } },
        { index: 1, sourceText: 'World', tmSource: 'World', tmTarget: '世界', segmentMetadata: { segmentIndex: 1 } }
      ]
    });
  });

  assert.match(calls.responses[0].request.input, /"profileInstructions": "Translate Hello with TM 你好\."/, 'batch prompt should include rendered instructions for segment 0');
  assert.match(calls.responses[0].request.input, /"profileInstructions": "Translate World with TM 世界\."/, 'batch prompt should include rendered instructions for segment 1');
});

test('provider registry prefers single prompt templates for single translations', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: { translation: 'Bonjour' },
      output_text: 'Bonjour'
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await registry.translateSegment({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      sourceText: 'Hello',
      tmSource: '',
      tmTarget: '',
      metadata: {},
      profile: {
        systemPrompt: 'Legacy single system',
        userPrompt: 'Legacy single {{source-text}}',
        promptTemplates: {
          single: {
            systemPrompt: 'Single system prompt {{target-language}}',
            userPrompt: 'Single prompt {{source-text}}'
          },
          batch: {
            systemPrompt: 'Batch system prompt',
            userPrompt: 'Batch prompt {{source-text}}'
          }
        }
      },
      requestType: 'Plaintext'
    });
  });

  assert.match(calls.responses[0].request.instructions, /Single system prompt FR/);
  assert.match(calls.responses[0].request.input, /"sharedInstructions": \{\s+"profileInstructions": "Single prompt Hello"/);
  assert.doesNotMatch(calls.responses[0].request.instructions, /Legacy single/);
  assert.doesNotMatch(calls.responses[0].request.instructions, /Batch system prompt/);
});

test('provider registry renders custom TM placeholders in batch mode', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: {
        translations: [
          { index: 0, text: 'A' },
          { index: 1, text: 'B' }
        ]
      },
      output_text: '{"translations":[{"index":0,"text":"A"},{"index":1,"text":"B"}]}'
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await registry.translateBatch({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceLanguage: 'EN',
      targetLanguage: 'DE',
      profile: {
        useCustomTm: true,
        promptTemplates: {
          batch: {
            userPrompt: 'Custom={{custom-tm-source-text}} => {{custom-tm-target-text}}'
          }
        }
      },
      requestType: 'Plaintext',
      metadata: {},
      segments: [
        { index: 0, sourceText: 'Hello', tmSource: 'Hello', tmTarget: 'Hallo', segmentMetadata: { segmentIndex: 0 } },
        { index: 1, sourceText: 'World', tmSource: 'World', tmTarget: 'Welt', segmentMetadata: { segmentIndex: 1 } }
      ]
    });
  });

  assert.match(calls.responses[0].request.input, /"profileInstructions": "Custom=Hello => Hallo"/);
  assert.match(calls.responses[0].request.input, /"profileInstructions": "Custom=World => Welt"/);
});

test('provider registry hoists identical batch profile instructions into shared instructions', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: {
        translations: [
          { index: 0, text: 'A' },
          { index: 1, text: 'B' }
        ]
      },
      output_text: '{"translations":[{"index":0,"text":"A"},{"index":1,"text":"B"}]}'
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await registry.translateBatch({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceLanguage: 'EN',
      targetLanguage: 'DE',
      segments: [
        { index: 0, sourceText: 'Hello', tmSource: '', tmTarget: '' },
        { index: 1, sourceText: 'World', tmSource: '', tmTarget: '' }
      ],
      metadata: {},
      profile: {
        promptTemplates: {
          batch: {
            userPrompt: 'Use concise UI style.'
          }
        }
      },
      requestType: 'Plaintext',
      assetContext: {}
    });
  });

  assert.match(calls.responses[0].request.input, /"sharedInstructions": \{\s+"profileInstructions": "Use concise UI style\."/);
  assert.doesNotMatch(calls.responses[0].request.input, /"segments": \[[\s\S]*"profileInstructions": "Use concise UI style\./);
});

test('provider registry prefers batch prompt templates when batch-specific prompts are configured', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: {
        translations: [
          { index: 0, text: 'A' },
          { index: 1, text: 'B' }
        ]
      },
      output_text: '{"translations":[{"index":0,"text":"A"},{"index":1,"text":"B"}]}'
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await registry.translateBatch({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      profile: {
        systemPrompt: 'Legacy single system',
        userPrompt: 'Legacy single {{source-text}}',
        promptTemplates: {
          single: {
            systemPrompt: 'Single system prompt',
            userPrompt: 'Single prompt {{source-text}}'
          },
          batch: {
            systemPrompt: 'Batch system prompt {{target-language}}',
            userPrompt: 'Batch prompt {{source-text}} => {{tm-target-text}}'
          }
        },
        useBestFuzzyTm: true
      },
      requestType: 'Plaintext',
      metadata: {},
      segments: [
        { index: 0, sourceText: 'Hello', tmSource: 'Hello', tmTarget: '你好', segmentMetadata: { segmentIndex: 0 } },
        { index: 1, sourceText: 'World', tmSource: 'World', tmTarget: '世界', segmentMetadata: { segmentIndex: 1 } }
      ]
    });
  });

  assert.match(calls.responses[0].request.instructions, /Batch system prompt ZH/);
  assert.match(calls.responses[0].request.input, /"profileInstructions": "Batch prompt Hello => 你好"/);
  assert.doesNotMatch(calls.responses[0].request.input, /Legacy single/);
});

test('provider registry injects preview context sections when enabled', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: { translation: 'Bonjour' },
      output_text: 'Bonjour'
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await registry.translateSegment({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceText: 'Second sentence.',
      tmSource: '',
      tmTarget: '',
      metadata: {},
      previewContext: {
        activePreviewPartId: 'part-b',
        sourceDocument: { documentName: 'Guide' },
        fullText: 'First sentence.\nSecond sentence.\nThird sentence.',
        summary: 'Current source: Second sentence.'
      },
      segmentPreviewContext: {
        previewPartId: 'part-b',
        targetText: '第二句。',
        above: 'First sentence.',
        below: 'Third sentence.',
        aboveSourceText: 'First sentence.',
        belowSourceText: 'Third sentence.',
        aboveTargetText: '',
        belowTargetText: ''
      },
      profile: {
        usePreviewContext: true,
        usePreviewFullText: true,
        usePreviewSummary: true,
        usePreviewAboveBelow: true,
        usePreviewTargetText: true
      },
      requestType: 'Plaintext'
    });
  });

  assert.match(calls.responses[0].request.instructions, /## Document Context[\s\S]*Summary: Current source: Second sentence\./);
  assert.match(calls.responses[0].request.input, /"documentName": "Guide"/);
  assert.doesNotMatch(calls.responses[0].request.input, /"summary": "Current source: Second sentence\."/);
  assert.match(calls.responses[0].request.input, /"targetText": "第二句。"/);
  assert.doesNotMatch(calls.responses[0].request.input, /current target segments/i);
});

test('provider registry translateBatch validates and returns indexed translations', async () => {
  const { MockOpenAI } = createMockOpenAI({
    responsesCreate: async () => ({ output_text: '{"translations":[{"index":1,"text":"B"},{"index":0,"text":"A"}]}' })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.translateBatch({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      profile: { useMetadata: true, useBestFuzzyTm: true },
      requestType: 'Plaintext',
      metadata: { projectId: 'PRJ-1' },
      segments: [
        { index: 0, sourceText: 'Hello', tmSource: '', tmTarget: '', segmentMetadata: { segmentIndex: 0 } },
        { index: 1, sourceText: 'World', tmSource: '', tmTarget: '', segmentMetadata: { segmentIndex: 1 } }
      ]
    });

    assert.deepEqual(result.translations, [
      { index: 0, text: 'A' },
      { index: 1, text: 'B' }
    ]);
    assert.equal(result.requestMetadata.mode, 'batch');
    assert.deepEqual(result.requestMetadata.batchIndexes, [0, 1]);
    assert.match(result.requestMetadata.userPrompt, /"schemaVersion": "structured-v2"/);
    assert.equal(result.requestMetadata.items.length, 2);
    assert.equal(result.requestMetadata.items[0].sourceText, 'Hello');
  });
});

test('parseBatchTranslations rejects duplicate or missing indices', () => {
  assert.throws(
    () => parseBatchTranslations('{"translations":[{"index":0,"text":"A"},{"index":0,"text":"B"}]}', 'Plaintext', [0, 1]),
    /duplicate index/i
  );
  assert.throws(
    () => parseBatchTranslations('{"translations":[{"index":0,"text":"A"}]}', 'Plaintext', [0, 1]),
    /expected 2/i
  );
  assert.throws(
    () => parseBatchTranslations('{"translations":[{"index":0,"text":"A"},{"index":2,"text":"B"}]}', 'Plaintext', [0, 1]),
    /was not requested/i
  );
});

test('provider registry rejects malformed api keys before calling the SDK', async () => {
  let sdkCalled = false;
  const registry = createProviderRegistry({
    sdkLoader: async () => ({
      generateText: async () => ({ text: 'OK' }),
      createOpenAI: () => {
        sdkCalled = true;
        return () => ({});
      },
      createGoogleGenerativeAI: () => {
        sdkCalled = true;
        return () => ({});
      }
    })
  });

  const result = await registry.testConnection({
    provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
    apiKey: 'sk-test-\uFFFD-bad',
    modelName: 'gpt-4.1-mini',
    timeoutMs: 1000
  });

  assert.equal(sdkCalled, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PROVIDER_CONFIG_INVALID');
  assert.match(result.message, /U\+FFFD/);
});

test('provider registry limits provider types to openai and openai-compatible', () => {
  const registry = createProviderRegistry();

  for (const legacyType of ['anthropic', 'google', 'qwen']) {
    const provider = registry.sanitizeProvider({ type: legacyType, requestPath: '/chat/completions' });

    assert.equal(provider.type, 'openai');
    assert.equal(provider.name, 'OpenAI');
    assert.equal(provider.requestPath, '');
  }

  const official = registry.sanitizeProvider({ type: 'openai', requestPath: '/chat/completions' });
  const compatible = registry.sanitizeProvider({ type: 'openai-compatible', requestPath: 'chat/completions' });

  assert.equal(official.type, 'openai');
  assert.equal(official.requestPath, '');
  assert.equal(compatible.name, 'OpenAI Compatible');
  assert.equal(compatible.requestPath, '/chat/completions');
});

test('provider registry validates requestPath for compatible providers', () => {
  const registry = createProviderRegistry();

  assert.throws(
    () => registry.validateProviderRequestInput({
      apiKey: 'test-key',
      baseUrl: 'https://api.example.com/v1',
      modelName: 'gpt-4.1-mini',
      requestPath: '/v1/responses'
    }),
    /request path/i
  );
});

test('provider registry testConnection uses the official openai client for openai providers', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({ output_text: 'OK' })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.testConnection({
      provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
      apiKey: 'test-key',
      modelName: 'gpt-4.1-mini',
      timeoutMs: 1000
    });

    assert.equal(result.ok, true);
    assert.equal(result.message, 'Connection test succeeded.');
    assert.equal(calls.constructs[0].apiKey, 'test-key');
    assert.equal(calls.constructs[0].baseURL, 'https://api.openai.com/v1');
    assert.ok(calls.responses.length > 0 || calls.chats.length > 0);
  });
});

test('provider registry testConnection falls back to the provider default model when none is supplied', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    chatCreate: async () => ({
      choices: [
        {
          message: {
            content: 'OK'
          }
        }
      ]
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.testConnection({
      provider: {
        type: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        requestPath: '/chat/completions'
      },
      apiKey: 'test-key',
      timeoutMs: 1000
    });

    assert.equal(result.ok, true);
    assert.equal(calls.chats.length, 1);
    assert.equal(calls.chats[0].request.model, 'gpt-5.4-mini');
  });
});

test('provider registry testConnection adds an OpenRouter-specific hint for banned model authors', async () => {
  const { MockOpenAI } = createMockOpenAI({
    responsesCreate: async () => {
      throw new Error('403 Author openai is banned');
    }
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.testConnection({
      provider: {
        type: 'openai-compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        requestPath: '/responses'
      },
      apiKey: 'test-key',
      modelName: 'openai/gpt-5.4-mini'
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'PROVIDER_AUTH_FAILED');
    assert.match(result.message, /Author openai is banned/);
    assert.match(result.message, /OpenRouter rejected the selected model author/i);
    assert.match(result.message, /Discover Models/i);
  });
});

test('provider registry translateSegment prefers structured openai responses before text fallback', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: {
        translation: 'Bonjour'
      }
    }),
    chatCreate: async () => {
      throw new Error('chat fallback should not be used');
    }
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.translateSegment({
      provider: { type: 'openai', baseUrl: 'https://api.openai.com/v1' },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceText: 'Hello',
      tmSource: '',
      tmTarget: '',
      metadata: {},
      profile: {},
      requestType: 'Plaintext'
    });

    assert.equal(result.text, 'Bonjour');
    assert.equal(calls.responses.length, 1);
    assert.equal(calls.chats.length, 0);
    assert.equal(calls.responses[0].request.text.format.name, 'single_translation_result');
  });
});

test('provider registry translateSegment falls back to plain text when structured output is unsupported', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => {
      throw new Error('response_format json_schema unsupported');
    },
    chatCreate: async (request) => {
      if (request.response_format) {
        throw new Error('response_format json_schema unsupported');
      }
      return {
        choices: [
          {
            message: {
              content: 'Bonjour'
            }
          }
        ]
      };
    }
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.translateSegment({
      provider: {
        type: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        requestPath: '/chat/completions'
      },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceText: 'Hello',
      tmSource: '',
      tmTarget: '',
      metadata: {},
      profile: {},
      requestType: 'Plaintext'
    });

    assert.equal(result.text, 'Bonjour');
    assert.ok(calls.chats.length >= 2);
    assert.ok(calls.chats[0].request.response_format);
    assert.equal(calls.chats[calls.chats.length - 1].request.response_format, undefined);
  });
});

test('provider registry translateSegment falls back to plain text when structured output parsing fails', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_text: 'not json at all'
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.translateSegment({
      provider: { type: 'openai', baseUrl: 'https://api.openai.com/v1' },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceText: 'Hello',
      tmSource: '',
      tmTarget: '',
      metadata: {},
      profile: {},
      requestType: 'Plaintext'
    });

    assert.equal(result.text, 'not json at all');
    assert.equal(calls.responses.length, 2);
    assert.equal(calls.chats.length, 0);
  });
});

test('provider registry translateSegment does not retry as plain text on auth failures', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => {
      throw new Error('401 unauthorized');
    }
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await assert.rejects(() => registry.translateSegment({
      provider: { type: 'openai', baseUrl: 'https://api.openai.com/v1' },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceText: 'Hello',
      tmSource: '',
      tmTarget: '',
      metadata: {},
      profile: {},
      requestType: 'Plaintext'
    }), /401 unauthorized/i);

    assert.equal(calls.responses.length, 1);
    assert.equal(calls.chats.length, 0);
  });
});

test('provider registry translateSegment does not retry as plain text on timeout failures', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => {
      throw new Error('request timed out');
    }
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await assert.rejects(() => registry.translateSegment({
      provider: { type: 'openai', baseUrl: 'https://api.openai.com/v1' },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      sourceText: 'Hello',
      tmSource: '',
      tmTarget: '',
      metadata: {},
      profile: {},
      requestType: 'Plaintext'
    }), /timed out/i);

    assert.equal(calls.responses.length, 1);
    assert.equal(calls.chats.length, 0);
  });
});

test('provider registry translateBatch prefers structured openai responses before any fallback', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => ({
      output_parsed: {
        translations: [
          { index: 1, text: 'B' },
          { index: 0, text: 'A' }
        ]
      },
      output_text: '{"translations":[{"index":1,"text":"B"},{"index":0,"text":"A"}]}'
    }),
    chatCreate: async () => {
      throw new Error('chat fallback should not be used');
    }
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.translateBatch({
      provider: { type: 'openai', baseUrl: 'https://api.openai.com/v1' },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      profile: {},
      requestType: 'Plaintext',
      metadata: {},
      segments: [
        { index: 0, sourceText: 'Hello', tmSource: '', tmTarget: '', segmentMetadata: { segmentIndex: 0 } },
        { index: 1, sourceText: 'World', tmSource: '', tmTarget: '', segmentMetadata: { segmentIndex: 1 } }
      ]
    });

    assert.deepEqual(result.translations, [
      { index: 0, text: 'A' },
      { index: 1, text: 'B' }
    ]);
    assert.equal(calls.responses.length, 1);
    assert.equal(calls.chats.length, 0);
  });
});

test('provider registry translateBatch falls back to compatible chat completions when structured output is unsupported', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async () => {
      throw new Error('response_format json_schema unsupported');
    },
    chatCreate: async () => ({
      choices: [
        {
          message: {
            content: '{"translations":[{"index":0,"text":"A"},{"index":1,"text":"B"}]}'
          }
        }
      ]
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.translateBatch({
      provider: {
        type: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        requestPath: '/chat/completions'
      },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      profile: {},
      requestType: 'Plaintext',
      metadata: {},
      segments: [
        { index: 0, sourceText: 'Hello', tmSource: '', tmTarget: '', segmentMetadata: { segmentIndex: 0 } },
        { index: 1, sourceText: 'World', tmSource: '', tmTarget: '', segmentMetadata: { segmentIndex: 1 } }
      ]
    });

    assert.deepEqual(result.translations, [
      { index: 0, text: 'A' },
      { index: 1, text: 'B' }
    ]);
    assert.equal(calls.responses.length, 0);
    assert.ok(calls.chats.length >= 1);
  });
});

test('provider registry translateBatch does not retry as plain text on rate limit failures', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    chatCreate: async () => {
      throw new Error('429 rate limit exceeded');
    }
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await assert.rejects(() => registry.translateBatch({
      provider: {
        type: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        requestPath: '/chat/completions'
      },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      profile: {},
      requestType: 'Plaintext',
      metadata: {},
      segments: [
        { index: 0, sourceText: 'Hello', tmSource: '', tmTarget: '', segmentMetadata: { segmentIndex: 0 } },
        { index: 1, sourceText: 'World', tmSource: '', tmTarget: '', segmentMetadata: { segmentIndex: 1 } }
      ]
    }), /429 rate limit exceeded/i);

    assert.equal(calls.chats.length, 1);
    assert.equal(calls.responses.length, 0);
  });
});

test('provider registry translateBatch does not retry as plain text on network failures', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    chatCreate: async () => {
      throw new Error('network fetch failed');
    }
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await assert.rejects(() => registry.translateBatch({
      provider: {
        type: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        requestPath: '/chat/completions'
      },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      profile: {},
      requestType: 'Plaintext',
      metadata: {},
      segments: [
        { index: 0, sourceText: 'Hello', tmSource: '', tmTarget: '', segmentMetadata: { segmentIndex: 0 } },
        { index: 1, sourceText: 'World', tmSource: '', tmTarget: '', segmentMetadata: { segmentIndex: 1 } }
      ]
    }), /network fetch failed/i);

    assert.equal(calls.chats.length, 1);
    assert.equal(calls.responses.length, 0);
  });
});

test('provider registry streamText uses responses streaming for official openai providers', async () => {
  const stream = { async *[Symbol.asyncIterator]() { yield { type: 'response.output_text.delta', delta: 'Bon' }; } };
  const { MockOpenAI, calls } = createMockOpenAI({
    responsesCreate: async (request) => {
      assert.equal(request.stream, true);
      return stream;
    }
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.streamText({
      provider: { type: 'openai', baseUrl: 'https://api.openai.com/v1' },
      apiKey: 'test-key',
      modelName: 'gpt-4.1-mini',
      systemPrompt: 'You are concise.',
      prompt: 'Say bonjour.',
      timeoutMs: 1000
    });

    assert.equal(result, stream);
  });

  assert.equal(calls.responses.length, 1);
  assert.equal(calls.chats.length, 0);
  assert.equal(calls.responses[0].request.model, 'gpt-4.1-mini');
});

test('provider registry streamText uses chat completions streaming for compatible providers', async () => {
  const stream = { async *[Symbol.asyncIterator]() { yield { choices: [{ delta: { content: 'Hi' } }] }; } };
  const { MockOpenAI, calls } = createMockOpenAI({
    chatCreate: async (request) => {
      assert.equal(request.stream, true);
      return stream;
    }
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.streamText({
      provider: { type: 'openai-compatible', baseUrl: 'https://api.example.com/v1', requestPath: '/chat/completions' },
      apiKey: 'test-key',
      modelName: 'gpt-4.1-mini',
      systemPrompt: 'You are concise.',
      prompt: 'Say hi.',
      timeoutMs: 1000
    });

    assert.equal(result, stream);
  });

  assert.equal(calls.responses.length, 0);
  assert.equal(calls.chats.length, 1);
  assert.equal(calls.chats[0].request.model, 'gpt-4.1-mini');
});

test('provider registry discoverModels supports official openai providers', async () => {
  const { MockOpenAI, calls } = createMockOpenAI({
    modelsList: async () => ({
      data: [
        { id: 'gpt-4.1-mini' },
        { id: 'gpt-4.1' }
      ]
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.discoverModels({
      provider: {
        type: 'openai',
        baseUrl: 'https://api.openai.com/v1'
      },
      apiKey: 'test-key'
    });

    assert.equal(result.ok, true);
    assert.equal(calls.constructs[0].baseURL, 'https://api.openai.com/v1');
    assert.equal(calls.models.length, 1);
    assert.deepEqual(result.models, [
      { modelName: 'gpt-4.1-mini' },
      { modelName: 'gpt-4.1' }
    ]);
  });
});

test('provider registry discoverModels uses the compatible models endpoint', async () => {
  const requests = [];
  const registry = createProviderRegistry({
    fetch: async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: 'gpt-4.1-mini' },
            { id: 'qwen-plus' }
          ]
        })
      };
    }
  });

  const result = await registry.discoverModels({
    provider: {
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/custom/v1',
      requestPath: '/chat/completions'
    },
    apiKey: 'test-key'
  });

  assert.equal(requests[0].url, 'https://api.example.com/custom/v1/models');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(result.models, [
    { modelName: 'gpt-4.1-mini' },
    { modelName: 'qwen-plus' }
  ]);
});

test('provider registry discoverModels reports auth failures cleanly', async () => {
  const registry = createProviderRegistry({
    fetch: async () => {
      throw new Error('401 unauthorized');
    }
  });

  const result = await registry.discoverModels({
    provider: {
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      requestPath: '/responses'
    },
    apiKey: 'test-key'
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'PROVIDER_AUTH_FAILED');
});

test('provider registry translateSegment aborts in-flight requests when timeout elapses', async () => {
  let aborted = false;
  const { MockOpenAI } = createMockOpenAI({
    responsesCreate: async (_request, _config, requestOptions) => new Promise((_, reject) => {
      requestOptions.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('request aborted'));
      }, { once: true });
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await assert.rejects(
      registry.translateSegment({
        provider: { type: 'openai', baseUrl: 'https://api.openai.com/v1' },
        apiKey: 'test',
        modelName: 'gpt-4.1-mini',
        sourceText: 'Hello',
        tmSource: '',
        tmTarget: '',
        metadata: {},
        profile: {},
        requestType: 'Plaintext',
        timeoutMs: 20
      }),
      /timed out/
    );
  });

  assert.equal(aborted, true);
});

test('provider registry preserves Retry-After hints from provider response headers', async () => {
  const { MockOpenAI } = createMockOpenAI({
    responsesCreate: async () => {
      const error = new Error('429 too many requests');
      error.headers = new Headers({ 'Retry-After': '3' });
      throw error;
    }
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    await assert.rejects(
      () => registry.translateSegment({
        provider: { type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
        apiKey: 'test',
        modelName: 'gpt-4.1-mini',
        sourceLanguage: 'EN',
        targetLanguage: 'FR',
        sourceText: 'Hello',
        tmSource: '',
        tmTarget: '',
        requestType: 'Plaintext',
        metadata: {},
        profile: {}
      }),
      (error) => {
        assert.equal(error.retryAfterSeconds, 3);
        return true;
      }
    );
  });
});

test('provider registry discoverModels aborts compatible fetch requests on timeout', async () => {
  let aborted = false;
  const registry = createProviderRegistry({
    fetch: async (_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      }, { once: true });
    })
  });

  const result = await registry.discoverModels({
    provider: {
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      requestPath: '/responses'
    },
    apiKey: 'test-key',
    timeoutMs: 20
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'PROVIDER_TIMEOUT');
  assert.equal(aborted, true);
});

test('provider registry translateBatch accepts the array response contract', async () => {
  const { MockOpenAI } = createMockOpenAI({
    responsesCreate: async () => ({
      output_text: '[{"index":1,"text":"B"},{"index":0,"text":"A"}]'
    })
  });

  await withMockedModules({ openai: MockOpenAI }, async () => {
    const { createProviderRegistry: loadRegistry } = require(providerRegistryModulePath);
    const registry = loadRegistry();

    const result = await registry.translateBatch({
      provider: { type: 'openai', baseUrl: 'https://api.openai.com/v1' },
      apiKey: 'test',
      modelName: 'gpt-4.1-mini',
      profile: {},
      requestType: 'Plaintext',
      metadata: {},
      segments: [
        { index: 0, sourceText: 'Hello', tmSource: '', tmTarget: '', segmentMetadata: { segmentIndex: 0 } },
        { index: 1, sourceText: 'World', tmSource: '', tmTarget: '', segmentMetadata: { segmentIndex: 1 } }
      ]
    });

    assert.deepEqual(result.translations, [
      { index: 0, text: 'A' },
      { index: 1, text: 'B' }
    ]);
  });
});
