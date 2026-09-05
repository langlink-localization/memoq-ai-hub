const { buildAssetContext } = require('../asset/assetContext');
const { evaluateTerminologyQa } = require('../asset/assetTerminology');
const {
  getProviderCapabilities,
  mapProviderError
} = require('../provider/providerRegistry');
const {
  extractRetryAfterSeconds,
  normalizeRetryAfterSeconds
} = require('../provider/providerGovernance');
const { normalizeMemoQMetadata, normalizeSegmentMetadataItem } = require('../shared/memoqMetadataNormalizer');
const { PromptTemplateError } = require('../shared/promptTemplate');
const { CONTRACT_VERSION, ERROR_CODES } = require('../shared/desktopContract');
const { buildPreviewContextBundle } = require('../preview/previewContext');
const { enrichTranslationResult } = require('./translationConfidence');
const {
  createSingleRequestMetadata,
  createBatchRequestMetadata,
  buildHistoryPromptViewFromAttempts,
  buildHistoryEntry: buildRuntimeHistoryEntry
} = require('./runtimeHistoryBuilder');
const {
  buildSegmentTbContext,
  buildSegmentCustomTmContext,
  buildTemplatePreflightContext,
  createEmptyAssetContext,
  validateRuntimePromptTemplates
} = require('./runtimePromptSupport');
const {
  validateRequestEligibility,
  createTranslationCacheKey,
  createAdaptiveTranslationCacheKey
} = require('./runtimeTranslationSupport');

const INTERACTIVE_ONLY_PREVIEW_PLACEHOLDERS = new Set([
  'target-text',
  'above-text',
  'below-text',
  'above-source-text',
  'above-target-text',
  'below-source-text',
  'below-target-text'
]);

/**
 * @param {any} value
 * @param {any} message
 */
function resolveRetryAfterSeconds(value, message = '') {
  return normalizeRetryAfterSeconds(value) ?? extractRetryAfterSeconds(message);
}

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
 * @param {any} state
 */
function hasSmartTbParsingCapability(state = {}) {
  return (Array.isArray(state.providers) ? state.providers : []).some((provider) => {
    if (!provider || provider.enabled === false) return false;
    return Array.isArray(provider.models) && provider.models.some((model) => model?.enabled !== false);
  });
}

/**
 * @param {any} segmentLevelMetadata
 */
function buildSegmentMetadataIndex(segmentLevelMetadata = []) {
  return new Map(
    (Array.isArray(segmentLevelMetadata) ? segmentLevelMetadata : []).map((item) => [
      Number.isFinite(Number(item.segmentIndex)) ? Number(item.segmentIndex) : -1,
      item
    ])
  );
}

function createRuntimeTranslationService({
  aggregateRescueBatchSize,
  aggregateRescueSingleTimeoutMs,
  consumeTranslationCacheBypass,
  createId,
  loadState,
  saveState,
  parsedAssetCache,
  persistence,
  previewContextClient,
  previewContextResolver,
  previewState,
  profileService,
  providerExecution,
  providerRegistry,
  runtimeIdentity,
  secretStore,
  nowIso
}) {
  /**
   * @param {any} provider
   * @param {any} modelId
   */
  function selectRouteModel(provider, modelId = '') {
    const models = Array.isArray(provider?.models) ? provider.models : [];
    const requestedId = String(modelId || '').trim();
    if (requestedId) {
      const explicit = models.find((model) => model.id === requestedId && model.enabled !== false);
      if (explicit) {
        return explicit;
      }
    }
    return selectModel(provider);
  }

  /**
   * @param {any} segments
   * @param {any} providerCapabilities
   */
  function splitSegmentsForRoute(segments, providerCapabilities = {}) {
    const maxSegments = Number(providerCapabilities.maxBatchSegments || 0);
    const maxCharacters = Number(providerCapabilities.maxBatchCharacters || 0);
    const supportsBatch = providerCapabilities.supportsBatch !== false;

    if (!supportsBatch || segments.length <= 1) {
      return segments.map((segment) => [segment]);
    }

    const batches = [];
    let currentBatch = [];
    let currentCharacters = 0;

    for (const segment of segments) {
      const segmentLength = String(segment.sourceText || '').length;
      const nextSegmentCount = currentBatch.length + 1;
      const nextCharacterCount = currentCharacters + segmentLength;
      const hitSegmentLimit = maxSegments > 0 && nextSegmentCount > maxSegments;
      const hitCharacterLimit = maxCharacters > 0 && currentBatch.length > 0 && nextCharacterCount > maxCharacters;

      if (currentBatch.length && (hitSegmentLimit || hitCharacterLimit)) {
        batches.push(currentBatch);
        currentBatch = [];
        currentCharacters = 0;
      }

      currentBatch.push(segment);
      currentCharacters += segmentLength;
    }

    if (currentBatch.length) {
      batches.push(currentBatch);
    }

    return batches;
  }

  /**
   * @param {any} state
   * @param {any} profile
   */
  async function resolveProviderRoute(state, profile) {
    const preferredRoutes = [
      { providerId: profile?.providerId || '', modelId: '', routeKind: 'profile' },
      { providerId: profile?.interactiveProviderId || '', modelId: profile?.interactiveModelId || '', routeKind: 'interactive' },
      { providerId: profile?.pretranslateProviderId || '', modelId: profile?.pretranslateModelId || '', routeKind: 'pretranslate' },
      { providerId: profile?.fallbackProviderId || '', modelId: profile?.fallbackModelId || '', routeKind: 'fallback' }
    ];

    const seen = new Set();
    const candidates = [];

    for (const route of preferredRoutes) {
      const providerId = String(route.providerId || '').trim();
      if (!providerId || seen.has(providerId)) {
        continue;
      }

      const provider = state.providers.find((item) => item.id === providerId && item.enabled);
      if (!provider) {
        continue;
      }

      seen.add(providerId);
      candidates.push({
        provider,
        model: selectRouteModel(provider, route.modelId),
        routeKind: route.routeKind,
        capabilities: getProviderCapabilities(provider)
      });
    }

    const fallbackProviders = state.providers.filter((item) => item.enabled && !seen.has(item.id));
    for (const provider of fallbackProviders) {
      candidates.push({
        provider,
        model: selectModel(provider),
        routeKind: 'auto',
        capabilities: getProviderCapabilities(provider)
      });
    }

    return candidates.filter((candidate) => candidate.provider && candidate.model);
  }

  async function translateBatchWithRoute({
    state,
    route,
    batch,
    secret,
    normalizedMetadata,
    profile,
    payload,
    assetContext,
    previewContext,
    requestMode,
    throughput
  }) {
    const attemptTimeoutMs = Number(throughput?.batchAttemptTimeoutMs || 60000);
    const rescueRequested = payload?.aggregation?.rescue === true;
    const batchResult = await providerExecution.run({
      route,
      isBatch: true,
      rescue: rescueRequested,
      execute: async () => providerRegistry.translateBatch({
        provider: route.provider,
        apiKey: secret,
        modelName: route.model.modelName,
        sourceLanguage: payload.sourceLanguage,
        targetLanguage: payload.targetLanguage,
        segments: batch.map((segment) => ({
          index: segment.index,
          sourceText: segment.sourceText,
          tmSource: segment.tmSource,
          tmTarget: segment.tmTarget,
          customTmMatches: segment.customTmMatches || [],
          segmentMetadata: segment.segmentMetadata,
          previewContext: segment.previewContext || null,
          tbContext: segment.tbContext || null
        })),
        metadata: normalizedMetadata,
        previewContext,
        profile,
        requestType: payload.requestType,
        operation: payload.assistantOperation || 'translate',
        timeoutMs: attemptTimeoutMs,
        assetContext,
        requestOptions: {
          localPromptCacheEnabled: !payload.assistantOperation,
          readPromptCache: (key) => persistence.readPromptResponseCache(key),
          writePromptCache: (key, text) => persistence.writePromptResponseCache(key, text, nowIso()),
          providerPromptCacheEnabled: route.model.promptCacheEnabled === true,
          promptCacheTtlHint: route.model.promptCacheTtlHint || ''
        }
      })
    });

    return {
      translations: batchResult.translations,
      latencyMs: Number(batchResult.latencyMs || 0),
      attempts: [{
        providerId: route.provider.id,
        providerName: route.provider.name,
        model: route.model.modelName,
        latencyMs: batchResult.latencyMs,
        routeKind: route.routeKind,
        success: true,
        batch: true,
        requestMode,
        effectiveExecutionMode: 'batch',
        batchSize: batch.length,
        finalizedByFallbackRoute: false,
        segmentIndexes: batch.map((segment) => segment.index),
        retryCount: batchResult.retryCount || 0,
        queuedMs: batchResult.queuedMs || 0,
        rateLimitedWaitMs: batchResult.rateLimitedWaitMs || 0,
        retryAfterSeconds: resolveRetryAfterSeconds(batchResult.retryAfterSeconds),
        providerAttemptTimeoutMs: attemptTimeoutMs,
        cacheKind: '',
        errorCode: '',
        promptCacheKey: batchResult.promptCache?.key || '',
        promptCacheLayer: batchResult.promptCache?.layer || 'none',
        promptCacheHit: batchResult.promptCache?.hit === true,
        requestMetadata: createBatchRequestMetadata({
          payload,
          profile,
          assetContext,
          previewContext,
          segments: batch,
          translations: batchResult.translations,
          requestMetadata: batchResult.requestMetadata || {}
        })
      }]
    };
  }

  async function translateSegmentsSequentially({
    state,
    route,
    segments,
    secret,
    normalizedMetadata,
    profile,
    payload,
    assetContext,
    previewContext,
    requestMode,
    throughput
  }) {
    const translations = [];
    const attempts = [];
    let latencyMs = 0;
    let lastError = null;
    const attemptTimeoutMs = Number(throughput?.singleAttemptTimeoutMs || 90000);
    const rescueRequested = payload?.aggregation?.rescue === true;

    for (const segment of segments) {
      try {
        const result = await providerExecution.run({
          route,
          rescue: rescueRequested,
          execute: async () => providerRegistry.translateSegment({
            provider: route.provider,
            apiKey: secret,
            modelName: route.model.modelName,
            sourceLanguage: payload.sourceLanguage,
            targetLanguage: payload.targetLanguage,
            sourceText: segment.sourceText,
            tmSource: segment.tmSource,
            tmTarget: segment.tmTarget,
            customTmMatches: segment.customTmMatches || [],
            metadata: normalizedMetadata,
            previewContext,
            profile,
            requestType: payload.requestType,
            operation: payload.assistantOperation || 'translate',
            timeoutMs: attemptTimeoutMs,
            assetContext,
            tbContext: segment.tbContext || null,
            segmentMetadata: segment.segmentMetadata,
            segmentPreviewContext: segment.previewContext || null,
            neighborContext: segment.neighborContext || null,
            requestOptions: {
              localPromptCacheEnabled: !payload.assistantOperation,
              readPromptCache: (key) => persistence.readPromptResponseCache(key),
              writePromptCache: (key, text) => persistence.writePromptResponseCache(key, text, nowIso()),
              providerPromptCacheEnabled: route.model.promptCacheEnabled === true,
              promptCacheTtlHint: route.model.promptCacheTtlHint || ''
            }
          })
        });
        translations.push({ index: segment.index, text: result.text });
        latencyMs += Number(result.latencyMs || 0);
        attempts.push({
          providerId: route.provider.id,
          providerName: route.provider.name,
          model: route.model.modelName,
          latencyMs: result.latencyMs,
          routeKind: route.routeKind,
          success: true,
          batch: false,
          requestMode,
          effectiveExecutionMode: 'single',
          batchSize: 1,
          finalizedByFallbackRoute: false,
          segmentIndexes: [segment.index],
          retryCount: result.retryCount || 0,
          queuedMs: result.queuedMs || 0,
          rateLimitedWaitMs: result.rateLimitedWaitMs || 0,
          retryAfterSeconds: resolveRetryAfterSeconds(result.retryAfterSeconds),
          providerAttemptTimeoutMs: attemptTimeoutMs,
          cacheKind: '',
          errorCode: '',
          promptCacheKey: result.promptCache?.key || '',
          promptCacheLayer: result.promptCache?.layer || 'none',
          promptCacheHit: result.promptCache?.hit === true,
          requestMetadata: createSingleRequestMetadata({
            payload,
            profile,
            assetContext,
            previewContext,
            segment,
            translatedText: result.text
          })
        });
      } catch (/** @type {any} */ error) {
        if (error instanceof PromptTemplateError) {
          throw error;
        }
        lastError = error?.mappedError || mapProviderError(error);
        attempts.push({
          providerId: route.provider.id,
          providerName: route.provider.name,
          model: route.model.modelName,
          latencyMs: null,
          routeKind: route.routeKind,
          success: false,
          batch: false,
          requestMode,
          effectiveExecutionMode: 'single',
          batchSize: 1,
          finalizedByFallbackRoute: false,
          segmentIndexes: [segment.index],
          retryCount: Number(error?.retryCount || 0),
          queuedMs: Number(error?.queuedMs || 0),
          rateLimitedWaitMs: Number(error?.rateLimitedWaitMs || 0),
          retryAfterSeconds: resolveRetryAfterSeconds(error?.retryAfterSeconds, lastError?.message || error?.message || ''),
          providerAttemptTimeoutMs: attemptTimeoutMs,
          cacheKind: '',
          errorCode: String(lastError?.code || ''),
          requestMetadata: createSingleRequestMetadata({
            payload,
            profile,
            assetContext,
            previewContext,
            segment,
            translatedText: ''
          }),
          error: lastError
        });
      }
    }

    return {
      translations,
      attempts,
      latencyMs,
      error: lastError
    };
  }

  /**
   * @param {any} attempts
   * @param {any} throughput
   * @param {any} extras
   */
  function annotateAttemptsWithThroughput(attempts = [], throughput, extras = {}) {
    return (Array.isArray(attempts) ? attempts : []).map((attempt) => ({
      ...attempt,
      throughputMode: throughput?.mode || '',
      throughputStatus: throughput?.status || '',
      effectiveMaxBatchSegments: Number(throughput?.maxBatchSegments || 0),
      effectiveMaxBatchCharacters: Number(throughput?.maxBatchCharacters || 0),
      effectiveConcurrencyLimit: Number(throughput?.providerConcurrency || 0),
      providerAttemptTimeoutMs: Number(
        extras.providerAttemptTimeoutMs
        || attempt.providerAttemptTimeoutMs
        || (attempt.batch ? throughput?.batchAttemptTimeoutMs : throughput?.singleAttemptTimeoutMs)
        || 0
      ),
      ...extras
    }));
  }

  function createFailedBatchAttempt({
    route,
    batch,
    error,
    payload,
    profile,
    assetContext,
    previewContext,
    requestMode,
    throughput,
    fallbackStage
  }) {
    const mappedError = error?.mappedError || mapProviderError(error);
    return {
      providerId: route.provider.id,
      providerName: route.provider.name,
      model: route.model.modelName,
      latencyMs: null,
      routeKind: route.routeKind,
      success: false,
      batch: true,
      requestMode,
      effectiveExecutionMode: 'batch',
      batchSize: batch.length,
      finalizedByFallbackRoute: false,
      segmentIndexes: batch.map((segment) => segment.index),
      retryCount: Number(error?.retryCount || 0),
      queuedMs: Number(error?.queuedMs || 0),
      rateLimitedWaitMs: Number(error?.rateLimitedWaitMs || 0),
      retryAfterSeconds: resolveRetryAfterSeconds(error?.retryAfterSeconds, mappedError?.message || error?.message || ''),
      cacheKind: '',
      errorCode: String(mappedError?.code || ''),
      requestMetadata: createBatchRequestMetadata({
        payload,
        profile,
        assetContext,
        previewContext,
        segments: batch,
        translations: [],
        requestMetadata: {
          mode: 'batch',
          batchIndexes: batch.map((segment) => segment.index),
          segmentCount: batch.length,
          fallbackStage
        }
      }),
      error: mappedError,
      throughputMode: throughput?.mode || '',
      throughputStatus: throughput?.status || '',
      effectiveMaxBatchSegments: Number(throughput?.maxBatchSegments || 0),
      effectiveMaxBatchCharacters: Number(throughput?.maxBatchCharacters || 0),
      effectiveConcurrencyLimit: Number(throughput?.providerConcurrency || 0),
      providerAttemptTimeoutMs: Number(throughput?.batchAttemptTimeoutMs || 0),
      fallbackStage
    };
  }

  async function translateBatchWithAdaptiveFallback({
    state,
    route,
    batch,
    secret,
    normalizedMetadata,
    profile,
    payload,
    assetContext,
    previewContext,
    requestMode,
    throughput,
    fallbackStage = 'batch'
  }) {
    if (batch.length <= 1) {
      const sequentialResult = await translateSegmentsSequentially({
        state,
        route,
        segments: batch,
        secret,
        normalizedMetadata,
        profile,
        payload,
        assetContext,
        previewContext,
        requestMode,
        throughput
      });
      return {
        ...sequentialResult,
        attempts: annotateAttemptsWithThroughput(sequentialResult.attempts, throughput, { fallbackStage: 'single' })
      };
    }

    try {
      const batchResult = await translateBatchWithRoute({
        state,
        route,
        batch,
        secret,
        normalizedMetadata,
        profile,
        payload,
        assetContext,
        previewContext,
        requestMode,
        throughput
      });
      return {
        translations: batchResult.translations,
        attempts: annotateAttemptsWithThroughput(batchResult.attempts, throughput, { fallbackStage }),
        latencyMs: batchResult.latencyMs,
        error: null
      };
    } catch (/** @type {any} */ error) {
      const failedBatchAttempt = createFailedBatchAttempt({
        route,
        batch,
        error,
        payload,
        profile,
        assetContext,
        previewContext,
        requestMode,
        throughput,
        fallbackStage
      });
      const midpoint = Math.ceil(batch.length / 2);
      const splitBatches = [batch.slice(0, midpoint), batch.slice(midpoint)].filter((item) => item.length);
      const translations = [];
      const attempts = [failedBatchAttempt];
      let latencyMs = 0;
      let lastError = failedBatchAttempt.error || null;

      const splitResults = await Promise.all(splitBatches.map(async (splitBatch, splitIndex) => ({
        splitIndex,
        result: await translateBatchWithAdaptiveFallback({
          state,
          route,
          batch: splitBatch,
          secret,
          normalizedMetadata,
          profile,
          payload,
          assetContext,
          previewContext,
          requestMode,
          throughput,
          fallbackStage: splitBatch.length > 1 ? 'half_batch' : 'single'
        })
      })));

      for (const { result } of splitResults.sort((/** @type {any} */ left, /** @type {any} */ right) => left.splitIndex - right.splitIndex)) {
        translations.push(...result.translations);
        attempts.push(...result.attempts);
        latencyMs += Number(result.latencyMs || 0);
        if (result.error) {
          lastError = result.error;
        }
      }

      return {
        translations,
        attempts,
        latencyMs,
        error: lastError
      };
    }
  }

  async function translatePendingSegmentsWithRoute({
    state,
    route,
    pendingSegments,
    secret,
    normalizedMetadata,
    profile,
    payload,
    assetContext,
    previewContext,
    requestMode
  }) {
    const baseThroughput = providerExecution.getThroughputSettings(route);
    const rescueRequested = payload?.aggregation?.rescue === true;
    const forceSingle = payload?.aggregation?.forceSingle === true;
    const rescueBatchSize = Number(payload?.aggregation?.rescueBatchSize || aggregateRescueBatchSize);
    const throughput = rescueRequested
      ? {
        ...baseThroughput,
        status: 'rescue',
        maxBatchSegments: forceSingle ? 1 : Math.max(1, Math.min(Number(baseThroughput.maxBatchSegments || rescueBatchSize), rescueBatchSize || aggregateRescueBatchSize)),
        maxBatchCharacters: Math.max(1, Math.min(Number(baseThroughput.maxBatchCharacters || 6000), 6000)),
        providerConcurrency: 1,
        batchAttemptTimeoutMs: Math.max(1, Math.min(Number(baseThroughput.batchAttemptTimeoutMs || 45000), 30000)),
        singleAttemptTimeoutMs: Math.max(1, Math.min(Number(baseThroughput.singleAttemptTimeoutMs || aggregateRescueSingleTimeoutMs), aggregateRescueSingleTimeoutMs))
      }
      : baseThroughput;
    const effectiveCapabilities = {
      ...route.capabilities,
      supportsBatch: forceSingle ? false : route.capabilities.supportsBatch,
      maxBatchSegments: throughput.maxBatchSegments,
      maxBatchCharacters: throughput.maxBatchCharacters
    };
    const batches = splitSegmentsForRoute(pendingSegments, effectiveCapabilities);
    const batchResults = await Promise.all(
      batches.map(async (batch, batchIndex) => {
        if (!forceSingle && batch.length > 1 && route.capabilities.supportsBatch && typeof providerRegistry.translateBatch === 'function') {
          const batchResult = await translateBatchWithAdaptiveFallback({
            state,
            route,
            batch,
            secret,
            normalizedMetadata,
            profile,
            payload,
            assetContext,
            previewContext,
            requestMode,
            throughput
          });
          return {
            batchIndex,
            translations: batchResult.translations,
            attempts: batchResult.attempts.map((attempt) => ({
              ...attempt,
              batchSplitCount: batches.length
            })),
            latencyMs: batchResult.latencyMs,
            error: batchResult.error || null
          };
        }

        const sequentialResult = await translateSegmentsSequentially({
          state,
          route,
          segments: batch,
          secret,
          normalizedMetadata,
          profile,
          payload,
          assetContext,
          previewContext,
          requestMode,
          throughput
        });
        return {
          batchIndex,
          translations: sequentialResult.translations,
          attempts: annotateAttemptsWithThroughput(sequentialResult.attempts, throughput, {
            fallbackStage: 'single',
            batchSplitCount: batches.length
          }),
          latencyMs: sequentialResult.latencyMs,
          error: sequentialResult.error || null
        };
      })
    );

    const translated = [];
    const attempts = [];
    let latencyMs = 0;
    let lastError = null;

    for (const result of batchResults.sort((/** @type {any} */ left, /** @type {any} */ right) => left.batchIndex - right.batchIndex)) {
      translated.push(...result.translations);
      attempts.push(...result.attempts);
      latencyMs += result.latencyMs;
      if (result.error && !lastError) {
        lastError = result.error;
      }
    }

    return {
      translations: translated,
      attempts,
      latencyMs,
      error: lastError
    };
  }

  /**
   * @param {any} payload
   * @param {any} internalOptions
   */
  async function performTranslation(payload, internalOptions = {}) {
    const internalAssistantOperation = internalOptions.assistantOperation === 'polish'
      ? 'polish'
      : internalOptions.assistantOperation === 'translate'
        ? 'translate'
        : '';
    if (internalAssistantOperation) {
      payload = { ...payload, assistantOperation: internalAssistantOperation, bypassTranslationCache: true };
    }
    const state = loadState();
    const requestId = payload.requestId || createId('req');
    const traceId = payload.traceId || createId('trace');

    if (String(payload.contractVersion || '') !== CONTRACT_VERSION) {
      return {
        statusCode: 409,
        body: {
          success: false,
          requestId,
          traceId,
          error: { code: ERROR_CODES.contractVersionMismatch, message: `Desktop contract version ${CONTRACT_VERSION} is required.` }
        }
      };
    }

    const normalizedMetadata = normalizeMemoQMetadata(payload.metadata || {});

    const resolved = internalOptions.profileOverride
      ? { profile: internalOptions.profileOverride, matchedRule: null }
      : profileService.resolveProfile(state, {
        ...normalizedMetadata,
        sourceLanguage: payload.sourceLanguage,
        targetLanguage: payload.targetLanguage
      }, payload.profileResolution?.profileId || '');
    const profile = resolved.profile;

    if (!profile) {
      return {
        statusCode: 400,
        body: {
          success: false,
          requestId,
          traceId,
          error: { code: ERROR_CODES.providerNotConfigured, message: 'No profile is configured yet.' }
        }
      };
    }

    const requestBypassTranslationCache = payload?.bypassTranslationCache === true
      || consumeTranslationCacheBypass(profile.id);

    const routes = internalOptions.routeOverride
      ? [internalOptions.routeOverride]
      : await resolveProviderRoute(state, profile);
    if (!routes.length) {
      return {
        statusCode: 400,
        body: {
          success: false,
          requestId,
          traceId,
          error: { code: ERROR_CODES.providerNotConfigured, message: 'No enabled provider/model route is available.' }
        }
      };
    }

    const submittedAt = nowIso();
    const translations = [];
    const attempts = [];
    let winningRoute = null;
    let totalLatencyMs = 0;
    let terminalError = null;
    let assetContext = createEmptyAssetContext();
    const smartTbParsingAvailable = hasSmartTbParsingCapability(state);
    try {
      assetContext = buildAssetContext({
        assets: state.assets,
        assetBindings: profile.assetBindings,
        profile: {
          ...profile,
          smartTbParsingAvailable
        },
        cache: parsedAssetCache
      });
    } catch (/** @type {any} */ error) {
      return {
        statusCode: 400,
        body: {
          success: false,
          requestId,
          traceId,
          error: { code: ERROR_CODES.promptTemplateInvalid, message: error.message }
        }
      };
    }
    const segmentMetadataIndex = buildSegmentMetadataIndex(normalizedMetadata.segmentLevelMetadata);
    const incomingSegments = (payload.segments || []).map((segment, idx) => {
      const segmentIndex = Number.isFinite(Number(segment.index)) ? Number(segment.index) : idx;
      return {
        index: segmentIndex,
        sourceText: String(segment.text || segment.plainText || ''),
        plainText: String(segment.plainText || segment.text || ''),
        tmSource: String(segment.tmSource || ''),
        tmTarget: String(segment.tmTarget || ''),
        tmDiagnostics: segment?.tmDiagnostics && typeof segment.tmDiagnostics === 'object'
          ? {
            supportFuzzyForwarding: segment.tmDiagnostics.supportFuzzyForwarding === true,
            tmHintsRequested: segment.tmDiagnostics.tmHintsRequested === true,
            tmSourcePresent: segment.tmDiagnostics.tmSourcePresent === true,
            tmTargetPresent: segment.tmDiagnostics.tmTargetPresent === true
          }
          : null,
        segmentMetadata: normalizeSegmentMetadataItem(segmentMetadataIndex.get(segmentIndex) || {}, segmentIndex),
        previewContext: null,
        cacheKey: ''
      };
    });
    const eligibility = validateRequestEligibility({
      payload,
      profile,
      incomingSegments,
      interactiveOnlyTokens: INTERACTIVE_ONLY_PREVIEW_PLACEHOLDERS
    });
    if (!eligibility.ok) {
      return {
        statusCode: 400,
        body: {
          success: false,
          requestId,
          traceId,
          error: { code: eligibility.code, message: eligibility.message }
        }
      };
    }
    let requestPreviewContext = null;
    let requestPreviewDebug = null;
    const resolvedPreview = await previewContextResolver.resolve({
      state,
      routes,
      profile,
      payload,
      normalizedMetadata,
      incomingSegments
    });
    requestPreviewContext = resolvedPreview.requestPreviewContext;
    requestPreviewDebug = resolvedPreview.requestPreviewDebug;

    for (const segment of incomingSegments) {
      segment.previewContext = resolvedPreview.segmentPreviewContexts.get(segment.index) || null;
      segment.previewDebugContext = resolvedPreview.segmentPreviewDebugContexts.get(segment.index) || null;
      segment.previewWarmup = resolvedPreview.previewWarmup || null;
      segment.tbContext = buildSegmentTbContext({
        assetContext,
        segment,
        payload,
        metadata: normalizedMetadata
      });
      if (payload.assistantOperation && payload.assistantTargetText) {
        segment.previewContext = {
          ...(segment.previewContext || {}),
          targetText: String(payload.assistantTargetText)
        };
      }
    }

    if (!requestPreviewContext && !incomingSegments.some((segment) => segment.previewContext)) {
      const previewBundle = buildPreviewContextBundle(previewState, incomingSegments, {
        sourceLanguage: payload.sourceLanguage,
        targetLanguage: payload.targetLanguage
      });
      requestPreviewContext = previewBundle.available
        ? {
          ...previewBundle.shared,
          fullText: profile.usePreviewFullText === true ? String(previewBundle.shared?.fullText || '') : '',
          summary: profile.usePreviewSummary === true ? String(previewBundle.shared?.summary || '') : ''
        }
        : null;
      requestPreviewDebug = requestPreviewDebug || (previewBundle.available ? {
        available: true,
        ...requestPreviewContext,
        previewAvailableFeatures: resolvedPreview.previewPolicy?.previewAvailableFeatures || [],
        reason: resolvedPreview.previewPolicy?.reason || ''
      } : requestPreviewDebug);
      for (const segment of incomingSegments) {
        segment.previewContext = segment.previewContext || previewBundle.segments.get(segment.index) || null;
        segment.previewDebugContext = segment.previewDebugContext || (segment.previewContext ? {
          available: true,
          ...segment.previewContext,
          previewAvailableFeatures: resolvedPreview.previewPolicy?.previewAvailableFeatures || [],
          reason: resolvedPreview.previewPolicy?.reason || ''
        } : segment.previewDebugContext);
      }
    }

    previewContextResolver.attachNeighborContexts(incomingSegments);
    for (const segment of incomingSegments) {
      const customTmContext = buildSegmentCustomTmContext({
        assetContext,
        segment,
        payload,
        profile
      });
      segment.customTmMatches = customTmContext.matches;
      segment.customTmFingerprint = customTmContext.fingerprint;
    }

    const effectiveRequestPreviewContext = profile.usePreviewContext === false ? null : requestPreviewContext;
    try {
      validateRuntimePromptTemplates({
        payload,
        profile,
        assetContext,
        previewContext: effectiveRequestPreviewContext,
        segments: incomingSegments
      });
    } catch (/** @type {any} */ error) {
      if (error instanceof PromptTemplateError) {
        return {
          statusCode: 502,
          body: {
            success: false,
            requestId,
            traceId,
            error: { code: ERROR_CODES.promptTemplateInvalid, message: error.message }
          }
        };
      }
      throw error;
    }

    const translatedByIndex = new Map();
    const requestMode = incomingSegments.length > 1 ? 'batch' : 'single';

    for (const route of routes) {
      try {
      let remainingSegments = incomingSegments.filter((segment) => !translatedByIndex.has(segment.index));
      if (!remainingSegments.length) {
        break;
      }

      for (const segment of remainingSegments) {
        if (!segment.cacheKey) {
          segment.cacheKey = createTranslationCacheKey({
            providerId: route.provider.id,
            modelName: route.model.modelName,
            sourceLanguage: payload.sourceLanguage,
            targetLanguage: payload.targetLanguage,
            requestType: payload.requestType,
            sourceText: segment.sourceText,
            tmSource: segment.tmSource,
            tmTarget: segment.tmTarget,
            metadata: normalizedMetadata,
            segmentMetadata: segment.segmentMetadata,
            profile,
            assetContext,
            customTmFingerprint: segment.customTmFingerprint || '',
            customTmMatches: segment.customTmMatches || [],
            tbFingerprint: segment.tbContext?.fingerprint || '',
            previewContext: effectiveRequestPreviewContext,
            segmentPreviewContext: segment.previewContext,
            previewCacheContext: requestPreviewDebug,
            segmentPreviewCacheContext: segment.previewDebugContext,
            operation: payload.assistantOperation || 'translate'
          });
        }
        if (!segment.adaptiveCacheKey) {
          segment.adaptiveCacheKey = createAdaptiveTranslationCacheKey({
            sourceLanguage: payload.sourceLanguage,
            targetLanguage: payload.targetLanguage,
            requestType: payload.requestType,
            sourceText: segment.sourceText,
            operation: payload.assistantOperation || 'translate'
          });
        }
      }

      if (profile.cacheEnabled && !requestBypassTranslationCache) {
        const unresolved = [];
        for (const segment of remainingSegments) {
          const exactCachedText = persistence.readTranslationCache(segment.cacheKey);
          const hasCustomTmMatches = Array.isArray(segment.customTmMatches) && segment.customTmMatches.length > 0;
          const adaptiveCachedText = hasCustomTmMatches ? '' : persistence.readTranslationCache(segment.adaptiveCacheKey);
          const cachedText = exactCachedText || adaptiveCachedText;
          if (cachedText) {
            translatedByIndex.set(segment.index, { index: segment.index, text: cachedText, fromCache: true });
            attempts.push({
              providerId: exactCachedText ? 'cache' : 'adaptive-cache',
              providerName: exactCachedText ? 'Cache' : 'Adaptive Cache',
              model: route.model.modelName,
              latencyMs: 0,
              routeKind: exactCachedText ? 'cache' : 'adaptive-cache',
              success: true,
              batch: false,
              requestMode,
              effectiveExecutionMode: 'cache',
              batchSize: 1,
              finalizedByFallbackRoute: false,
              segmentIndexes: [segment.index],
              cacheKind: exactCachedText ? 'exact' : 'adaptive',
              errorCode: '',
              rateLimitedWaitMs: 0,
              retryAfterSeconds: null
            });
          } else {
            unresolved.push(segment);
          }
        }
        remainingSegments = unresolved;
      }

      if (!remainingSegments.length) {
        winningRoute = winningRoute || route;
        break;
      }

      const secret = await secretStore.get(route.provider.secretRef);

      if (!secret) {
        terminalError = { code: 'PROVIDER_AUTH_FAILED', message: `${route.provider.name} API key is missing.` };
        attempts.push({
          providerId: route.provider.id,
          providerName: route.provider.name,
          model: route.model.modelName,
          latencyMs: null,
          routeKind: route.routeKind,
          success: false,
          batch: false,
          requestMode,
          effectiveExecutionMode: 'single',
          batchSize: remainingSegments.length,
          finalizedByFallbackRoute: false,
          segmentIndexes: remainingSegments.map((segment) => segment.index),
          cacheKind: '',
          errorCode: 'PROVIDER_AUTH_FAILED',
          rateLimitedWaitMs: 0,
          retryAfterSeconds: null,
          error: terminalError
        });
        continue;
      }

      const routeResult = await translatePendingSegmentsWithRoute({
        state,
        route,
        pendingSegments: remainingSegments,
        secret,
        normalizedMetadata,
        profile,
        payload,
        assetContext,
        previewContext: effectiveRequestPreviewContext,
        requestMode
      });

      totalLatencyMs += routeResult.latencyMs;
      const cacheKindForRouteAttempts = requestBypassTranslationCache
        ? 'bypassed'
        : (profile.cacheEnabled ? 'miss' : '');
      if (cacheKindForRouteAttempts) {
        routeResult.attempts.forEach((attempt) => {
          if (!attempt.cacheKind) {
            attempt.cacheKind = cacheKindForRouteAttempts;
          }
        });
      }
      attempts.push(...routeResult.attempts);
      providerExecution.recordThroughputAttempts(route, routeResult.attempts);

      for (const translation of routeResult.translations) {
        translatedByIndex.set(translation.index, translation);
        const originalSegment = remainingSegments.find((segment) => segment.index === translation.index);
        if (profile.cacheEnabled && originalSegment?.cacheKey) {
          persistence.writeTranslationCache(originalSegment.cacheKey, translation.text, nowIso());
        }
      }

      if (routeResult.translations.length) {
        winningRoute = route;
      }

      if (translatedByIndex.size === incomingSegments.length) {
        break;
      }

      if (routeResult.error) {
        terminalError = routeResult.error;
      }
      } catch (/** @type {any} */ error) {
        if (error instanceof PromptTemplateError) {
          terminalError = {
            code: ERROR_CODES.promptTemplateInvalid,
            message: error.message
          };
          break;
        }
        throw error;
      }
    }

    for (const segment of incomingSegments) {
      const translated = translatedByIndex.get(segment.index);
      if (!translated) {
        terminalError = terminalError || { code: ERROR_CODES.translationFailed, message: 'Translation failed for one or more segments.' };
        continue;
      }
      segment.qaSummary = evaluateTerminologyQa({
        sourceText: segment.sourceText,
        translatedText: translated.text,
        matches: segment.tbContext?.matches || []
      });
      translations.push(payload?.capabilities?.mtConfidenceInfo === true
        ? enrichTranslationResult({
          segment,
          translation: translated,
          targetLanguage: payload.targetLanguage,
          providerScoreComparable: winningRoute?.provider?.capabilities?.normalizedConfidenceScore === true
        })
        : { index: segment.index, text: translated.text });
    }

    if (translations.length === incomingSegments.length) {
      terminalError = null;
    }

    if (!terminalError && normalizedMetadata.documentId && previewContextClient?.recordTranslation) {
      for (const segment of incomingSegments) {
        const translated = translations.find((item) => item.index === segment.index);
        if (!translated) {
          continue;
        }

        const previewSegmentIndex = Number.isFinite(Number(segment.segmentMetadata?.segmentIndex))
          ? Number(segment.segmentMetadata.segmentIndex)
          : Number(segment.index);

        previewContextClient.recordTranslation({
          documentId: normalizedMetadata.documentId,
          sourceLanguage: payload.sourceLanguage,
          targetLanguage: payload.targetLanguage,
          segmentIndex: previewSegmentIndex,
          translatedText: translated.text
        });
      }
    }

    const completedAt = nowIso();
    const successfulProviderAttempts = attempts.filter((attempt) => (
      attempt.success
      && attempt.providerId !== 'cache'
      && attempt.providerId !== 'adaptive-cache'
    ));
    const finalizedByFallbackRoute = Boolean(
      winningRoute
      && successfulProviderAttempts.some((attempt) => (
        attempt.providerId === winningRoute.provider.id
        && attempt.routeKind === winningRoute.routeKind
      ))
      && attempts.some((attempt) => (
        !attempt.success
        && attempt.providerId !== 'cache'
        && attempt.providerId !== 'adaptive-cache'
        && (
          attempt.providerId !== winningRoute.provider.id
          || attempt.routeKind !== winningRoute.routeKind
        )
      ))
    );
    for (const attempt of attempts) {
      if (!winningRoute || !attempt.success) {
        continue;
      }
      if (attempt.providerId !== winningRoute.provider.id || attempt.routeKind !== winningRoute.routeKind) {
        continue;
      }
      attempt.finalizedByFallbackRoute = finalizedByFallbackRoute;
    }
    const effectiveExecutionMode = successfulProviderAttempts.at(-1)?.effectiveExecutionMode
      || attempts.at(-1)?.effectiveExecutionMode
      || (requestMode === 'batch' ? 'batch' : 'single');
    const derivedPromptView = buildHistoryPromptViewFromAttempts(attempts);
    const promptView = Object.keys(derivedPromptView).length
      ? derivedPromptView
      : (() => {
        if (requestMode === 'batch') {
          const request = createBatchRequestMetadata({
            payload,
            profile,
            assetContext,
            previewContext: effectiveRequestPreviewContext,
            segments: incomingSegments,
            translations,
            requestMetadata: {
              mode: 'batch',
              batchIndexes: incomingSegments.map((segment) => segment.index),
              segmentCount: incomingSegments.length
            }
          });
          return {
            batch: {
              mode: 'batch',
              requestCount: 1,
              requests: [request],
              systemPrompt: request.systemPrompt,
              items: request.items
            }
          };
        }

        const request = createSingleRequestMetadata({
          payload,
          profile,
          assetContext,
          previewContext: effectiveRequestPreviewContext,
          segment: incomingSegments[0] || {},
          translatedText: translations[0]?.text || ''
        });
        return {
          single: {
            ...request,
            requestCount: 1,
            requests: [request]
          }
        };
      })();
    const historyEntry = buildRuntimeHistoryEntry({
      createId,
      requestId,
      runtimeIdentity,
      normalizedMetadata,
      profile,
      winningRoute,
      attempts,
      requestMode,
      effectiveExecutionMode,
      finalizedByFallbackRoute,
      submittedAt,
      completedAt,
      totalLatencyMs,
      requestPreviewDebug,
      effectiveRequestPreviewContext,
      resolvedPreview,
      terminalError,
      translations,
      payloadSegments: payload.segments || [],
      segmentMetadataIndex,
      incomingSegments,
      resolved,
      assetContext,
      payload,
      buildTemplatePreflightContext
    });

    persistence.appendHistoryEntry(historyEntry);

    const latestState = loadState();
    if (resolved.matchedRule) {
      const rule = latestState.mappingRules.find((item) => item.id === resolved.matchedRule.id);
      if (rule) {
        rule.hitCount = Number(rule.hitCount || 0) + 1;
      }
    }

    if (winningRoute) {
      const provider = latestState.providers.find((item) => item.id === winningRoute.provider.id);
      if (provider) {
        provider.status = terminalError ? 'failed' : 'connected';
        provider.lastCheckedAt = completedAt;
        provider.lastError = terminalError ? terminalError.message : '';
        provider.lastLatencyMs = totalLatencyMs || null;
      }
    }

    saveState(latestState);

    if (terminalError && translations.length === 0) {
      return {
        statusCode: 502,
        body: {
          success: false,
          requestId,
          traceId,
          error: { code: terminalError.code || ERROR_CODES.translationFailed, message: terminalError.message || 'Translation failed.' }
        }
      };
    }

    return {
      statusCode: 200,
      body: {
        success: true,
        requestId,
        traceId,
        providerId: historyEntry.providerId,
        model: historyEntry.model,
        partial: Boolean(terminalError),
        error: terminalError ? { code: terminalError.code || ERROR_CODES.translationFailed, message: terminalError.message || 'Translation failed.' } : null,
        profileResolution: {
          profileId: profile.id,
          profileName: profile.name,
          ruleId: resolved.matchedRule?.id || '',
          ruleName: resolved.matchedRule?.ruleName || ''
        },
        translations,
        ...(internalOptions.includeDiagnostics ? {
          diagnostics: {
            latencyMs: totalLatencyMs,
            requestMode,
            effectiveExecutionMode,
            fromCache: attempts.length > 0 && attempts.every((attempt) => ['cache', 'adaptive-cache'].includes(attempt.providerId))
          }
        } : {})
      }
    };
  }


  return Object.freeze({ performTranslation });
}

module.exports = {
  buildSegmentMetadataIndex,
  createRuntimeTranslationService,
  hasSmartTbParsingCapability,
  selectModel
};
