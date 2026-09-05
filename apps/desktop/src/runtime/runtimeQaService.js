'use strict';

const crypto = require('crypto');
const { ASSET_PURPOSES, buildAssetContext, normalizeAssetPurpose } = require('../asset/assetContext');
const { settleActivePreviewSnapshot, DEFAULT_PREVIEW_SETTLE_MS, DEFAULT_PREVIEW_SETTLE_MAX_WAITS } = require('./previewSnapshotSettle');
const { getProviderCapabilities } = require('../provider/providerRegistry');
const { createQaCoordinator, createSummary } = require('../qa/qaCoordinator');
const { createQaSnapshot } = require('../qa/qaContracts');
const {
  buildSegmentTbContext,
  buildSegmentCustomTmContext,
  createEmptyAssetContext
} = require('./runtimePromptSupport');
const { CONTRACT_VERSION, ERROR_CODES } = require('../shared/desktopContract');

/**
 * @param {any} options
 */
function createRuntimeQaService(options = {}) {
  const {
    persistence,
    loadState,
    secretStore,
    providerRegistry,
    previewContextClient,
    parsedAssetCache,
    performTranslation,
    runtimeLogger,
    nowIso,
    selectModel,
    hasSmartTbParsingCapability
  } = options;
  if (
    !persistence
    || typeof loadState !== 'function'
    || !secretStore
    || !providerRegistry
    || typeof performTranslation !== 'function'
    || typeof nowIso !== 'function'
    || typeof selectModel !== 'function'
    || typeof hasSmartTbParsingCapability !== 'function'
  ) {
    throw new TypeError('QA runtime dependencies are required.');
  }
  const previewSettleMs = Number.isFinite(Number(options.previewSettleMs))
    ? Math.max(0, Number(options.previewSettleMs))
    : DEFAULT_PREVIEW_SETTLE_MS;
  const previewSettleMaxWaits = Number.isFinite(Number(options.previewSettleMaxWaits))
    ? Math.max(1, Math.floor(Number(options.previewSettleMaxWaits)))
    : DEFAULT_PREVIEW_SETTLE_MAX_WAITS;

  const qaCoordinator = createQaCoordinator({
    persistence,
    invokeAi: async ({ snapshot, providerId, model, terminology, tmMatches, naturalLanguageRules, promptTemplate, additionalInstruction, repairInstruction, signal }) => {
      const state = loadState();
      const provider = state.providers.find((item) => item.id === providerId && item.enabled !== false)
        || state.providers.find((item) => item.enabled !== false);
      if (!provider) {
        const error = new Error('No enabled AI provider is available for quality checking.');
        error.code = ERROR_CODES.qaProviderUnavailable;
        throw error;
      }
      const selectedModel = (provider.models || []).find((item) => (item.id === model || item.modelName === model) && item.enabled !== false)
        || selectModel(provider);
      const apiKey = await secretStore.get(provider.secretRef);
      if (!selectedModel || !apiKey || typeof providerRegistry.checkQuality !== 'function') {
        const error = new Error('The selected provider is not ready for AI quality checking.');
        error.code = ERROR_CODES.qaProviderUnavailable;
        throw error;
      }
      try {
        return await providerRegistry.checkQuality({
          provider,
          apiKey,
          modelName: selectedModel.modelName,
          snapshot,
          terminology,
          tmMatches,
          naturalLanguageRules,
          promptTemplate,
          additionalInstruction,
          repairInstruction,
          signal,
          timeoutMs: 30000
        });
      } catch (/** @type {any} */ error) {
        if (error && typeof error === 'object') {
          error.providerId = String(provider.id || '');
          error.providerName = String(provider.name || '');
          error.model = String(selectedModel.modelName || '');
        }
        throw error;
      }
    }
  });
  const assistantRequests = new Map();

  /**
   */
  function buildActivePreviewQaPayload() {
    const document = previewContextClient?.readActiveDocument?.();
    if (!document) return null;
    const activeIds = Array.isArray(document.activePreviewPartIds) ? document.activePreviewPartIds : [];
    const parts = Array.isArray(document.parts) ? document.parts : [];
    const activePart = activeIds.length === 1
      ? parts.find((part) => String(part.previewPartId || '') === String(activeIds[0]))
      : null;
    if (!activePart) {
      return {
        document: { id: String(document.documentId || ''), name: String(document.documentName || '') },
        mappingCertain: false
      };
    }
    const ordered = [...parts].sort((/** @type {any} */ left, /** @type {any} */ right) => Number(left.order || 0) - Number(right.order || 0));
    const activeIndex = ordered.findIndex((part) => String(part.previewPartId || '') === String(activePart.previewPartId || ''));
    return {
      trigger: 'preview-target-changed',
      document: { id: String(document.documentId || ''), name: String(document.documentName || '') },
      segment: {
        previewPartId: String(activePart.previewPartId || ''),
        segmentIndex: Number.isFinite(Number(activePart.segmentIndex)) ? Number(activePart.segmentIndex) : Math.max(0, activeIndex),
        source: String(activePart.sourceText || ''),
        target: String(activePart.targetText || ''),
        sourceFocusedRange: activePart.sourceFocusedRange || null,
        targetFocusedRange: activePart.targetFocusedRange || null
      },
      languages: {
        source: String(document.sourceLanguage || ''),
        target: String(document.targetLanguage || '')
      },
      context: {
        above: ordered.slice(Math.max(0, activeIndex - 2), activeIndex).map((part) => String(part.sourceText || '')).filter(Boolean).join('\n'),
        below: ordered.slice(activeIndex + 1, activeIndex + 3).map((part) => String(part.sourceText || '')).filter(Boolean).join('\n'),
        summary: `Document: ${String(document.documentName || '')}\nCurrent source: ${String(activePart.sourceText || '').slice(0, 500)}\nCurrent target: ${String(activePart.targetText || '').slice(0, 500)}`,
        fullText: ordered.map((part) => String(part.sourceText || '')).filter(Boolean).join('\n')
      },
      revision: {
        previewRevision: Number(document.revision || 0),
        capturedAt: String(document.updatedAt || nowIso())
      },
      mappingCertain: true
    };
  }

  /**
   */
  function readSettledActivePreviewPayload() {
    return settleActivePreviewSnapshot({
      readActive: () => buildActivePreviewQaPayload(),
      settleMs: previewSettleMs,
      maxWaits: previewSettleMaxWaits
    });
  }

  /**
   * @param {any} payload
   * @param {any} options
   */
  function prepareQaPayload(payload = {}, options = {}) {
    const activePayload = (!String(payload.segment?.source ?? payload.source ?? '').trim())
      ? ('activePreviewPayload' in options ? options.activePreviewPayload : buildActivePreviewQaPayload())
      : null;
    const effectivePayload = activePayload ? { ...activePayload, ...payload, segment: { ...(activePayload.segment || {}), ...(payload.segment || {}) } } : payload;
    const state = loadState();
    const profileId = String(effectivePayload.profileId || effectivePayload.configuration?.profileId || '').trim();
    const profile = state.profiles.find((item) => item.id === profileId)
      || state.profiles.find((item) => item.id === state.defaultProfileId)
      || null;
    let assetContext = createEmptyAssetContext();
    let effectiveAssetBindings = Array.isArray(profile?.assetBindings) ? profile.assetBindings : [];
    const assetSelection = effectivePayload.assets && typeof effectivePayload.assets === 'object' ? effectivePayload.assets : {};
    if (assetSelection.mode === 'override') {
      const selectedGlossaryIds = [...new Set((Array.isArray(assetSelection.glossaryAssetIds) ? assetSelection.glossaryAssetIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean))];
      const validGlossaryIds = new Set(state.assets
        .filter((asset) => normalizeAssetPurpose(asset.type) === ASSET_PURPOSES.glossary)
        .map((asset) => String(asset.id)));
      const invalidId = selectedGlossaryIds.find((assetId) => !validGlossaryIds.has(assetId));
      if (invalidId) {
        const error = new Error(`Glossary asset "${invalidId}" is not available.`);
        error.code = ERROR_CODES.qaInvalidRequest;
        throw error;
      }
      effectiveAssetBindings = [
        ...effectiveAssetBindings.filter((binding) => binding?.purpose !== ASSET_PURPOSES.glossary),
        ...selectedGlossaryIds.map((assetId) => ({ assetId, purpose: ASSET_PURPOSES.glossary }))
      ];
    }
    if (profile) {
      assetContext = buildAssetContext({
        assets: state.assets,
        assetBindings: effectiveAssetBindings,
        profile: { ...profile, smartTbParsingAvailable: hasSmartTbParsingCapability(state) },
        cache: parsedAssetCache
      });
    }
    const segment = {
      sourceText: String(effectivePayload.segment?.source ?? effectivePayload.source ?? ''),
      plainText: String(effectivePayload.segment?.source ?? effectivePayload.source ?? ''),
      targetText: String(effectivePayload.segment?.target ?? effectivePayload.target ?? '')
    };
    const languagePayload = {
      sourceLanguage: String(effectivePayload.languages?.source || effectivePayload.sourceLanguage || ''),
      targetLanguage: String(effectivePayload.languages?.target || effectivePayload.targetLanguage || '')
    };
    const tbContext = buildSegmentTbContext({ assetContext, segment, payload: languagePayload, metadata: payload.metadata || {} });
    const customTm = buildSegmentCustomTmContext({ assetContext, segment, payload: languagePayload, profile });
    const rules = [
      ...(Array.isArray(effectivePayload.rules) ? effectivePayload.rules : []),
      ...(Array.isArray(profile?.qaRules) ? profile.qaRules.filter((rule) => rule.type !== 'natural-language') : [])
    ];
    const requestedPresetId = String(effectivePayload.prompt?.presetId || '').trim();
    const promptPreset = state.promptPresets.find((item) => item.id === requestedPresetId && item.scope === 'qa') || null;
    const naturalLanguageRules = [
      ...(Array.isArray(profile?.qaRules)
        ? profile.qaRules.filter((rule) => rule.type === 'natural-language').map((rule) => ({ id: rule.id, instruction: rule.instruction || rule.value || '' }))
        : []),
      ...(promptPreset?.rules || []).map((rule, index) => ({ id: `${promptPreset.id}-rule-${index + 1}`, instruction: rule.instruction }))
    ];
    const additionalInstruction = String(effectivePayload.prompt?.additionalInstruction || '').slice(0, 4000);
    const qaPromptTemplate = promptPreset
      ? { systemPrompt: promptPreset.systemPrompt, userPrompt: promptPreset.userPrompt }
      : (profile?.promptTemplates?.qa || {});
    const promptVersion = crypto.createHash('sha256').update(JSON.stringify({ presetId: promptPreset?.id || '', qaPromptTemplate, naturalLanguageRules, additionalInstruction })).digest('hex');
    const requestedAiProviderId = String(effectivePayload.ai?.providerId || '').trim();
    const requestedAiModel = String(effectivePayload.ai?.model || '').trim();
    const aiProvider = state.providers.find((item) => item.id === requestedAiProviderId) || null;
    const aiModel = (aiProvider?.models || []).find((item) => item.id === requestedAiModel || item.modelName === requestedAiModel) || null;
    return {
      ...effectivePayload,
      profileId: profile?.id || profileId,
      sourceLanguage: languagePayload.sourceLanguage,
      targetLanguage: languagePayload.targetLanguage,
      terminologyMatches: tbContext.matches,
      rules,
      configuration: {
        ...(effectivePayload.configuration || {}),
        profileId: profile?.id || profileId,
        glossaryFingerprint: tbContext.fingerprint,
        tmFingerprint: customTm.fingerprint,
        promptVersion
      },
      contextPolicy: {
        ...(effectivePayload.contextPolicy || {}),
        includeSummary: effectivePayload.contextPolicy?.includeSummary === true || profile?.qaIncludeSummary === true,
        includeFullText: effectivePayload.contextPolicy?.includeFullText === true || profile?.qaIncludeFullText === true,
        maxAdjacentCharacters: Number(effectivePayload.contextPolicy?.maxAdjacentCharacters || 1200)
      },
      ai: {
        ...(effectivePayload.ai || {}),
        enabled: effectivePayload.ai?.enabled === true,
        providerName: String(aiProvider?.name || ''),
        model: String(aiModel?.modelName || requestedAiModel),
        terminology: tbContext.termHits,
        tmMatches: customTm.matches,
        naturalLanguageRules,
        promptTemplate: qaPromptTemplate,
        additionalInstruction
      }
    };
  }

  /**
   * @param {any} payload
   */
  async function prepareQaPayloadForCheck(payload = {}) {
    if (String(payload.segment?.source ?? payload.source ?? '').trim()) {
      return prepareQaPayload(payload);
    }
    const activePreviewPayload = await readSettledActivePreviewPayload();
    return prepareQaPayload(payload, { activePreviewPayload });
  }

  /**
   * @param {any} payload
   */
  function resolveAssistantProfileAndRoute(payload = {}) {
    const state = loadState();
    const requestedProfileId = String(payload.profileId || '').trim();
    const profile = state.profiles.find((item) => item.id === requestedProfileId)
      || state.profiles.find((item) => item.id === state.defaultProfileId)
      || null;
    if (!profile) {
      const error = new Error('No profile is configured for the Preview Assistant.');
      error.code = ERROR_CODES.providerNotConfigured;
      throw error;
    }
    const providerId = String(payload.providerId || profile.interactiveProviderId || profile.providerId || '').trim();
    const provider = state.providers.find((item) => item.id === providerId && item.enabled !== false)
      || state.providers.find((item) => item.enabled !== false);
    const modelId = String(payload.model || profile.interactiveModelId || '').trim();
    const model = provider
      ? ((provider.models || []).find((item) => (item.id === modelId || item.modelName === modelId) && item.enabled !== false)
        || selectModel(provider))
      : null;
    if (!provider || !model) {
      const error = new Error('No enabled provider and model are available for the Preview Assistant.');
      error.code = ERROR_CODES.providerNotConfigured;
      throw error;
    }
    let assetBindings = Array.isArray(profile.assetBindings) ? [...profile.assetBindings] : [];
    if (payload.assets?.mode === 'override') {
      const requestedIds = [...new Set((Array.isArray(payload.assets.glossaryAssetIds) ? payload.assets.glossaryAssetIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean))];
      const glossaryIds = new Set(state.assets
        .filter((asset) => normalizeAssetPurpose(asset.type) === ASSET_PURPOSES.glossary)
        .map((asset) => String(asset.id)));
      const invalidId = requestedIds.find((assetId) => !glossaryIds.has(assetId));
      if (invalidId) {
        const error = new Error(`Glossary asset "${invalidId}" is not available.`);
        error.code = ERROR_CODES.qaInvalidRequest;
        throw error;
      }
      assetBindings = [
        ...assetBindings.filter((binding) => binding?.purpose !== ASSET_PURPOSES.glossary),
        ...requestedIds.map((assetId) => ({ assetId, purpose: ASSET_PURPOSES.glossary }))
      ];
    }
    return {
      state,
      profile: { ...profile, assetBindings },
      route: {
        provider,
        model,
        routeKind: 'assistant',
        capabilities: getProviderCapabilities(provider)
      }
    };
  }

  /**
   * @param {any} payload
   */
  async function runPreviewAssistant(payload = {}) {
    const operation = payload.operation === 'polish' ? 'polish' : payload.operation === 'translate' ? 'translate' : '';
    if (!operation) {
      const error = new Error('Preview Assistant operation must be translate or polish.');
      error.code = ERROR_CODES.qaInvalidRequest;
      throw error;
    }
    const activePayload = await readSettledActivePreviewPayload();
    if (!activePayload?.mappingCertain) {
      const error = new Error('The active memoQ segment could not be mapped with confidence.');
      error.code = ERROR_CODES.qaMappingUncertain;
      throw error;
    }
    if (operation === 'polish' && !String(activePayload.segment?.target || '').trim()) {
      const error = new Error('A current target translation is required for polishing.');
      error.code = ERROR_CODES.qaInvalidRequest;
      throw error;
    }
    const requestId = String(payload.requestId || crypto.randomUUID());
    const { state, profile, route } = resolveAssistantProfileAndRoute(payload);
    const requestedPresetId = String(payload.prompt?.presetId || '').trim();
    const promptPreset = state.promptPresets.find((item) => item.id === requestedPresetId && item.scope === operation) || null;
    const additionalInstruction = String(payload.prompt?.additionalInstruction || '').slice(0, 4000);
    const operationProfile = operation === 'translate'
      ? { ...profile, usePreviewTargetText: false }
      : { ...profile };
    if (promptPreset) {
      operationProfile.translationStyle = promptPreset.style || operationProfile.translationStyle;
      operationProfile.promptTemplates = {
        ...(operationProfile.promptTemplates || {}),
        single: { systemPrompt: promptPreset.systemPrompt, userPrompt: promptPreset.userPrompt }
      };
    }
    operationProfile.assistantAdditionalInstruction = additionalInstruction;
    const snapshotPayload = prepareQaPayload({
      ...activePayload,
      profileId: profile.id,
      assets: payload.assets || { mode: 'inherit' }
    });
    const snapshot = createQaSnapshot(snapshotPayload);
    const requestState = { cancelled: false, contentHash: snapshot.revision.contentHash };
    assistantRequests.set(requestId, requestState);
    try {
      const response = await performTranslation({
        contractVersion: CONTRACT_VERSION,
        requestId,
        traceId: `assistant-${requestId}`,
        sourceLanguage: snapshot.languages.source,
        targetLanguage: snapshot.languages.target,
        requestType: 'Plaintext',
        profileResolution: { profileId: profile.id, useCase: 'interactive' },
        metadata: {
          documentId: snapshot.document.id,
          documentName: snapshot.document.name
        },
        segments: [{ index: snapshot.segment.segmentIndex, text: snapshot.segment.source, plainText: snapshot.segment.source }],
        assistantOperation: operation,
        assistantTargetText: operation === 'polish' ? snapshot.segment.target : ''
      }, {
        profileOverride: operationProfile,
        routeOverride: route,
        assistantOperation: operation,
        includeDiagnostics: true
      });
      if (requestState.cancelled) {
        const error = new Error('The Preview Assistant request was cancelled.');
        error.code = ERROR_CODES.qaRequestCancelled;
        throw error;
      }
      const currentPayload = prepareQaPayload({ profileId: profile.id, assets: payload.assets || { mode: 'inherit' } });
      const currentSnapshot = createQaSnapshot(currentPayload);
      if (currentSnapshot.revision.contentHash !== requestState.contentHash) {
        const error = new Error('The active memoQ segment changed before the Preview Assistant completed.');
        error.code = ERROR_CODES.qaRequestCancelled;
        throw error;
      }
      if (response.statusCode !== 200 || response.body?.success !== true) {
        const error = new Error(response.body?.error?.message || 'The Preview Assistant request failed.');
        error.code = response.body?.error?.code || ERROR_CODES.translationFailed;
        throw error;
      }
      return {
        requestId,
        operation,
        contentHash: snapshot.revision.contentHash,
        revision: snapshot.revision,
        text: String(response.body.translations?.[0]?.text || ''),
        providerId: String(response.body.providerId || route.provider.id || ''),
        providerName: String(route.provider.name || ''),
        model: String(response.body.model || route.model.modelName || ''),
        latencyMs: Number(response.body.diagnostics?.latencyMs || 0),
        fromCache: response.body.diagnostics?.fromCache === true,
        terminology: {
          assetIds: profile.assetBindings.filter((binding) => binding.purpose === ASSET_PURPOSES.glossary).map((binding) => binding.assetId),
          matchCount: Array.isArray(snapshotPayload.terminologyMatches) ? snapshotPayload.terminologyMatches.length : 0
        },
        segment: snapshot.segment
      };
    } finally {
      assistantRequests.delete(requestId);
    }
  }

  /**
   * @param {any} payload
   */
  function cancelPreviewAssistant(payload = {}) {
    const requestId = String(payload.requestId || '').trim();
    let cancelled = 0;
    for (const [activeRequestId, request] of assistantRequests.entries()) {
      if (!requestId || activeRequestId === requestId) {
        request.cancelled = true;
        cancelled += 1;
      }
    }
    return { ok: true, cancelled };
  }

  /**
   * @param {any} payload
   * @param {any} segments
   * @param {any} concurrency
   */
  async function checkQaSegmentsWithConcurrency(payload, segments, concurrency = 3) {
    const items = Array.isArray(segments) ? segments : [];
    const results = new Array(items.length);
    let cursor = 0;
    /**
     */
    async function worker() {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await qaCoordinator.checkSegment(prepareQaPayload({
          ...payload,
          requestId: crypto.randomUUID(),
          segment: { ...items[index], segmentIndex: items[index].segmentIndex ?? index }
        }));
      }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()));
    return results;
  }

  let lastAutomaticQaRevision = -1;
  let pendingAutomaticQaRevision = -1;
  const previewQaTimer = typeof previewContextClient?.readActiveDocument === 'function'
    ? setInterval(() => {
      try {
        const activePayload = buildActivePreviewQaPayload();
        if (qaCoordinator.getStatus().paused) return;
        const revision = Number(activePayload?.revision?.previewRevision || 0);
        if (!activePayload?.mappingCertain || !revision || revision === lastAutomaticQaRevision) return;
        if (revision !== pendingAutomaticQaRevision) {
          pendingAutomaticQaRevision = revision;
          return;
        }
        lastAutomaticQaRevision = revision;
        pendingAutomaticQaRevision = -1;
        const state = loadState();
        const profile = state.profiles.find((item) => item.id === state.defaultProfileId) || null;
        void qaCoordinator.checkSegment(prepareQaPayload({
          ...activePayload,
          profileId: profile?.id || '',
          ai: {
            enabled: profile?.qaRealtimeAiEnabled === true,
            providerId: profile?.interactiveProviderId || profile?.providerId || '',
            model: profile?.interactiveModelId || ''
          }
        }));
      } catch (/** @type {any} */ error) {
        runtimeLogger.warn('qa-preview-check-skipped', 'Automatic local QA could not inspect the active Preview segment.', { error });
      }
    }, 750)
    : null;
  previewQaTimer?.unref?.();

  /**
   */
  function getStatus() {
    const status = qaCoordinator.getStatus();
    let currentSnapshot = null;
    try {
      const activePreview = buildActivePreviewQaPayload();
      if (activePreview?.mappingCertain && String(activePreview.segment?.source || '').trim()) {
        const prepared = prepareQaPayload({
          ...activePreview,
          profileId: status.latestResult?.configuration?.profileId || '',
          contextPolicy: status.latestResult?.contextPolicy || {}
        });
        const snapshot = createQaSnapshot({
          ...prepared,
          configuration: status.latestResult?.configuration || prepared.configuration
        });
        currentSnapshot = {
          documentId: snapshot.document.id,
          documentName: snapshot.document.name,
          previewPartId: snapshot.segment.previewPartId,
          segmentIndex: snapshot.segment.segmentIndex,
          source: snapshot.segment.source,
          target: snapshot.segment.target,
          languages: snapshot.languages,
          previewRevision: snapshot.revision.previewRevision,
          contentHash: snapshot.revision.contentHash
        };
      }
    } catch {
    }
    const latestMatchesCurrent = Boolean(currentSnapshot?.contentHash && status.latestResult?.contentHash === currentSnapshot.contentHash);
    return {
      ...status,
      currentSnapshot,
      latestResultStale: Boolean(status.latestResult && currentSnapshot && !latestMatchesCurrent),
      latestResult: latestMatchesCurrent ? status.latestResult : null
    };
  }

  /**
   * @param {any} payload
   */
  async function checkSegment(payload = {}) {
    return qaCoordinator.checkSegment(await prepareQaPayloadForCheck({ trigger: 'manual', ...payload }));
  }

  /**
   * @param {any} payload
   */
  async function checkDocument(payload = {}) {
    const segments = Array.isArray(payload.segments) ? payload.segments : [];
    if (!segments.length) {
      const error = new Error('At least one segment is required for a document quality check.');
      error.code = ERROR_CODES.qaInvalidRequest;
      throw error;
    }
    const results = await checkQaSegmentsWithConcurrency(
      { trigger: payload.trigger || 'batch', ...payload },
      segments,
      payload.ai?.enabled ? 3 : 8
    );
    return {
      document: payload.document || { id: payload.documentId || 'imported-document', name: payload.documentName || '' },
      status: results.some((item) => item.status === 'local-only') ? 'local-only' : 'complete',
      summary: createSummary(results.flatMap((item) => item.findings)),
      results
    };
  }

  /**
   */
  function dispose() {
    if (previewQaTimer) clearInterval(previewQaTimer);
    cancelPreviewAssistant();
    assistantRequests.clear();
    qaCoordinator.dispose();
  }

  return {
    cancel: (payload) => qaCoordinator.cancel(payload),
    cancelAssistant: cancelPreviewAssistant,
    checkDocument,
    checkSegment,
    dispose,
    getStatus,
    listResults: (documentId) => qaCoordinator.listResults(documentId),
    runAssistant: runPreviewAssistant,
    saveFeedback: (payload) => qaCoordinator.saveFeedback(payload)
  };
}

module.exports = { createRuntimeQaService };
