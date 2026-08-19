import { getProviderDraftSeed } from './providerDraftDefaults.mjs';

export function createProviderDraft(type) {
  const draftSeed = getProviderDraftSeed(type);

  return {
    ...draftSeed,
    models: (draftSeed.modelNames || []).map((modelName) => createDraftProviderModel(modelName)),
    enabled: true
  };
}

export function getProviderModelCount(provider) {
  return Array.isArray(provider?.models) ? provider.models.length : 0;
}

export function createDraftModelId() {
  return `draft_model_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDraftProviderModel(modelName = 'gpt-5.4-mini') {
  return {
    id: createDraftModelId(),
    modelName: String(modelName || 'gpt-5.4-mini').trim() || 'gpt-5.4-mini',
    enabled: true,
    concurrencyLimit: 1,
    rateLimitHint: '',
    retryEnabled: true,
    retryAttempts: 2,
    promptCacheEnabled: false,
    promptCacheTtlHint: '',
    responseFormat: '',
    throughputMode: '',
    maxBatchSegments: 0,
    maxBatchCharacters: 0,
    providerConcurrency: 0,
    contextWindowTokens: 0,
    maxOutputTokens: 0,
    notes: ''
  };
}

export function getPreferredProviderModel(provider, preferredModelId = '') {
  const models = Array.isArray(provider?.models) ? provider.models : [];
  const preferredId = String(preferredModelId || provider?.defaultModelId || '').trim();

  if (preferredId) {
    const explicit = models.find((model) => model?.id === preferredId && model?.enabled !== false);
    if (explicit) {
      return explicit;
    }
  }

  return models.find((model) => model?.enabled !== false)
    || models[0]
    || null;
}

export function buildProviderModelCatalog(provider = {}, discoveredModels = []) {
  const discoveredNames = Array.isArray(discoveredModels)
    ? discoveredModels.map((model) => String(model?.modelName || model || '').trim()).filter(Boolean)
    : [];
  const configuredNames = Array.isArray(provider?.models)
    ? provider.models.map((model) => String(model?.modelName || '').trim()).filter(Boolean)
    : [];

  return Array.from(new Set([...configuredNames, ...discoveredNames]))
    .sort((left, right) => left.localeCompare(right));
}

export function buildProviderRequestPreview(provider = {}) {
  const normalized = String(provider.baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalized) {
    return '';
  }
  const type = String(provider.type || '').trim().toLowerCase();
  if (type === 'openai-compatible') {
    const requestPath = String(provider.requestPath || '/responses').trim().replace(/^\/+/, '');
    return requestPath ? `${normalized}/${requestPath}` : normalized;
  }
  return `${normalized}/responses`;
}

export function isDraftProvider(provider) {
  return String(provider?.id || '').startsWith('draft_provider_');
}

export function buildProviderFingerprint(provider) {
  if (!provider) return '';

  return JSON.stringify({
    name: provider.name || '',
    type: provider.type || '',
    baseUrl: provider.baseUrl || '',
    requestPath: provider.requestPath || '',
    defaultModelId: provider.defaultModelId || '',
    enabled: provider.enabled !== false,
    apiKey: provider.apiKey || '',
    responseFormat: provider.capabilities?.responseFormat || '',
    throughputMode: provider.capabilities?.throughputMode || '',
    maxBatchSegments: provider.capabilities?.maxBatchSegments || 0,
    maxBatchCharacters: provider.capabilities?.maxBatchCharacters || 0,
    models: (provider.models || []).map((model) => ({
      id: model.id || '',
      modelName: model.modelName || '',
      enabled: model.enabled !== false,
      concurrencyLimit: model.concurrencyLimit ?? 1,
      rateLimitHint: model.rateLimitHint || '',
      retryEnabled: model.retryEnabled !== false,
      retryAttempts: model.retryAttempts ?? 2,
      promptCacheEnabled: model.promptCacheEnabled === true,
      promptCacheTtlHint: model.promptCacheTtlHint || '',
      responseFormat: model.responseFormat || '',
      throughputMode: model.throughputMode || '',
      maxBatchSegments: model.maxBatchSegments || 0,
      maxBatchCharacters: model.maxBatchCharacters || 0,
      providerConcurrency: model.providerConcurrency || 0,
      contextWindowTokens: model.contextWindowTokens || 0,
      maxOutputTokens: model.maxOutputTokens || 0,
      notes: model.notes || ''
    }))
  });
}
