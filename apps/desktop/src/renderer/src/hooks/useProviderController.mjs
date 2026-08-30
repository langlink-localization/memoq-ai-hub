import { useEffect, useMemo, useState } from 'react';
import {
  createDraftEntry,
  discardDraftEntry,
  getResolvedRecords,
  updateDraftEntry
} from '../editorDrafts.mjs';
import { getProviderDraftSeed } from '../providerDraftDefaults.mjs';
import {
  buildProviderFingerprint,
  buildProviderModelCatalog,
  createDraftProviderModel,
  createProviderDraft,
  getPreferredProviderModel,
  isDraftProvider
} from '../providerDraftState.mjs';
import {
  decorateProvidersWithConnectionStatus,
  normalizeProviderStatus
} from '../pages/providers/providerConnectionState.mjs';
import {
  getProviderTypeLabel,
  getStatusTagMeta,
  normalizeProviderFilterText
} from '../pages/providers/providerPresentation.mjs';

const CONNECTION_SENSITIVE_PROVIDER_FIELDS = new Set(['apiKey', 'baseUrl', 'requestPath', 'type']);

// Owns the provider domain: draft records and dirty tracking, connectivity
// test states, model discovery/catalog, save/test/discover/discard/delete
// flows, provider search and insight focus. Selection state (providerId) and
// the derived current-provider presentation live here too; the app shell keeps
// navigation and the cross-domain save-and-continue flow.
export function useProviderController({ api, t, message, modal, notifyError, refresh, requestNavigation, requestPageNavigation, state }) {
  const [providerId, setProviderId] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);
  const [testingProvider, setTestingProvider] = useState(false);
  const [discoveringProviderModels, setDiscoveringProviderModels] = useState(false);
  const [providerDraftsById, setProviderDraftsById] = useState({});
  const [providerTestStatesById, setProviderTestStatesById] = useState({});
  const [providerSearch, setProviderSearch] = useState('');
  const [providerModelManagerOpen, setProviderModelManagerOpen] = useState(false);
  const [providerModelSearch, setProviderModelSearch] = useState('');
  const [providerModelSelection, setProviderModelSelection] = useState([]);
  const [discoveredProviderModels, setDiscoveredProviderModels] = useState({});
  const [providerInsightFocus, setProviderInsightFocus] = useState(null);

  const providerItems = useMemo(() => decorateProvidersWithConnectionStatus({
    providers: getResolvedRecords(state?.providerHub?.providers || [], providerDraftsById),
    draftsById: providerDraftsById,
    testStatesById: providerTestStatesById,
    buildFingerprint: buildProviderFingerprint,
    hasDraftChanges
  }), [state?.providerHub?.providers, providerDraftsById, providerTestStatesById]);
  const currentProvider = useMemo(
    () => providerItems.find((item) => item.id === providerId) || providerItems[0] || null,
    [providerItems, providerId],
  );
  const currentProviderModelCatalog = useMemo(
    () => buildProviderModelCatalog(currentProvider, discoveredProviderModels[currentProvider?.id] || []),
    [currentProvider, discoveredProviderModels],
  );
  const filteredCurrentProviderModelCatalog = useMemo(() => {
    const keyword = normalizeProviderFilterText(providerModelSearch);
    if (!keyword) {
      return currentProviderModelCatalog;
    }

    return currentProviderModelCatalog.filter((modelName) => modelName.toLowerCase().includes(keyword));
  }, [currentProviderModelCatalog, providerModelSearch]);
  const filteredProviders = useMemo(() => {
    const keyword = normalizeProviderFilterText(providerSearch);
    if (!keyword) {
      return providerItems;
    }

    return providerItems.filter((provider) => JSON.stringify({
      name: provider.name || '',
      type: provider.type || '',
      baseUrl: provider.baseUrl || '',
      requestPath: provider.requestPath || '',
      status: provider.status || '',
      models: (provider.models || []).map((model) => model.modelName || '')
    }).toLowerCase().includes(keyword));
  }, [providerItems, providerSearch]);
  const groupedProviders = useMemo(() => {
    const groups = [
      { key: 'openai', label: getProviderTypeLabel('openai', t), items: [] },
      { key: 'openai-compatible', label: getProviderTypeLabel('openai-compatible', t), items: [] }
    ];

    for (const provider of filteredProviders) {
      const group = groups.find((item) => item.key === provider.type) || groups[0];
      group.items.push(provider);
    }

    return groups.filter((group) => group.items.length);
  }, [filteredProviders, t]);
  const currentProviderFingerprint = useMemo(() => buildProviderFingerprint(currentProvider), [currentProvider]);
  const currentProviderConnectionSnapshot = useMemo(() => currentProvider?.connectionSnapshot || {
    status: normalizeProviderStatus(currentProvider?.status),
    testedAt: '',
    latencyMs: null,
    message: '',
    lastError: '',
    hasPreviousTest: false
  }, [currentProvider]);
  const currentProviderConnectionStatus = normalizeProviderStatus(currentProviderConnectionSnapshot.status);
  const currentProviderConnectionMeta = getStatusTagMeta(currentProviderConnectionStatus, t);
  const currentProviderHasPreviousTest = currentProviderConnectionSnapshot.hasPreviousTest === true;
  const currentProviderTestMessage = useMemo(
    () => String(currentProviderConnectionSnapshot.message || '').trim(),
    [currentProviderConnectionSnapshot]
  );
  const currentProviderDirty = Boolean(currentProvider?.id && hasDraftChanges(providerDraftsById, currentProvider.id));

  useEffect(() => {
    setProviderModelSelection([]);
    setProviderModelSearch('');
  }, [currentProvider?.id]);

  function clearProviderTestState(providerEntryId) {
    const normalizedId = String(providerEntryId || '').trim();
    if (!normalizedId) return;
    setProviderTestStatesById((current) => {
      if (!current[normalizedId]) {
        return current;
      }

      const nextState = { ...current };
      delete nextState[normalizedId];
      return nextState;
    });
  }

  async function saveCurrentProvider() {
    if (!currentProvider || currentProviderConnectionMeta.color !== 'green') return false;
    setSavingProvider(true);
    try {
      const draftProviderId = isDraftProvider(currentProvider) ? currentProvider.id : '';
      const providerPayload = isDraftProvider(currentProvider)
        ? {
          ...currentProvider,
          id: undefined,
          models: currentProvider.models || []
        }
        : currentProvider;
      const savedProvider = await api.saveProvider(providerPayload);
      setProviderDraftsById((current) => discardDraftEntry(current, currentProvider.id));
      clearProviderTestState(currentProvider.id);
      if (draftProviderId) {
        setDiscoveredProviderModels((current) => {
          const nextState = { ...current };
          if (nextState[draftProviderId] && !nextState[savedProvider.id]) {
            nextState[savedProvider.id] = nextState[draftProviderId];
          }
          delete nextState[draftProviderId];
          return nextState;
        });
      }
      setProviderId(savedProvider.id);
      message.success(t('feedback.actionSucceeded'));
      await refresh();
      return true;
    } catch (saveError) {
      notifyError(saveError);
      return false;
    } finally {
      setSavingProvider(false);
    }
  }

  async function testProvider() {
    if (!currentProvider) return;
    setTestingProvider(true);
    setProviderTestStatesById((current) => ({
      ...current,
      [currentProvider.id]: {
        fingerprint: currentProviderFingerprint,
        status: 'testing',
        message: '',
        testedAt: '',
        latencyMs: null
      }
    }));
    try {
      const result = await api.testProviderDraft(currentProvider);
      const status = normalizeProviderStatus(result?.status || (result?.ok ? 'connected' : 'failed'));
      setProviderTestStatesById((current) => ({
        ...current,
        [currentProvider.id]: {
          fingerprint: currentProviderFingerprint,
          status,
          message: result?.message || '',
          testedAt: result?.testedAt || '',
          latencyMs: Number.isFinite(result?.latencyMs) ? result.latencyMs : null
        }
      }));
      if (status === 'connected') {
        message.success(result?.message || t('providers.connectionSucceeded'));
      } else {
        message.error(result?.message || t('feedback.actionFailed'));
      }
    } catch (providerError) {
      setProviderTestStatesById((current) => ({
        ...current,
        [currentProvider.id]: {
          fingerprint: currentProviderFingerprint,
          status: 'failed',
          message: String(providerError?.message || t('feedback.actionFailed')),
          testedAt: '',
          latencyMs: null
        }
      }));
      notifyError(providerError);
    } finally {
      setTestingProvider(false);
    }
  }

  async function discoverProviderModels() {
    if (!currentProvider) return;
    setDiscoveringProviderModels(true);
    try {
      const result = await api.discoverProviderModels(currentProvider);
      if (!result?.ok) {
        throw new Error(result?.message || t('providers.modelDiscoveryFailed'));
      }

      const nextModels = (result.models || []).map((model) => String(model?.modelName || model?.id || model || '').trim()).filter(Boolean);
      setDiscoveredProviderModels((current) => ({
        ...current,
        [currentProvider.id]: nextModels
      }));
      message.success(t('providers.modelDiscoverySucceeded', { value: nextModels.length }));
    } catch (discoveryError) {
      notifyError(discoveryError, t('providers.modelDiscoveryFailed'));
    } finally {
      setDiscoveringProviderModels(false);
    }
  }

  function openInsightProvider(providerEntryId = '', focus = {}) {
    const normalizedProviderId = String(providerEntryId || '').trim();
    if (normalizedProviderId) {
      setProviderId(normalizedProviderId);
    }
    setProviderSearch('');
    setProviderInsightFocus({
      ...(focus && typeof focus === 'object' ? focus : {}),
      providerId: normalizedProviderId
    });
    requestPageNavigation('providers');
  }

  function updateCurrentProviderDraft(updater, options = {}) {
    if (!currentProvider) return;
    setProviderDraftsById((current) => updateDraftEntry(
      current,
      currentProvider,
      updater,
      {
        fingerprintFn: buildProviderFingerprint,
        dirtyFields: Array.isArray(options.dirtyFields) ? options.dirtyFields : []
      }
    ));
  }

  function patchCurrentProvider(field, value) {
    if (!currentProvider) return;
    updateCurrentProviderDraft((provider) => {
      const nextProvider = {
        ...provider,
        [field]: value
      };

      if (!CONNECTION_SENSITIVE_PROVIDER_FIELDS.has(field)) {
        return nextProvider;
      }

      return {
        ...nextProvider,
        status: 'not_tested',
        lastError: '',
        lastCheckedAt: '',
        lastLatencyMs: null
      };
    }, { dirtyFields: [field] });

  }

  function patchCurrentModel(modelId, field, value) {
    if (!currentProvider) return;
    updateCurrentProviderDraft((provider) => ({
      ...provider,
      models: (provider.models || []).map((model) => (
        model.id === modelId ? { ...model, [field]: value } : model
      ))
    }), { dirtyFields: field === 'modelName' ? ['models', 'modelsConnection'] : ['models'] });

  }

  function addModelToCurrentProvider(modelName = '') {
    if (!currentProvider) return;
    const draftSeed = getProviderDraftSeed(currentProvider.type);
    const normalizedModelName = String(modelName || '').trim() || draftSeed.modelNames?.[0] || '';
    if (!normalizedModelName) return;

    updateCurrentProviderDraft((provider) => {
      const existingModel = (provider.models || []).find((model) => String(model.modelName || '').trim().toLowerCase() === normalizedModelName.toLowerCase());
      if (existingModel) {
        return provider;
      }

      const nextModels = [...(provider.models || []), createDraftProviderModel(normalizedModelName)];
      const nextDefaultModelId = provider.defaultModelId || nextModels[0]?.id || '';

      return {
        ...provider,
        models: nextModels,
        defaultModelId: nextDefaultModelId
      };
    }, { dirtyFields: ['models', 'defaultModelId', 'modelsConnection'] });
  }

  function removeModelsFromCurrentProvider(modelIds = []) {
    if (!currentProvider) return;
    const normalizedIds = Array.from(new Set((Array.isArray(modelIds) ? modelIds : []).map((item) => String(item || '').trim()).filter(Boolean)));
    if (!normalizedIds.length) {
      return;
    }

    updateCurrentProviderDraft((provider) => {
      const currentModels = Array.isArray(provider.models) ? provider.models : [];
      const allowsEmptyDraftModels = provider.type === 'openai-compatible';
      if (!allowsEmptyDraftModels && currentModels.length - normalizedIds.length < 1) {
        throw new Error(t('providers.keepOneModel'));
      }

      const nextModels = currentModels.filter((model) => !normalizedIds.includes(model.id));
      const nextDefaultModel = getPreferredProviderModel({ ...provider, models: nextModels }, normalizedIds.includes(provider.defaultModelId) ? '' : provider.defaultModelId);

      return {
        ...provider,
        models: nextModels,
        defaultModelId: nextDefaultModel?.id || ''
      };
    }, { dirtyFields: ['models', 'defaultModelId', 'modelsConnection'] });
    setProviderModelSelection((current) => current.filter((item) => !normalizedIds.includes(item)));
  }

  function setCurrentProviderDefaultModel(modelId) {
    if (!currentProvider) return;
    updateCurrentProviderDraft((provider) => ({
      ...provider,
      defaultModelId: modelId
    }), { dirtyFields: ['defaultModelId'] });
  }

  function discardCurrentProviderChangesNow() {
    if (!currentProvider) return;
    const currentProviderId = currentProvider.id;
    const nextProviders = providerItems.filter((item) => item.id !== currentProviderId);

    setProviderDraftsById((current) => discardDraftEntry(current, currentProviderId));
    clearProviderTestState(currentProviderId);
    setDiscoveredProviderModels((current) => {
      if (!current[currentProviderId] || !isDraftProvider(currentProvider)) {
        return current;
      }

      const nextState = { ...current };
      delete nextState[currentProviderId];
      return nextState;
    });

    if (isDraftProvider(currentProvider)) {
      setProviderId(nextProviders[0]?.id || '');
    }
  }

  function confirmDiscardCurrentProviderChanges() {
    if (!currentProvider || !currentProviderDirty) return;
    modal.confirm({
      title: t('navigation.discardProviderTitle'),
      content: t('navigation.discardProviderDescription', { name: currentProvider.name || t('nav.providers') }),
      okText: t('providers.discardChanges'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: discardCurrentProviderChangesNow
    });
  }

  async function createProvider(type) {
    try {
      const draft = createProviderDraft(type);
      const nextProvider = {
        ...draft,
        id: `draft_provider_${Date.now()}`,
        status: 'not_tested',
        lastCheckedAt: '',
        lastError: '',
        lastLatencyMs: null,
        models: (draft.models || []).map((model, index) => ({
          ...createDraftProviderModel(model.modelName),
          ...model,
          id: `draft_model_${Date.now()}_${index}`
        }))
      };
      nextProvider.defaultModelId = nextProvider.models[0]?.id || '';

      setProviderSearch('');
      setProviderDraftsById((current) => ({
        ...current,
        [nextProvider.id]: createDraftEntry(nextProvider, buildProviderFingerprint, {
          isNew: true,
          dirtyFields: ['name', 'type', 'baseUrl', 'requestPath', 'models', 'defaultModelId', 'enabled']
        })
      }));
      requestNavigation('provider', nextProvider.id);
      clearProviderTestState(nextProvider.id);
      message.success(t('providers.providerDraftCreated'));
    } catch (createError) {
      notifyError(createError);
    }
  }

  function confirmDeleteProvider() {
    if (!currentProvider) return;
    modal.confirm({
      title: t('providers.deleteProvider'),
      content: t('providers.confirmDeleteProvider', { name: currentProvider.name }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        if (isDraftProvider(currentProvider)) {
          discardCurrentProviderChangesNow();
          message.success(t('providers.providerDeleted'));
          return;
        }

        try {
          await api.deleteProvider(currentProvider.id);
          message.success(t('providers.providerDeleted'));
          await refresh();
        } catch (deleteError) {
          notifyError(deleteError, t('feedback.blockedDelete'));
        }
      }
    });
  }

  function confirmDeleteModel(model) {
    modal.confirm({
      title: t('providers.deleteModel'),
      content: t('providers.confirmDeleteModel', { name: model.modelName }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          removeModelsFromCurrentProvider([model.id]);
          message.success(t('providers.modelDeleted'));
        } catch (deleteError) {
          notifyError(deleteError, t('feedback.blockedDelete'));
        }
      }
    });
  }

  function confirmBulkDeleteModels() {
    if (!currentProvider || !providerModelSelection.length) return;
    modal.confirm({
      title: t('providers.deleteModel'),
      content: t('providers.confirmDeleteModels', { count: providerModelSelection.length }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          removeModelsFromCurrentProvider(providerModelSelection);
          message.success(t('providers.modelsDeleted', { count: providerModelSelection.length }));
        } catch (deleteError) {
          notifyError(deleteError, t('feedback.blockedDelete'));
        }
      }
    });
  }

  return {
    providerId,
    setProviderId,
    providerDraftsById,
    setProviderDraftsById,
    setProviderTestStatesById,
    providerItems,
    filteredProviders,
    groupedProviders,
    currentProvider,
    currentProviderDirty,
    currentProviderConnectionMeta,
    currentProviderConnectionSnapshot,
    currentProviderConnectionStatus,
    currentProviderHasPreviousTest,
    currentProviderTestMessage,
    providerSearch,
    setProviderSearch,
    providerModelSelection,
    setProviderModelSelection,
    providerModelManagerOpen,
    setProviderModelManagerOpen,
    providerModelSearch,
    setProviderModelSearch,
    filteredCurrentProviderModelCatalog,
    providerInsightFocus,
    setProviderInsightFocus,
    savingProvider,
    testingProvider,
    discoveringProviderModels,
    clearProviderTestState,
    saveCurrentProvider,
    testProvider,
    discoverProviderModels,
    openInsightProvider,
    discardCurrentProviderChangesNow,
    confirmDiscardCurrentProviderChanges,
    createProvider,
    patchCurrentProvider,
    patchCurrentModel,
    addModelToCurrentProvider,
    removeModelsFromCurrentProvider,
    setCurrentProviderDefaultModel,
    confirmDeleteProvider,
    confirmDeleteModel,
    confirmBulkDeleteModels
  };
}
