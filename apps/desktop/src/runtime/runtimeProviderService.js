const {
  getDefaultModelName,
  getDefaultRequestPath,
  isSupportedProviderType,
  validateCompatibleRequestPath,
  validateProviderRequestInput
} = require('../provider/providerRegistry');
const { buildHistoryMetrics } = require('./runtimeHistoryIntegrationSupport');
const { buildProfileReferenceMessage } = require('./runtimeTranslationSupport');
const {
  ensureProvider,
  ensureProviderModel,
  resolveProviderDefaultModelId
} = require('./runtimeState');

/**
 * @param {any} provider
 */
function selectModel(provider) {
  const models = Array.isArray(provider?.models) ? provider.models : [];
  const defaultModelId = String(provider?.defaultModelId || '').trim();
  return models.find((model) => model.id === defaultModelId && model.enabled !== false)
    || models.find((model) => model.enabled)
    || models[0]
    || null;
}

/**
 * @param {any} provider
 */
function assertSupportedProviderDraft(provider = {}) {
  if (!isSupportedProviderType(provider?.type)) {
    throw new Error('Only OpenAI and OpenAI-compatible providers are supported.');
  }

  if (String(provider?.type || '').trim().toLowerCase() === 'openai-compatible') {
    validateCompatibleRequestPath(provider.requestPath || getDefaultRequestPath('openai-compatible'));
  }
}

function createRuntimeProviderService({
  loadState,
  saveState,
  loadHistoryEntries,
  secretStore,
  providerRegistry,
  nowIso
}) {
  /**
   * @param {any} state
   * @param {any} providerDraft
   */
  async function testProviderDraftAgainstState(state, providerDraft = {}) {
    const currentProvider = state.providers.find((item) => item.id === providerDraft.id);
    assertSupportedProviderDraft({ ...currentProvider, ...providerDraft });
    const provider = ensureProvider({
      ...currentProvider,
      ...providerDraft,
      secretRef: providerDraft.secretRef || currentProvider?.secretRef
    });
    const testedAt = nowIso();
    const secret = String(providerDraft.apiKey || '').trim()
      || (currentProvider ? await secretStore.get(currentProvider.secretRef) : '');
    const model = selectModel(provider);

    if (!secret) {
      return { ok: false, status: 'failed', message: 'API key has not been saved yet.', latencyMs: null, testedAt };
    }

    if (!model) {
      return { ok: false, status: 'failed', message: 'At least one enabled model is required.', latencyMs: null, testedAt };
    }

    const result = await providerRegistry.testConnection({
      provider,
      apiKey: secret,
      modelName: model.modelName,
      timeoutMs: 30000
    });

    return {
      ok: result.ok,
      status: result.ok ? 'connected' : 'failed',
      message: result.message,
      latencyMs: Number.isFinite(Number(result.latencyMs)) ? Number(result.latencyMs) : null,
      testedAt
    };
  }

  /**
   * @param {any} state
   * @param {any} providerDraft
   */
  async function discoverProviderModelsAgainstState(state, providerDraft = {}) {
    const currentProvider = state.providers.find((item) => item.id === providerDraft.id);
    assertSupportedProviderDraft({ ...currentProvider, ...providerDraft });
    const provider = ensureProvider({
      ...currentProvider,
      ...providerDraft,
      secretRef: providerDraft.secretRef || currentProvider?.secretRef
    });
    const secret = String(providerDraft.apiKey || '').trim()
      || (currentProvider ? await secretStore.get(currentProvider.secretRef) : '');

    if (!secret) {
      return { ok: false, code: 'PROVIDER_AUTH_FAILED', message: 'API key has not been saved yet.', models: [] };
    }

    const result = await providerRegistry.discoverModels({
      provider,
      apiKey: secret,
      timeoutMs: 30000
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      models: (result.models || []).map((model) => ensureProviderModel(model, provider.type))
    };
  }

  /**
   * @param {any} provider
   */
  async function saveProvider(provider) {
    const state = loadState();
    const currentProvider = state.providers.find((item) => item.id === provider.id);
    assertSupportedProviderDraft({ ...currentProvider, ...provider });
    const nextProvider = ensureProvider({
      ...currentProvider,
      ...provider,
      secretRef: provider.secretRef || currentProvider?.secretRef
    });
    const candidateApiKey = Object.prototype.hasOwnProperty.call(provider || {}, 'apiKey')
      ? String(provider.apiKey || '').trim()
      : '';
    const modelsToValidate = (nextProvider.models || []).filter((model) => model.enabled !== false);

    if (candidateApiKey) {
      const validationModels = modelsToValidate.length
        ? modelsToValidate
        : (nextProvider.type === 'openai-compatible' ? [] : [{ modelName: getDefaultModelName(nextProvider.type) }]);

      for (const model of validationModels) {
        validateProviderRequestInput({
          apiKey: candidateApiKey,
          baseUrl: nextProvider.baseUrl,
          modelName: model.modelName,
          requestPath: nextProvider.type === 'openai-compatible' ? nextProvider.requestPath : ''
        });
      }
    }

    if (provider.apiKey) {
      await secretStore.set(nextProvider.secretRef, provider.apiKey);
    }
    delete nextProvider.apiKey;
    const index = state.providers.findIndex((item) => item.id === nextProvider.id);
    if (index >= 0) state.providers[index] = nextProvider;
    else state.providers.push(nextProvider);
    saveState(state);
    const metrics = buildHistoryMetrics(loadHistoryEntries(), nextProvider.id);
    return {
      ...nextProvider,
      hasSecret: secretStore.has(nextProvider.secretRef),
      successRate24h: metrics.successRate24h,
      avgLatencyMs: metrics.avgLatencyMs
    };
  }

  /**
   * @param {any} providerDraft
   */
  async function testProviderDraft(providerDraft) {
    return testProviderDraftAgainstState(loadState(), providerDraft || {});
  }

  /**
   * @param {any} providerDraft
   */
  async function discoverProviderModels(providerDraft) {
    return discoverProviderModelsAgainstState(loadState(), providerDraft || {});
  }

  /**
   * @param {any} providerId
   */
  async function deleteProvider(providerId) {
    const state = loadState();
    const provider = state.providers.find((item) => item.id === providerId);
    if (!provider) throw new Error(`Provider ${providerId} not found`);

    const referencedBy = state.profiles.filter((profile) => (
      profile.providerId === providerId
      || profile.interactiveProviderId === providerId
      || profile.pretranslateProviderId === providerId
      || profile.fallbackProviderId === providerId
    )).map((profile) => profile.name);
    if (referencedBy.length) {
      throw new Error(buildProfileReferenceMessage(referencedBy, `Provider "${provider.name}"`));
    }

    state.providers = state.providers.filter((item) => item.id !== providerId);
    saveState(state);
    await secretStore.delete(provider.secretRef);
    return { ok: true };
  }

  /**
   * @param {any} providerId
   * @param {any} modelId
   */
  function deleteProviderModel(providerId, modelId) {
    const state = loadState();
    const provider = state.providers.find((item) => item.id === providerId);
    if (!provider) throw new Error(`Provider ${providerId} not found`);

    const model = (provider.models || []).find((item) => item.id === modelId);
    if (!model) throw new Error(`Model ${modelId} not found`);
    if ((provider.models || []).length <= 1) {
      throw new Error(`Provider "${provider.name}" must keep at least one model.`);
    }

    const referencedBy = state.profiles.filter((profile) => (
      profile.interactiveModelId === modelId
      || profile.pretranslateModelId === modelId
      || profile.fallbackModelId === modelId
    )).map((profile) => profile.name);
    if (referencedBy.length) {
      throw new Error(buildProfileReferenceMessage(referencedBy, `Model "${model.modelName}"`));
    }

    provider.models = (provider.models || []).filter((item) => item.id !== modelId);
    provider.defaultModelId = resolveProviderDefaultModelId(
      provider.models,
      provider.defaultModelId === modelId ? '' : provider.defaultModelId
    );
    saveState(state);
    return { ok: true };
  }

  /**
   * @param {any} providerId
   */
  async function testProviderConnection(providerId) {
    const state = loadState();
    const provider = state.providers.find((item) => item.id === providerId);
    if (!provider) throw new Error(`Provider ${providerId} not found`);
    const result = await testProviderDraftAgainstState(state, provider);
    provider.status = result.status;
    provider.lastCheckedAt = result.testedAt || nowIso();
    provider.lastError = result.ok ? '' : result.message;
    provider.lastLatencyMs = result.latencyMs;
    saveState(state);
    return {
      ok: result.ok,
      status: provider.status,
      message: result.message,
      latencyMs: result.latencyMs,
      testedAt: result.testedAt
    };
  }

  return Object.freeze({
    deleteProvider,
    deleteProviderModel,
    discoverProviderModels,
    saveProvider,
    testProviderConnection,
    testProviderDraft
  });
}

module.exports = {
  assertSupportedProviderDraft,
  createRuntimeProviderService,
  selectModel
};
