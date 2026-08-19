const {
  getDefaultModelName,
  getProviderModelResponseFormat,
  normalizeResponseFormat,
  resolveRequestPath,
  sanitizeProvider,
  validateProviderRequestInput
} = require('./providerConfig');
const {
  extractChatText,
  extractJsonText,
  extractResponseText,
  mapProviderError
} = require('./providerResponseUtils');
const { shouldRetryProviderError } = require('./providerGovernance');

async function loadSdkModules() {
  return {
    OpenAI: require('openai')
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

function createChatResponseFormat(responseFormat, schema, name, description) {
  if (responseFormat === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name,
        description,
        schema,
        strict: true
      }
    };
  }
  if (responseFormat === 'json_object') {
    return { type: 'json_object' };
  }
  return null;
}

function createResponsesTextFormat(responseFormat, schema, name, description) {
  if (responseFormat === 'json_schema') {
    return createStructuredOutputFormat(schema, name, description);
  }
  if (responseFormat === 'json_object') {
    return { type: 'json_object' };
  }
  return null;
}

function getStructuredResponseFormatCandidates(provider = {}, modelName = '') {
  const responseFormat = normalizeResponseFormat(getProviderModelResponseFormat(provider, modelName), 'auto');
  if (responseFormat === 'auto') {
    return ['json_schema', 'json_object', 'text'];
  }
  return [responseFormat];
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
    || normalized.includes('unavailable')
    || normalized.includes('not available')
    || normalized.includes('not enabled')
    || normalized.includes('unsupported value')
    || normalized.includes('invalid value')
    || normalized.includes('invalid type')
    || normalized.includes('invalid')
    || normalized.includes('unknown parameter')
    || normalized.includes('invalid schema')
    || normalized.includes('not allowed');

  return mentionsStructuredOutput && indicatesIncompatibility;
}

function pushErrorSignal(values, value) {
  const text = String(value || '').trim();
  if (text && !values.includes(text)) {
    values.push(text);
  }
}

function collectProviderErrorSignals(error, mapped = {}) {
  const values = [];
  const bodyError = error?.response?.data?.error || error?.body?.error || error?.error;

  if (bodyError && typeof bodyError === 'object') {
    pushErrorSignal(values, bodyError.message);
    pushErrorSignal(values, bodyError.type);
    pushErrorSignal(values, bodyError.code);
    pushErrorSignal(values, bodyError.param);
  }
  if (error?.response?.data && typeof error.response.data === 'string') {
    pushErrorSignal(values, error.response.data);
  }
  if (error?.body && typeof error.body === 'string') {
    pushErrorSignal(values, error.body);
  }
  pushErrorSignal(values, error?.message);
  pushErrorSignal(values, error?.type);
  pushErrorSignal(values, error?.code);
  pushErrorSignal(values, error?.param);
  pushErrorSignal(values, mapped.message);
  pushErrorSignal(values, mapped.code);
  return values.join(' ');
}

function shouldFallbackFromStructuredCapabilityError(error) {
  const mapped = mapProviderError(error);
  if (shouldRetryProviderError(mapped) || ['PROVIDER_AUTH_FAILED', 'PROVIDER_CONFIG_INVALID'].includes(mapped.code)) {
    return false;
  }

  return looksLikeStructuredCapabilityFailure(collectProviderErrorSignals(error, mapped));
}

function shouldFallbackFromStructuredError(error) {
  const mapped = mapProviderError(error);
  if (shouldRetryProviderError(mapped) || ['PROVIDER_AUTH_FAILED', 'PROVIDER_CONFIG_INVALID'].includes(mapped.code)) {
    return false;
  }

  const message = collectProviderErrorSignals(error, mapped);
  const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
  const normalizedType = String(error?.type || error?.error?.type || error?.body?.error?.type || '').trim().toLowerCase();
  const genericInvalidStructuredRequest = status === 400
    && normalizedType === 'invalid_request_error'
    && /\binvalid input\b|\bbad request\b/i.test(message);

  return looksLikeStructuredParseFailure(message)
    || looksLikeStructuredCapabilityFailure(message)
    || genericInvalidStructuredRequest;
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

async function withAbortableTimeout(executor, timeoutMs, externalSignal) {
  if ((!timeoutMs || timeoutMs <= 0) && !externalSignal) {
    return executor({
      signal: undefined,
      requestOptions: {}
    });
  }

  const controller = new AbortController();
  let timedOut = false;
  const relayAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener?.('abort', relayAbort, { once: true });
  if (externalSignal?.aborted) relayAbort();
  const timeoutId = timeoutMs > 0 ? setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs) : null;

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
    if (timeoutId) clearTimeout(timeoutId);
    externalSignal?.removeEventListener?.('abort', relayAbort);
  }
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

function createProviderTransport({ sdkLoader = loadSdkModules } = {}) {
  async function callTextModel({
    provider,
    apiKey,
    modelName,
    systemPrompt,
    prompt,
    maxOutputTokens,
    temperature,
    timeoutMs,
    requestOptions = {},
    signal
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
      }, timeoutMs, signal);

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
    }, timeoutMs, signal);

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
    requestOptions = {},
    signal
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
    const responseFormats = getStructuredResponseFormatCandidates(sanitizedProvider, normalizedModelName);
    let lastError = null;

    for (let index = 0; index < responseFormats.length; index += 1) {
      const responseFormat = responseFormats[index];
      const hasNextResponseFormat = index < responseFormats.length - 1;
      try {
        if (requestPath === '/chat/completions') {
          const completion = await withAbortableTimeout(async ({ requestOptions }) => {
            const chatResponseFormat = createChatResponseFormat(responseFormat, schema, name, description);
            const request = {
              model: normalizedModelName,
              messages: createChatMessages(systemPrompt, prompt),
              ...promptCacheFields
            };
            if (chatResponseFormat) {
              request.response_format = chatResponseFormat;
            }

            try {
              return await client.chat.completions.create(request, requestOptions);
            } catch (error) {
              throw attachRetryAfter(error, error?.headers || error?.response?.headers);
            }
          }, timeoutMs, signal);

          return {
            output: JSON.parse(extractJsonText(extractChatText(completion))),
            latencyMs: Date.now() - startedAt,
            responseFormat,
            providerMetadata: {
              cachedPromptTokens: getCachedPromptTokens(completion)
            }
          };
        }

        const response = await withAbortableTimeout(async ({ requestOptions }) => {
          const textFormat = createResponsesTextFormat(responseFormat, schema, name, description);
          const request = {
            model: normalizedModelName,
            instructions: systemPrompt,
            input: prompt,
            ...promptCacheFields
          };
          if (textFormat) {
            request.text = { format: textFormat };
          }

          try {
            return await client.responses.create(request, requestOptions);
          } catch (error) {
            throw attachRetryAfter(error, error?.headers || error?.response?.headers);
          }
        }, timeoutMs, signal);

        return {
          output: responseFormat === 'json_schema' && response?.output_parsed
            ? response.output_parsed
            : JSON.parse(extractJsonText(extractResponseText(response))),
          latencyMs: Date.now() - startedAt,
          responseFormat,
          providerMetadata: {
            cachedPromptTokens: getCachedPromptTokens(response)
          }
        };
      } catch (error) {
        lastError = error;
        if (hasNextResponseFormat && shouldFallbackFromStructuredCapabilityError(error)) {
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error('No structured response format was available.');
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

  return Object.freeze({
    callStructuredModel,
    callTextModel,
    streamText
  });
}

module.exports = {
  attachRetryAfter,
  buildPromptCacheRequestFields,
  buildStreamingRequest,
  createChatMessages,
  createChatResponseFormat,
  createClient,
  createProviderTransport,
  createResponsesTextFormat,
  getCachedPromptTokens,
  getStructuredResponseFormatCandidates,
  loadSdkModules,
  shouldFallbackFromStructuredCapabilityError,
  shouldFallbackFromStructuredError,
  withAbortableTimeout
};
