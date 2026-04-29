const DEFAULT_PROVIDER_TYPES = {
  openai: 'openai',
  'openai-compatible': 'openai-compatible',
  openaicompatible: 'openai-compatible'
};

const SUPPORTED_PROVIDER_TYPES = new Set(Object.values(DEFAULT_PROVIDER_TYPES));
const SUPPORTED_REQUEST_PATHS = new Set(['/responses', '/chat/completions']);
const SUPPORTED_RESPONSE_FORMATS = new Set(['auto', 'json_schema', 'json_object', 'text']);

const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  'openai-compatible': 'https://api.openai.com/v1'
};

const DEFAULT_MODELS = {
  openai: 'gpt-5.4-mini',
  'openai-compatible': 'gpt-5.4-mini'
};

const DEFAULT_PROVIDER_NAMES = {
  openai: 'OpenAI',
  'openai-compatible': 'OpenAI Compatible'
};

const DEFAULT_REQUEST_PATHS = {
  openai: '/responses',
  'openai-compatible': '/chat/completions'
};

const DEFAULT_CAPABILITIES = {
  openai: {
    supportsBatch: true,
    supportsStreaming: true,
    responseFormat: 'json_schema',
    maxBatchSegments: 8,
    maxBatchCharacters: 12000
  },
  'openai-compatible': {
    supportsBatch: true,
    supportsStreaming: true,
    responseFormat: 'auto',
    maxBatchSegments: 8,
    maxBatchCharacters: 12000
  }
};

function normalizeProviderType(type) {
  return DEFAULT_PROVIDER_TYPES[String(type || '').trim().toLowerCase()] || 'openai';
}

function isSupportedProviderType(type) {
  return SUPPORTED_PROVIDER_TYPES.has(DEFAULT_PROVIDER_TYPES[String(type || '').trim().toLowerCase()]);
}

function getDefaultBaseUrl(type) {
  return DEFAULT_BASE_URLS[normalizeProviderType(type)];
}

function getDefaultRequestPath(type) {
  return DEFAULT_REQUEST_PATHS[normalizeProviderType(type)] || '';
}

function getDefaultProviderName(type) {
  return DEFAULT_PROVIDER_NAMES[normalizeProviderType(type)] || DEFAULT_PROVIDER_NAMES.openai;
}

function getDefaultModelName(type) {
  return DEFAULT_MODELS[normalizeProviderType(type)];
}

function normalizeResponseFormat(responseFormat, fallback = 'auto') {
  const normalized = String(responseFormat || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const aliases = {
    json: 'json_object',
    json_mode: 'json_object',
    object: 'json_object',
    schema: 'json_schema',
    structured: 'json_schema',
    structured_output: 'json_schema',
    none: 'text',
    plain: 'text',
    plain_text: 'text'
  };
  const candidate = aliases[normalized] || normalized;
  if (SUPPORTED_RESPONSE_FORMATS.has(candidate)) {
    return candidate;
  }

  const normalizedFallback = String(fallback || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const fallbackCandidate = aliases[normalizedFallback] || normalizedFallback;
  return SUPPORTED_RESPONSE_FORMATS.has(fallbackCandidate) ? fallbackCandidate : '';
}

function isDeepSeekProvider(provider = {}) {
  const baseUrl = String(provider.baseUrl || '').trim().toLowerCase();
  if (baseUrl.includes('deepseek')) {
    return true;
  }

  const models = Array.isArray(provider.models) ? provider.models : [];
  return models.some((model) => String(model?.modelName || model?.id || model || '').trim().toLowerCase().startsWith('deepseek-'));
}

function getDefaultResponseFormat(type, provider = {}) {
  const normalizedType = normalizeProviderType(type);
  if (normalizedType === 'openai-compatible' && isDeepSeekProvider(provider)) {
    return 'json_object';
  }
  return DEFAULT_CAPABILITIES[normalizedType].responseFormat;
}

function normalizeCompatibleRequestPath(requestPath) {
  const candidate = `/${String(requestPath || getDefaultRequestPath('openai-compatible')).trim().replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return SUPPORTED_REQUEST_PATHS.has(candidate) ? candidate : getDefaultRequestPath('openai-compatible');
}

function validateCompatibleRequestPath(requestPath) {
  const normalized = normalizeCompatibleRequestPath(requestPath);
  const candidate = `/${String(requestPath || normalized).trim().replace(/^\/+/, '').replace(/\/+$/, '')}`;
  if (!SUPPORTED_REQUEST_PATHS.has(candidate)) {
    throw new Error(`OpenAI-compatible request path must be one of: ${Array.from(SUPPORTED_REQUEST_PATHS).join(', ')}`);
  }
  return normalized;
}

function getProviderCapabilities(provider = {}) {
  const type = normalizeProviderType(provider.type);
  const defaults = DEFAULT_CAPABILITIES[type];
  const provided = provider.capabilities && typeof provider.capabilities === 'object'
    ? provider.capabilities
    : {};
  const defaultResponseFormat = getDefaultResponseFormat(type, provider);

  return {
    supportsBatch: provided.supportsBatch ?? defaults.supportsBatch,
    supportsStreaming: provided.supportsStreaming ?? defaults.supportsStreaming,
    responseFormat: normalizeResponseFormat(provided.responseFormat, defaultResponseFormat),
    maxBatchSegments: Number.isFinite(Number(provided.maxBatchSegments))
      ? Number(provided.maxBatchSegments)
      : defaults.maxBatchSegments,
    maxBatchCharacters: Number.isFinite(Number(provided.maxBatchCharacters))
      ? Number(provided.maxBatchCharacters)
      : defaults.maxBatchCharacters
  };
}

function getProviderModelResponseFormat(provider = {}, modelName = '') {
  const providerCapabilities = getProviderCapabilities(provider);
  const normalizedModelName = String(modelName || '').trim().toLowerCase();
  const models = Array.isArray(provider.models) ? provider.models : [];
  const model = normalizedModelName
    ? models.find((item) => {
      const itemId = String(item?.id || '').trim().toLowerCase();
      const itemName = String(item?.modelName || '').trim().toLowerCase();
      return itemName === normalizedModelName || itemId === normalizedModelName;
    })
    : null;
  const modelResponseFormat = normalizeResponseFormat(model?.responseFormat, '');

  return modelResponseFormat || providerCapabilities.responseFormat;
}

function sanitizeProvider(provider = {}) {
  const type = normalizeProviderType(provider.type);

  return {
    ...provider,
    name: String(provider.name || getDefaultProviderName(type)).trim(),
    type,
    baseUrl: String(provider.baseUrl || getDefaultBaseUrl(type)).trim(),
    requestPath: type === 'openai-compatible'
      ? normalizeCompatibleRequestPath(provider.requestPath)
      : '',
    capabilities: getProviderCapabilities({ ...provider, type }),
    models: Array.isArray(provider.models) ? provider.models : []
  };
}

function assertNoReplacementCharacter(value, fieldLabel) {
  const text = String(value || '');
  if (text.includes('\uFFFD')) {
    throw new Error(`${fieldLabel} contains an invalid replacement character (U+FFFD). Re-paste it as plain text.`);
  }
}

function assertLatin1HeaderSafe(value, fieldLabel) {
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 255) {
      throw new Error(`${fieldLabel} contains a character that cannot be used in provider request headers. Re-paste it as plain text.`);
    }
  }
}

function validateProviderRequestInput({ apiKey, baseUrl, modelName, requestPath = '' }) {
  assertNoReplacementCharacter(apiKey, 'Provider API key');
  assertNoReplacementCharacter(baseUrl, 'Provider base URL');
  assertNoReplacementCharacter(modelName, 'Provider model name');
  assertLatin1HeaderSafe(apiKey, 'Provider API key');
  if (requestPath) {
    validateCompatibleRequestPath(requestPath);
  }
}

function trimSlashes(value) {
  return String(value || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

function buildProviderRequestUrl(baseUrl, requestPath) {
  const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
  const normalizedPath = trimSlashes(requestPath);
  if (!normalizedBaseUrl) {
    return '';
  }
  if (!normalizedPath) {
    return normalizedBaseUrl;
  }
  return `${normalizedBaseUrl}/${normalizedPath}`;
}

function resolveRequestPath(provider) {
  const sanitizedProvider = sanitizeProvider(provider);
  if (sanitizedProvider.type === 'openai') {
    return '/responses';
  }
  return validateCompatibleRequestPath(sanitizedProvider.requestPath);
}

module.exports = {
  SUPPORTED_REQUEST_PATHS: Array.from(SUPPORTED_REQUEST_PATHS),
  buildProviderRequestUrl,
  getDefaultBaseUrl,
  getDefaultModelName,
  getDefaultProviderName,
  getDefaultRequestPath,
  getProviderCapabilities,
  getProviderModelResponseFormat,
  isSupportedProviderType,
  normalizeCompatibleRequestPath,
  normalizeProviderType,
  normalizeResponseFormat,
  resolveRequestPath,
  sanitizeProvider,
  SUPPORTED_RESPONSE_FORMATS: Array.from(SUPPORTED_RESPONSE_FORMATS),
  validateCompatibleRequestPath,
  validateProviderRequestInput
};
