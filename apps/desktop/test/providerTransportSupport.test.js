'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  attachRetryAfter,
  buildPromptCacheRequestFields,
  buildStreamingRequest,
  createChatMessages,
  createClient,
  createProviderTransport,
  shouldFallbackFromStructuredError,
  withAbortableTimeout
} = require('../src/provider/providerTransportSupport');

test('provider transport builds provider-family request shapes without product state', async () => {
  const calls = [];
  const client = {
    chat: {
      completions: {
        create: async (request, options) => {
          calls.push({ request, options });
          return 'stream';
        }
      }
    }
  };

  const result = await buildStreamingRequest(client, '/chat/completions', {
    modelName: 'model-1',
    systemPrompt: 'System',
    prompt: 'User',
    maxOutputTokens: 100,
    temperature: 0.2,
    requestOptions: { timeout: 500 }
  });

  assert.equal(result, 'stream');
  assert.deepEqual(createChatMessages('System', 'User'), [
    { role: 'system', content: 'System' },
    { role: 'user', content: 'User' }
  ]);
  assert.equal(calls[0].request.stream, true);
  assert.deepEqual(calls[0].options, { timeout: 500 });
});

test('provider transport owns client sanitization and provider prompt-cache fields', () => {
  let clientOptions = null;
  class FakeOpenAI {
    constructor(options) {
      clientOptions = options;
    }
  }

  createClient(FakeOpenAI, {
    type: 'openai-compatible',
    baseUrl: 'https://example.test/v1'
  }, 'key', 1234);

  assert.deepEqual(clientOptions, {
    apiKey: 'key',
    baseURL: 'https://example.test/v1',
    timeout: 1234,
    maxRetries: 0
  });
  assert.deepEqual(buildPromptCacheRequestFields({ type: 'openai' }, {
    providerPromptCacheEnabled: true,
    promptCacheKey: 'cache-key',
    promptCacheTtlHint: '24h'
  }), {
    prompt_cache_key: 'cache-key',
    prompt_cache_retention: '24h'
  });
  assert.deepEqual(buildPromptCacheRequestFields({ type: 'openai' }, {}), {});
});

test('provider transport preserves Retry-After and structured fallback classification', () => {
  const error = attachRetryAfter(new Error('rate limited'), { 'retry-after': '2.5' });
  assert.equal(error.retryAfterSeconds, 2.5);

  assert.equal(shouldFallbackFromStructuredError({
    status: 400,
    type: 'invalid_request_error',
    message: 'response_format json_schema is not supported'
  }), true);
  assert.equal(shouldFallbackFromStructuredError({ status: 401, message: 'invalid api key' }), false);
});

test('provider transport converts only its own timeout into a stable timeout error', async () => {
  await assert.rejects(
    withAbortableTimeout(({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true });
    }), 10),
    /timed out after 10 ms/i
  );

  const controller = new AbortController();
  controller.abort(new Error('caller cancelled'));
  await assert.rejects(
    withAbortableTimeout(async ({ signal }) => {
      if (signal.aborted) throw signal.reason;
    }, 1000, controller.signal),
    /caller cancelled/i
  );
});

test('provider transport facade executes text, structured, and streaming requests', async () => {
  const calls = [];
  class FakeOpenAI {
    constructor(options) {
      this.options = options;
      this.responses = {
        create: async (request, requestOptions) => {
          calls.push({ request, requestOptions });
          if (request.stream) return 'response-stream';
          if (request.text?.format) {
            return {
              output_parsed: { value: 'structured' },
              usage: { input_tokens_details: { cached_tokens: 4 } }
            };
          }
          return {
            output_text: 'plain text',
            usage: { input_tokens_details: { cached_tokens: 2 } }
          };
        }
      };
    }
  }

  const transport = createProviderTransport({
    sdkLoader: async () => ({ OpenAI: FakeOpenAI })
  });
  const provider = {
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    responseFormat: 'json_schema'
  };

  const textResult = await transport.callTextModel({
    provider,
    apiKey: 'key',
    modelName: 'model-1',
    systemPrompt: 'System',
    prompt: 'User',
    timeoutMs: 500
  });
  const structuredResult = await transport.callStructuredModel({
    provider,
    apiKey: 'key',
    modelName: 'model-1',
    systemPrompt: 'System',
    prompt: 'User',
    timeoutMs: 500,
    schema: { type: 'object' },
    name: 'result'
  });
  const streamResult = await transport.streamText({
    provider,
    apiKey: 'key',
    modelName: 'model-1',
    prompt: 'User',
    timeoutMs: 500
  });

  assert.equal(textResult.text, 'plain text');
  assert.equal(textResult.providerMetadata.cachedPromptTokens, 2);
  assert.deepEqual(structuredResult.output, { value: 'structured' });
  assert.equal(structuredResult.providerMetadata.cachedPromptTokens, 4);
  assert.equal(streamResult, 'response-stream');
  assert.equal(calls.length, 3);
  assert.equal(Object.isFrozen(transport), true);
});
