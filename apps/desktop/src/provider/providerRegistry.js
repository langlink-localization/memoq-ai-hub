const crypto = require('crypto');
const OpenAI = require('openai');
const {
  SUPPORTED_REQUEST_PATHS,
  buildProviderRequestUrl,
  getDefaultBaseUrl,
  getDefaultModelName,
  getDefaultProviderName,
  getDefaultRequestPath,
  getProviderCapabilities,
  isSupportedProviderType,
  normalizeProviderType,
  resolveRequestPath,
  sanitizeProvider,
  validateCompatibleRequestPath,
  validateProviderRequestInput
} = require('./providerConfig');
const {
  normalizeSegmentMetadataItem
} = require('../shared/memoqMetadataNormalizer');
const {
  renderTemplate
} = require('../shared/promptTemplate');
const {
  buildBatchPrompt,
  buildPrompt
} = require('./providerPromptBuilder');
const {
  extractChatText,
  extractJsonText,
  extractResponseText,
  mapProviderError,
  normalizeRequestType,
  normalizeTranslatedText,
  parseBatchTranslations,
  parseSingleTranslation,
  stripCodeFences
} = require('./providerResponseUtils');
const {
  shouldRetryProviderError
} = require('./providerGovernance');

const BATCH_TRANSLATIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translations'],
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'text'],
        properties: {
          index: { type: 'integer' },
          text: { type: 'string' }
        }
      }
    }
  }
};

const SINGLE_TRANSLATION_SCHEMA = BATCH_TRANSLATIONS_SCHEMA;

const DEFAULT_PROFILE_SYSTEM_PROMPT = 'You are a precise translation assistant.';

async function loadSdkModules() {
  return {
    OpenAI
  };
}

function createClient(OpenAIConstructor, provider, apiKey, timeoutMs) {
  const sanitizedProvider = sanitizeProvider(provider);
  return new OpenAIConstructor({
    apiKey,
    baseURL: sanitizedProvider.baseUrl,
    timeout: timeoutMs,
    maxRetries: 0
  });
}

function createChatMessages(systemPrompt, prompt) {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

function createStructuredOutputFormat(schema, name, description) {
  return {
    type: 'json_schema',
    name,
    description,
    schema,
    strict: true
  };
}

function looksLikeStructuredParseFailure(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('translation response is not valid json')
    || normalized.includes('did not include a translation string')
    || normalized.includes('did not include valid translations')
    || normalized.includes('contains an invalid index')
    || normalized.includes('contains duplicate index')
    || normalized.includes('unexpected token')
    || normalized.includes('is not valid json');
}

function looksLikeStructuredCapabilityFailure(message) {
  const normalized = String(message || '').toLowerCase();
  if (!normalized) {
    return false;
  }

  const mentionsStructuredOutput = normalized.includes('json_schema')
    || normalized.includes('response_format')
    || normalized.includes('structured output')
    || normalized.includes('schema');
  const indicatesIncompatibility = normalized.includes('unsupported')
    || normalized.includes('not support')
    || normalized.includes('invalid')
    || normalized.includes('unknown parameter')
    || normalized.includes('invalid schema')
    || normalized.includes('not allowed');

  return mentionsStructuredOutput && indicatesIncompatibility;
}

function shouldFallbackFromStructuredError(error) {
  const mapped = mapProviderError(error);
  if (shouldRetryProviderError(mapped) || ['PROVIDER_AUTH_FAILED', 'PROVIDER_CONFIG_INVALID'].includes(mapped.code)) {
    return false;
  }

  const message = String(error?.message || mapped.message || '');
  return looksLikeStructuredParseFailure(message) || looksLikeStructuredCapabilityFailure(message);
}

function buildStreamingRequest(client, requestPath, request) {
  const requestOptions = request?.requestOptions || {};
  if (requestPath === '/chat/completions') {
    return client.chat.completions.create({
      model: request.modelName,
      messages: createChatMessages(request.systemPrompt, request.prompt),
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      stream: true
    }, requestOptions);
  }

  return client.responses.create({
    model: request.modelName,
    instructions: request.systemPrompt,
    input: request.prompt,
    temperature: request.temperature,
    max_output_tokens: request.maxOutputTokens,
    stream: true
  }, requestOptions);
}

function extractHeaderValue(headers, name) {
  if (!headers || !name) {
    return '';
  }

  if (typeof headers.get === 'function') {
    return String(headers.get(name) || '').trim();
  }

  const direct = headers[name] ?? headers[String(name).toLowerCase()] ?? headers[String(name).toUpperCase()];
  if (Array.isArray(direct)) {
    return String(direct[0] || '').trim();
  }
  if (typeof direct === 'string' || typeof direct === 'number') {
    return String(direct).trim();
  }

  return '';
}

function parseRetryAfterSeconds(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric;
  }

  const retryAt = Date.parse(normalized);
  if (!Number.isNaN(retryAt)) {
    const seconds = (retryAt - Date.now()) / 1000;
    return seconds >= 0 ? seconds : 0;
  }

  return null;
}

function attachRetryAfter(error, headers) {
  const retryAfterSeconds = parseRetryAfterSeconds(extractHeaderValue(headers, 'retry-after'));
  if (retryAfterSeconds === null) {
    return error;
  }
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

function createTimeoutError(timeoutMs, cause) {
  const error = new Error(`Provider request timed out after ${timeoutMs} ms`);
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function createRequestOptions(timeoutMs, signal) {
  const requestOptions = {};
  if (timeoutMs && timeoutMs > 0) {
    requestOptions.timeout = timeoutMs;
  }
  if (signal) {
    requestOptions.signal = signal;
  }
  return requestOptions;
}

async function withAbortableTimeout(executor, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) {
    return executor({
      signal: undefined,
      requestOptions: {}
    });
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await executor({
      signal: controller.signal,
      requestOptions: createRequestOptions(timeoutMs, controller.signal)
    });
  } catch (error) {
    if (timedOut) {
      throw createTimeoutError(timeoutMs, error);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function createPromptCacheKey({
  provider,
  modelName,
  requestType,
  sourceLanguage,
  targetLanguage,
  systemPrompt,
  prompt
}) {
  const sanitizedProvider = sanitizeProvider(provider);
  const payload = JSON.stringify({
    providerId: String(sanitizedProvider.id || ''),
    providerType: sanitizedProvider.type,
    modelName: String(modelName || ''),
    requestType: normalizeRequestType(requestType),
    sourceLanguage: String(sourceLanguage || ''),
    targetLanguage: String(targetLanguage || ''),
    systemPrompt: String(systemPrompt || ''),
    prompt: String(prompt || '')
  });

  return crypto.createHash('sha256').update(payload).digest('hex');
}

function buildPromptCacheRequestFields(provider, requestOptions = {}) {
  if (requestOptions.providerPromptCacheEnabled !== true) {
    return {};
  }

  const sanitizedProvider = sanitizeProvider(provider);
  if (!['openai', 'openai-compatible'].includes(sanitizedProvider.type)) {
    return {};
  }

  const fields = {
    prompt_cache_key: String(requestOptions.promptCacheKey || '').trim()
  };

  const retention = String(requestOptions.promptCacheTtlHint || '').trim();
  if (retention) {
    fields.prompt_cache_retention = retention;
  }

  return fields;
}

function getCachedPromptTokens(response) {
  return Number(
    response?.usage?.prompt_tokens_details?.cached_tokens
    || response?.usage?.input_tokens_details?.cached_tokens
    || 0
  );
}

function createProviderRegistry(options = {}) {
  const sdkLoader = options.sdkLoader || loadSdkModules;
  const fetchImpl = options.fetch || globalThis.fetch?.bind(globalThis);

  async function callTextModel({
    provider,
    apiKey,
    modelName,
    systemPrompt,
    prompt,
    maxOutputTokens,
    temperature,
    timeoutMs,
    requestOptions = {}
  }) {
    const sdk = await sdkLoader();
    const sanitizedProvider = sanitizeProvider(provider);
    const normalizedApiKey = String(apiKey || '').trim();
    const normalizedModelName = String(modelName || getDefaultModelName(sanitizedProvider.type)).trim();
    const requestPath = resolveRequestPath(sanitizedProvider);

    validateProviderRequestInput({
      apiKey: normalizedApiKey,
      baseUrl: sanitizedProvider.baseUrl,
      modelName: normalizedModelName,
      requestPath: sanitizedProvider.type === 'openai-compatible' ? requestPath : ''
    });

    const client = createClient(sdk.OpenAI, sanitizedProvider, normalizedApiKey, timeoutMs);
    const startedAt = Date.now();
    const promptCacheFields = buildPromptCacheRequestFields(sanitizedProvider, requestOptions);

    if (requestPath === '/chat/completions') {
      const completion = await withAbortableTimeout(async ({ requestOptions }) => {
        try {
          return await client.chat.completions.create({
            model: normalizedModelName,
            messages: createChatMessages(systemPrompt, prompt),
            temperature,
            max_tokens: maxOutputTokens,
            ...promptCacheFields
          }, requestOptions);
        } catch (error) {
          throw attachRetryAfter(error, error?.headers || error?.response?.headers);
        }
      }, timeoutMs);

      return {
        text: extractChatText(completion),
        latencyMs: Date.now() - startedAt,
        providerMetadata: {
          cachedPromptTokens: getCachedPromptTokens(completion)
        }
      };
    }

    const response = await withAbortableTimeout(async ({ requestOptions }) => {
      try {
        return await client.responses.create({
          model: normalizedModelName,
          instructions: systemPrompt,
          input: prompt,
          temperature,
          max_output_tokens: maxOutputTokens,
          ...promptCacheFields
        }, requestOptions);
      } catch (error) {
        throw attachRetryAfter(error, error?.headers || error?.response?.headers);
      }
    }, timeoutMs);

    return {
      text: extractResponseText(response),
      latencyMs: Date.now() - startedAt,
      providerMetadata: {
        cachedPromptTokens: getCachedPromptTokens(response)
      }
    };
  }

  async function callStructuredModel({
    provider,
    apiKey,
    modelName,
    systemPrompt,
    prompt,
    timeoutMs,
    schema,
    name,
    description,
    requestOptions = {}
  }) {
    const sdk = await sdkLoader();
    const sanitizedProvider = sanitizeProvider(provider);
    const normalizedApiKey = String(apiKey || '').trim();
    const normalizedModelName = String(modelName || getDefaultModelName(sanitizedProvider.type)).trim();
    const requestPath = resolveRequestPath(sanitizedProvider);

    validateProviderRequestInput({
      apiKey: normalizedApiKey,
      baseUrl: sanitizedProvider.baseUrl,
      modelName: normalizedModelName,
      requestPath: sanitizedProvider.type === 'openai-compatible' ? requestPath : ''
    });

    const client = createClient(sdk.OpenAI, sanitizedProvider, normalizedApiKey, timeoutMs);
    const startedAt = Date.now();
    const promptCacheFields = buildPromptCacheRequestFields(sanitizedProvider, requestOptions);

    if (requestPath === '/chat/completions') {
      const completion = await withAbortableTimeout(async ({ requestOptions }) => {
        try {
          return await client.chat.completions.create({
            model: normalizedModelName,
            messages: createChatMessages(systemPrompt, prompt),
            response_format: {
              type: 'json_schema',
              json_schema: {
                name,
                description,
                schema,
                strict: true
              }
            },
            ...promptCacheFields
          }, requestOptions);
        } catch (error) {
          throw attachRetryAfter(error, error?.headers || error?.response?.headers);
        }
      }, timeoutMs);

      return {
        output: JSON.parse(extractJsonText(extractChatText(completion))),
        latencyMs: Date.now() - startedAt,
        providerMetadata: {
          cachedPromptTokens: getCachedPromptTokens(completion)
        }
      };
    }

    const response = await withAbortableTimeout(async ({ requestOptions }) => {
      try {
        return await client.responses.create({
          model: normalizedModelName,
          instructions: systemPrompt,
          input: prompt,
          text: {
            format: createStructuredOutputFormat(schema, name, description)
          },
          ...promptCacheFields
        }, requestOptions);
      } catch (error) {
        throw attachRetryAfter(error, error?.headers || error?.response?.headers);
      }
    }, timeoutMs);

    return {
      output: response?.output_parsed ?? JSON.parse(extractJsonText(extractResponseText(response))),
      latencyMs: Date.now() - startedAt,
      providerMetadata: {
        cachedPromptTokens: getCachedPromptTokens(response)
      }
    };
  }

  async function testConnection({ provider, apiKey, modelName, timeoutMs = 30000 }) {
    try {
      const result = await callTextModel({
        provider,
        apiKey,
        modelName: modelName || getDefaultModelName(provider.type),
        prompt: 'Reply with OK only.',
        timeoutMs
      });

      return {
        ok: true,
        latencyMs: result.latencyMs,
        message: 'Connection test succeeded.'
      };
    } catch (error) {
      const mapped = mapProviderError(error);
      return {
        ok: false,
        latencyMs: null,
        code: mapped.code,
        message: mapped.message
      };
    }
  }

  async function generateText({
    provider,
    apiKey,
    modelName,
    systemPrompt,
    prompt,
    maxOutputTokens,
    temperature,
    timeoutMs = 120000
  }) {
    return callTextModel({
      provider,
      apiKey,
      modelName,
      systemPrompt,
      prompt,
      maxOutputTokens,
      temperature,
      timeoutMs
    });
  }

  async function streamText({
    provider,
    apiKey,
    modelName,
    systemPrompt,
    prompt,
    maxOutputTokens,
    temperature,
    timeoutMs = 120000
  }) {
    const sdk = await sdkLoader();
    const sanitizedProvider = sanitizeProvider(provider);
    const normalizedApiKey = String(apiKey || '').trim();
    const normalizedModelName = String(modelName || getDefaultModelName(sanitizedProvider.type)).trim();
    const requestPath = resolveRequestPath(sanitizedProvider);

    validateProviderRequestInput({
      apiKey: normalizedApiKey,
      baseUrl: sanitizedProvider.baseUrl,
      modelName: normalizedModelName,
      requestPath: sanitizedProvider.type === 'openai-compatible' ? requestPath : ''
    });

    const client = createClient(sdk.OpenAI, sanitizedProvider, normalizedApiKey, timeoutMs);
    return withAbortableTimeout(async ({ requestOptions }) => (
      buildStreamingRequest(client, requestPath, {
        modelName: normalizedModelName,
        systemPrompt,
        prompt,
        maxOutputTokens,
        temperature,
        requestOptions
      })
    ), timeoutMs);
  }

  async function translateSegment({
    provider,
    apiKey,
    modelName,
    sourceLanguage,
    targetLanguage,
    sourceText,
    tmSource,
    tmTarget,
    metadata,
    previewContext,
    profile,
    requestType,
    timeoutMs = 120000,
    assetContext = {},
    tbContext = {},
    segmentMetadata,
    segmentPreviewContext,
    neighborContext,
    requestOptions = {}
  }) {
    const promptRequest = buildPrompt({
      sourceLanguage,
      targetLanguage,
      sourceText,
      tmSource,
      tmTarget,
      metadata,
      previewContext,
      segmentPreviewContext,
      profile,
      requestType,
      assetContext,
      tbContext,
      segmentMetadata,
      neighborContext
    }, { normalizeRequestType });
    const prompt = promptRequest.prompt;
    const renderedSystemPrompt = promptRequest.systemPrompt;
    const promptCacheKey = createPromptCacheKey({
      provider,
      modelName,
      requestType,
      sourceLanguage,
      targetLanguage,
      systemPrompt: renderedSystemPrompt,
      prompt
    });

    if (requestOptions.localPromptCacheEnabled !== false && typeof requestOptions.readPromptCache === 'function') {
      const cachedText = requestOptions.readPromptCache(promptCacheKey);
      if (cachedText) {
        let normalizedText = '';
        try {
          normalizedText = parseSingleTranslation(cachedText, requestType);
        } catch {
          normalizedText = normalizeTranslatedText(cachedText, requestType);
        }
        return {
          text: normalizedText,
          latencyMs: 0,
          promptCache: {
            key: promptCacheKey,
            layer: 'local',
            hit: true
          }
        };
      }
    }

    try {
      const result = await callStructuredModel({
        provider,
        apiKey,
        modelName,
        systemPrompt: renderedSystemPrompt,
        prompt,
        timeoutMs,
        schema: SINGLE_TRANSLATION_SCHEMA,
        name: 'single_translation_result',
        description: 'A stable translation result keyed by index 0 for a single source segment.',
        requestOptions: {
          ...requestOptions,
          promptCacheKey
        }
      });
      const normalizedText = parseSingleTranslation(result.output, requestType);
      if (requestOptions.localPromptCacheEnabled !== false && typeof requestOptions.writePromptCache === 'function') {
        requestOptions.writePromptCache(promptCacheKey, normalizedText);
      }

      return {
        text: normalizedText,
        latencyMs: result.latencyMs,
        requestMetadata: {
          mode: 'single',
          segmentIndexes: [0],
          systemPrompt: renderedSystemPrompt,
          promptPreview: prompt.slice(0, 4000),
          userPrompt: prompt,
          items: promptRequest.renderedSegment ? [promptRequest.renderedSegment] : []
        },
        promptCache: {
          key: promptCacheKey,
          layer: requestOptions.providerPromptCacheEnabled === true ? 'provider' : 'none',
          hit: Number(result.providerMetadata?.cachedPromptTokens || 0) > 0
        }
      };
    } catch (error) {
      if (!shouldFallbackFromStructuredError(error)) {
        throw error;
      }
      const result = await callTextModel({
        provider,
        apiKey,
        modelName,
        systemPrompt: renderedSystemPrompt,
        prompt,
        maxOutputTokens: 1200,
        temperature: 0.2,
        timeoutMs,
        requestOptions: {
          ...requestOptions,
          promptCacheKey
        }
      });
      let normalizedText = '';
      try {
        normalizedText = parseSingleTranslation(result.text, requestType);
      } catch {
        normalizedText = normalizeTranslatedText(result.text, requestType);
      }
      if (requestOptions.localPromptCacheEnabled !== false && typeof requestOptions.writePromptCache === 'function') {
        requestOptions.writePromptCache(promptCacheKey, normalizedText);
      }

      return {
        text: normalizedText,
        latencyMs: result.latencyMs,
        requestMetadata: {
          mode: 'single',
          segmentIndexes: [0],
          systemPrompt: renderedSystemPrompt,
          promptPreview: prompt.slice(0, 4000),
          userPrompt: prompt,
          items: promptRequest.renderedSegment ? [promptRequest.renderedSegment] : []
        },
        promptCache: {
          key: promptCacheKey,
          layer: requestOptions.providerPromptCacheEnabled === true ? 'provider' : 'none',
          hit: Number(result.providerMetadata?.cachedPromptTokens || 0) > 0
        }
      };
    }
  }

  async function discoverModels({
    provider,
    apiKey,
    timeoutMs = 30000
  }) {
    const sanitizedProvider = sanitizeProvider(provider);
    const normalizedApiKey = String(apiKey || '').trim();
    validateProviderRequestInput({
      apiKey: normalizedApiKey,
      baseUrl: sanitizedProvider.baseUrl,
      modelName: getDefaultModelName(sanitizedProvider.type),
      requestPath: sanitizedProvider.type === 'openai-compatible' ? sanitizedProvider.requestPath : ''
    });

    try {
      if (sanitizedProvider.type === 'openai-compatible' && typeof fetchImpl === 'function') {
        const modelsUrl = `${String(sanitizedProvider.baseUrl || '').replace(/\/+$/, '')}/models`;
        const response = await withAbortableTimeout(async ({ signal }) => (
          fetchImpl(modelsUrl, {
            headers: {
              Authorization: `Bearer ${normalizedApiKey}`
            },
            signal
          })
        ), timeoutMs);

        if (!response.ok) {
          const details = typeof response.text === 'function'
            ? String(await response.text() || '').trim()
            : '';
          throw attachRetryAfter(new Error(`${response.status} ${details || response.statusText || 'request failed'}`.trim()), response.headers);
        }

        const payload = typeof response.json === 'function' ? await response.json() : {};
        const models = Array.isArray(payload?.data)
          ? payload.data
            .map((item) => String(item?.id || '').trim())
            .filter(Boolean)
            .map((modelName) => ({ modelName }))
          : [];

        return {
          ok: true,
          models
        };
      }

      const sdk = await sdkLoader();
      const client = createClient(sdk.OpenAI, sanitizedProvider, normalizedApiKey, timeoutMs);
      const page = await withAbortableTimeout(async ({ requestOptions }) => {
        try {
          return await client.models.list({}, requestOptions);
        } catch (error) {
          throw attachRetryAfter(error, error?.headers || error?.response?.headers);
        }
      }, timeoutMs);
      const models = Array.isArray(page?.data)
        ? page.data
          .map((item) => String(item?.id || '').trim())
          .filter(Boolean)
          .map((modelName) => ({ modelName }))
        : [];

      return {
        ok: true,
        models
      };
    } catch (error) {
      const mapped = mapProviderError(error);
      return {
        ok: false,
        code: mapped.code,
        message: mapped.message,
        models: []
      };
    }
  }

  async function translateBatch({
    provider,
    apiKey,
    modelName,
    sourceLanguage,
    targetLanguage,
    segments,
    metadata,
    previewContext,
    profile,
    requestType,
    timeoutMs = 120000,
    assetContext = {},
    requestOptions = {}
  }) {
    const sanitizedSegments = (Array.isArray(segments) ? segments : []).map((segment) => ({
      index: Number(segment.index),
      sourceText: String(segment.sourceText || ''),
      tmSource: (profile?.useBestFuzzyTm || profile?.useCustomTm) ? String(segment.tmSource || '') : '',
      tmTarget: (profile?.useBestFuzzyTm || profile?.useCustomTm) ? String(segment.tmTarget || '') : '',
      segmentMetadata: profile?.useMetadata
        ? normalizeSegmentMetadataItem(segment.segmentMetadata || {}, Number(segment.index))
        : undefined,
      previewContext: profile?.usePreviewContext === false ? undefined : (segment.previewContext || null),
      tbContext: segment.tbContext && typeof segment.tbContext === 'object'
        ? {
          glossaryText: String(segment.tbContext.glossaryText || ''),
          tbMetadataText: String(segment.tbContext.tbMetadataText || ''),
          fingerprint: String(segment.tbContext.fingerprint || ''),
          sourcePlainText: String(segment.tbContext.sourcePlainText || ''),
          termHits: Array.isArray(segment.tbContext.termHits) ? segment.tbContext.termHits : []
        }
        : undefined,
      neighborContext: segment.neighborContext || null
    }));
    const expectedIndexes = sanitizedSegments.map((segment) => segment.index);
    const batchPrompt = buildBatchPrompt({
      sourceLanguage,
      targetLanguage,
      segments: sanitizedSegments,
      metadata,
      previewContext,
      profile,
      requestType,
      assetContext
    }, { normalizeRequestType });
    const prompt = batchPrompt.prompt;
    const renderedSystemPrompt = batchPrompt.systemPrompt;
    const promptCacheKey = createPromptCacheKey({
      provider,
      modelName,
      requestType,
      sourceLanguage,
      targetLanguage,
      systemPrompt: renderedSystemPrompt,
      prompt
    });

    if (requestOptions.localPromptCacheEnabled !== false && typeof requestOptions.readPromptCache === 'function') {
      const cachedText = requestOptions.readPromptCache(promptCacheKey);
      if (cachedText) {
        return {
          translations: parseBatchTranslations(cachedText, requestType, expectedIndexes),
          latencyMs: 0,
          promptCache: {
            key: promptCacheKey,
            layer: 'local',
            hit: true
          }
        };
      }
    }

    try {
      const result = await callStructuredModel({
        provider,
        apiKey,
        modelName,
        systemPrompt: renderedSystemPrompt,
        prompt,
        timeoutMs,
        schema: BATCH_TRANSLATIONS_SCHEMA,
        name: 'batch_translation_result',
        description: 'A stable batch translation result keyed by input indexes.',
        requestOptions: {
          ...requestOptions,
          promptCacheKey
        }
      });
      const translations = parseBatchTranslations(result.output, requestType, expectedIndexes);
      if (requestOptions.localPromptCacheEnabled !== false && typeof requestOptions.writePromptCache === 'function') {
        requestOptions.writePromptCache(promptCacheKey, JSON.stringify({ translations }));
      }

      const requestMetadata = {
        mode: 'batch',
        batchIndexes: expectedIndexes,
        segmentCount: sanitizedSegments.length,
        systemPrompt: renderedSystemPrompt,
        userPrompt: prompt,
        promptPreview: prompt.slice(0, 4000),
        items: batchPrompt.renderedBatchInstructions.map((item) => ({
          index: Number(item.index),
          sourceText: String(item.sourceText || ''),
          userPrompt: JSON.stringify(item)
        }))
      };

      return {
        translations,
        latencyMs: result.latencyMs,
        promptCache: {
          key: promptCacheKey,
          layer: requestOptions.providerPromptCacheEnabled === true ? 'provider' : 'none',
          hit: Number(result.providerMetadata?.cachedPromptTokens || 0) > 0
        },
        requestMetadata
      };
    } catch (error) {
      if (!shouldFallbackFromStructuredError(error)) {
        throw error;
      }
      const result = await callTextModel({
        provider,
        apiKey,
        modelName,
        systemPrompt: renderedSystemPrompt,
        prompt,
        maxOutputTokens: 2400,
        temperature: 0.1,
        timeoutMs,
        requestOptions: {
          ...requestOptions,
          promptCacheKey
        }
      });
      const translations = parseBatchTranslations(result.text, requestType, expectedIndexes);
      if (requestOptions.localPromptCacheEnabled !== false && typeof requestOptions.writePromptCache === 'function') {
        requestOptions.writePromptCache(promptCacheKey, JSON.stringify({ translations }));
      }

      const requestMetadata = {
        mode: 'batch',
        batchIndexes: expectedIndexes,
        segmentCount: sanitizedSegments.length,
        systemPrompt: renderedSystemPrompt,
        userPrompt: prompt,
        promptPreview: prompt.slice(0, 4000),
        items: batchPrompt.renderedBatchInstructions.map((item) => ({
          index: Number(item.index),
          sourceText: String(item.sourceText || ''),
          userPrompt: JSON.stringify(item)
        }))
      };

      return {
        translations,
        latencyMs: result.latencyMs,
        promptCache: {
          key: promptCacheKey,
          layer: requestOptions.providerPromptCacheEnabled === true ? 'provider' : 'none',
          hit: Number(result.providerMetadata?.cachedPromptTokens || 0) > 0
        },
        requestMetadata
      };
    }
  }

  return {
    normalizeProviderType,
    isSupportedProviderType,
    getDefaultBaseUrl,
    getDefaultModelName,
    getProviderCapabilities,
    normalizeRequestType,
    normalizeTranslatedText,
    createPromptCacheKey,
    sanitizeProvider,
    mapProviderError,
    validateProviderRequestInput,
    validateCompatibleRequestPath,
    generateText,
    streamText,
    testConnection,
    discoverModels,
    translateSegment,
    translateBatch
  };
}

module.exports = {
  buildPrompt,
  createProviderRegistry,
  getDefaultBaseUrl,
  getDefaultModelName,
  getProviderCapabilities,
  isSupportedProviderType,
  mapProviderError,
  normalizeProviderType,
  normalizeRequestType,
  normalizeTranslatedText,
  parseBatchTranslations,
  createPromptCacheKey,
  sanitizeProvider,
  validateCompatibleRequestPath,
  validateProviderRequestInput,
  getDefaultProviderName,
  getDefaultRequestPath,
  buildProviderRequestUrl,
  SUPPORTED_REQUEST_PATHS
};
