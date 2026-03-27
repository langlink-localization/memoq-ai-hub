const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const {
  buildAssetContext,
  buildAssetPreview,
  getAssetImportRules,
  validateAssetImport
} = require('../asset/assetContext');
const {
  evaluateTerminologyQa,
} = require('../asset/assetTerminology');
const { createAppPaths } = require('../shared/paths');
const { createDatabase } = require('../database');
const { createSecretStore } = require('../secretStore');
const { resolveRuleMatch } = require('./runtimeRuleEngine');
const {
  createProviderRegistry,
  getProviderCapabilities,
  isSupportedProviderType,
  getDefaultModelName,
  getDefaultRequestPath,
  mapProviderError,
  validateCompatibleRequestPath,
  validateProviderRequestInput
} = require('../provider/providerRegistry');
const { summarizeRuleConditions } = require('../shared/memoqMetadata');
const { normalizeMemoQMetadata, normalizeSegmentMetadataItem } = require('../shared/memoqMetadataNormalizer');
const { createPreviewContextClient } = require('../preview/previewContextClient');
const {
  buildPreviewContextBundle,
  buildPreviewStatusSnapshot,
  normalizePreviewPart,
  normalizeSourceDocument
} = require('../preview/previewContext');
const {
  PromptTemplateError,
  createTemplateContext,
  getSupportedPlaceholders,
  renderTemplate
} = require('../shared/promptTemplate');
const {
  collectFirstReleaseProfilePlaceholderViolations,
  getFirstReleaseVisiblePlaceholders
} = require('../shared/profilePolicy');
const {
  computeRetryDelayMs,
  createRateLimiter,
  createSemaphore,
  extractRetryAfterSeconds,
  normalizeRetryAfterSeconds,
  parseRateLimitHint,
  shouldRetryProviderError
} = require('../provider/providerGovernance');
const {
  buildRuntimeIdentity
} = require('../shared/desktopMetadata');
const { PRODUCT_NAME, CONTRACT_VERSION, DEFAULT_HOST, DEFAULT_PORT, ROUTES, ERROR_CODES, PREVIEW } = require('../shared/desktopContract');
const { getIntegrationStatus, installIntegration } = require('../integration/integrationService');
const {
  isSharedOnlyPreviewRequest,
  normalizeHelperWarmupState,
  looksLikePreviewStartupTimeout
} = require('./runtimePreviewPolicy');
const {
  parseTimeMs,
  parseLocalFilterDate,
  formatLocalTimestamp,
  filterHistoryEntries
} = require('./runtimeHistory');
const {
  createSingleRequestMetadata,
  createBatchRequestMetadata,
  buildHistoryPromptViewFromAttempts,
  buildHistoryEntry: buildRuntimeHistoryEntry
} = require('./runtimeHistoryBuilder');
const {
  buildHistoryMetrics,
  buildHistorySummary,
  buildIntegrationConfig
} = require('./runtimeHistoryIntegrationSupport');
const {
  buildSegmentTbContext,
  buildTemplatePreflightContext,
  createEmptyAssetContext,
  summarizeAssets,
  validateRuntimePromptTemplates
} = require('./runtimePromptSupport');
const {
  createPreviewState,
  mergePreviewParts
} = require('./runtimePreviewStateSupport');
const {
  validateRequestEligibility,
  buildProfileReferenceMessage,
  createTranslationCacheKey,
  createAdaptiveTranslationCacheKey,
  createDocumentSummaryCacheKey,
  truncateSummarySourceText
} = require('./runtimeTranslationSupport');
const {
  createSchema,
  createRuntimePersistence
} = require('./runtimePersistence');
const {
  ensureProfile,
  ensureProviderModel,
  resolveProviderDefaultModelId,
  ensureProvider,
  ensureRule,
  ensureAsset,
  ensureIntegrationPreferences,
  normalizeState,
  __internals: {
    resolveProfilePromptTemplate
  }
} = require('./runtimeState');
const {
  createUpdateService
} = require('../update/updateService');

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

const DEFAULT_PREVIEW_CONTEXT_WAIT_MS = 1000;
const DEFAULT_PREVIEW_CONTEXT_POLL_MS = 50;
const ACTIVE_PART_ONLY_FALLBACK_GRACE_MS = 250;
const INTERACTIVE_ONLY_PREVIEW_PLACEHOLDERS = new Set([
  'target-text',
  'above-text',
  'below-text',
  'above-source-text',
  'above-target-text',
  'below-source-text',
  'below-target-text'
]);
const DEFAULT_ASSET_PREVIEW_MAX_ROWS = 50;
const DEFAULT_ASSET_PREVIEW_MAX_CHARACTERS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRetryAfterSeconds(value, message = '') {
  return normalizeRetryAfterSeconds(value) ?? extractRetryAfterSeconds(message);
}

function selectModel(provider) {
  const models = Array.isArray(provider?.models) ? provider.models : [];
  const defaultModelId = String(provider?.defaultModelId || '').trim();
  return models.find((model) => model.id === defaultModelId && model.enabled !== false)
    || models.find((model) => model.enabled)
    || models[0]
    || null;
}

function hasSmartTbParsingCapability(state = {}) {
  return (Array.isArray(state.providers) ? state.providers : []).some((provider) => {
    if (!provider || provider.enabled === false) {
      return false;
    }
    return Array.isArray(provider.models) && provider.models.some((model) => model?.enabled !== false);
  });
}

function assertSupportedProviderDraft(provider = {}) {
  if (!isSupportedProviderType(provider?.type)) {
    throw new Error('Only OpenAI and OpenAI-compatible providers are supported.');
  }

  if (String(provider?.type || '').trim().toLowerCase() === 'openai-compatible') {
    validateCompatibleRequestPath(provider.requestPath || getDefaultRequestPath('openai-compatible'));
  }
}

async function createRuntime(options = {}) {
  const paths = createAppPaths(options);
  const db = await createDatabase(paths);
  const secretStore = createSecretStore(paths);
  const providerRegistry = options.providerRegistry || createProviderRegistry(options);
  const runtimeIdentity = buildRuntimeIdentity({
    repoRoot: paths.repoRoot,
    runtimeScriptPath: __filename,
    nowIso
  });
  const previewContextWaitMs = Number.isFinite(Number(options.previewContextWaitMs))
    ? Number(options.previewContextWaitMs)
    : DEFAULT_PREVIEW_CONTEXT_WAIT_MS;
  const previewContextPollMs = Number.isFinite(Number(options.previewContextPollMs))
    ? Number(options.previewContextPollMs)
    : DEFAULT_PREVIEW_CONTEXT_POLL_MS;
  const previewContextClient = options.previewContextClient || createPreviewContextClient({
    appDataRoot: paths.appDataRoot,
    repoRoot: paths.repoRoot,
    helperExecutablePath: options.helperExecutablePath
  });
  const previewState = createPreviewState();
  const parsedAssetCache = new Map();
  const providerSlotMap = new Map();
  const providerRateLimitMap = new Map();
  const bypassTranslationCacheProfileIds = new Set();
  let gatewayReady = false;
  createSchema(db);
  const persistence = createRuntimePersistence(db, {
    nowIso,
    normalizeState
  });
  const updateService = options.updateService || createUpdateService({
    paths,
    currentVersion: runtimeIdentity.desktopVersion,
    fetch: options.fetch,
    packagingMode: options.packagingMode,
    extractArchive: options.extractArchive,
    releaseRepository: options.releaseRepository,
    manifestUrl: options.manifestUrl,
    updateStatePath: options.updateStatePath,
    argv: options.argv
  });
  persistence.migrateLegacyState();
  previewContextClient?.start?.();

  function loadState() {
    return persistence.loadConfigState();
  }

  function saveState(state) {
    return persistence.saveConfigState(state);
  }

  function normalizeProfileId(value) {
    return String(value || '').trim();
  }

  function armTranslationCacheBypass(profileId) {
    const normalizedProfileId = normalizeProfileId(profileId);
    if (!normalizedProfileId) {
      throw new Error('Profile ID is required to bypass translation cache.');
    }

    const state = loadState();
    if (!state.profiles.some((profile) => profile.id === normalizedProfileId)) {
      throw new Error(`Profile ${normalizedProfileId} not found`);
    }

    bypassTranslationCacheProfileIds.add(normalizedProfileId);
    return {
      ok: true,
      profileId: normalizedProfileId,
      bypassPending: true
    };
  }

  function consumeTranslationCacheBypass(profileId) {
    const normalizedProfileId = normalizeProfileId(profileId);
    if (!normalizedProfileId || !bypassTranslationCacheProfileIds.has(normalizedProfileId)) {
      return false;
    }

    bypassTranslationCacheProfileIds.delete(normalizedProfileId);
    return true;
  }

  function loadHistoryEntries() {
    return persistence.listHistory();
  }

  function normalizeManualMapping(value = {}) {
    return {
      srcColumn: String(value?.srcColumn || '').trim(),
      tgtColumn: String(value?.tgtColumn || '').trim()
    };
  }

  function normalizeLanguagePair(value = {}) {
    return {
      source: String(value?.source || '').trim(),
      target: String(value?.target || '').trim()
    };
  }

  function findAssetById(state, assetId) {
    return state.assets.find((item) => item.id === String(assetId || '').trim()) || null;
  }

  function updateAssetTbState(state, assetId, nextTbState = {}) {
    const asset = findAssetById(state, assetId);
    if (!asset) {
      throw new Error(`Asset "${assetId || 'unknown'}" was not found.`);
    }

    for (const [key, value] of Object.entries(nextTbState)) {
      asset[key] = value;
    }

    parsedAssetCache.clear();
    saveState(state);
    return ensureAsset(asset);
  }

  function createDetectedTbState(asset, preview = {}) {
    if (!preview?.tbStructure || !preview?.tbStructureFingerprint) {
      return null;
    }

    return {
      tbStructure: {
        ...preview.tbStructure,
        derivedFromSha256: String(preview.tbStructure.derivedFromSha256 || asset.sha256 || ''),
        fingerprint: String(preview.tbStructure.fingerprint || preview.tbStructureFingerprint || ''),
        summary: String(preview.tbStructure.summary || preview.tbStructureSummary || '')
      },
      tbLanguagePair: normalizeLanguagePair(preview.languagePair || asset.tbLanguagePair || {}),
      tbStructureConfidence: preview.tbStructureConfidence && typeof preview.tbStructureConfidence === 'object'
        ? preview.tbStructureConfidence
        : asset.tbStructureConfidence || null,
      tbStructureSource: String(preview.tbStructureSource || asset.tbStructureSource || '').trim()
    };
  }

  function isAppliedTbStructurePreview(asset, preview = {}) {
    if (!preview?.tbStructureAvailable) {
      return false;
    }

    if (String(preview.tbStructuringMode || '').trim() === 'manual_mapping') {
      return true;
    }

    const previewFingerprint = String(preview.tbStructureFingerprint || '').trim();
    return Boolean(previewFingerprint && previewFingerprint === String(asset?.tbStructure?.fingerprint || '').trim());
  }

  function buildAssetPreviewResponse(state, asset, options = {}) {
    const preview = buildAssetPreview(asset, parsedAssetCache, {
      maxRows: options.maxRows || DEFAULT_ASSET_PREVIEW_MAX_ROWS,
      maxCharacters: options.maxCharacters || DEFAULT_ASSET_PREVIEW_MAX_CHARACTERS,
      smartParsingAvailable: hasSmartTbParsingCapability(state)
    });

    return {
      assetId: asset.id,
      assetName: asset.name,
      assetType: asset.type,
      parseStatus: 'ok',
      tbStructureApplied: isAppliedTbStructurePreview(asset, preview),
      ...preview
    };
  }

  function applyAssetTbStructure(assetId, payload = {}) {
    const state = loadState();
    const normalizedAssetId = String(assetId || '').trim();
    const asset = findAssetById(state, normalizedAssetId);
    if (!asset) {
      throw new Error(`Asset "${normalizedAssetId || 'unknown'}" was not found.`);
    }

    const preview = payload?.tbStructure && typeof payload.tbStructure === 'object'
      ? {
        tbStructure: payload.tbStructure,
        tbStructureFingerprint: String(payload.tbStructureFingerprint || payload.tbStructure?.fingerprint || '').trim(),
        tbStructureSummary: String(payload.tbStructureSummary || payload.tbStructure?.summary || '').trim(),
        tbStructureSource: String(payload.tbStructureSource || payload.tbStructure?.sourceOfTruth || '').trim(),
        languagePair: normalizeLanguagePair(payload.languagePair || payload.tbStructure?.languagePair || asset.tbLanguagePair || {}),
        tbStructureConfidence: payload.tbStructureConfidence && typeof payload.tbStructureConfidence === 'object'
          ? payload.tbStructureConfidence
          : payload.tbStructure?.confidence || asset.tbStructureConfidence || null
      }
      : buildAssetPreview(asset, parsedAssetCache, {
        maxRows: DEFAULT_ASSET_PREVIEW_MAX_ROWS,
        maxCharacters: DEFAULT_ASSET_PREVIEW_MAX_CHARACTERS,
        smartParsingAvailable: hasSmartTbParsingCapability(state)
      });
    const detectedTbState = createDetectedTbState(asset, preview);
    if (!detectedTbState) {
      throw new Error('No detected TB structure is available for this asset.');
    }

    return updateAssetTbState(state, normalizedAssetId, detectedTbState);
  }

  function saveAssetTbConfig(assetId, payload = {}) {
    const state = loadState();
    const asset = findAssetById(state, assetId);
    if (!asset) {
      throw new Error(`Asset "${assetId || 'unknown'}" was not found.`);
    }

    const manualMapping = normalizeManualMapping(payload?.manualMapping);
    const languagePair = normalizeLanguagePair(payload?.languagePair);
    if (!manualMapping.srcColumn || !manualMapping.tgtColumn) {
      throw new Error('Manual TB mapping requires both source and target columns.');
    }
    if (!languagePair.source || !languagePair.target) {
      throw new Error('TB language pair requires both source and target values.');
    }

    return updateAssetTbState(state, asset.id, {
      tbManualMapping: manualMapping,
      tbLanguagePair: languagePair,
      tbStructure: null,
      tbStructureConfidence: { level: 'high', score: 1 },
      tbStructureSource: 'manual_mapping'
    });
  }

  function markGatewayReady(ready) {
    gatewayReady = Boolean(ready);
  }

  function resolveProfile(state, metadata = {}, explicitProfileId = '') {
    if (explicitProfileId) {
      return { matchedRule: null, profile: state.profiles.find((item) => item.id === explicitProfileId) || null };
    }
    const match = resolveRuleMatch(state.mappingRules || [], metadata);
    if (!match) {
      return {
        matchedRule: null,
        profile: state.profiles.find((item) => item.id === state.defaultProfileId)
          || state.profiles.find((item) => item.name.toLowerCase() === 'default')
          || state.profiles[0]
          || null
      };
    }
    return { matchedRule: match.rule, profile: state.profiles.find((item) => item.id === match.rule.profileId) || null };
  }

  function enrichProviders(state, historyEntries = []) {
    return state.providers.map((provider) => {
      const metrics = buildHistoryMetrics(historyEntries, provider.id);
      return { ...provider, hasSecret: secretStore.has(provider.secretRef), successRate24h: metrics.successRate24h, avgLatencyMs: metrics.avgLatencyMs };
    });
  }

  async function testLocalHandshake() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(`http://${DEFAULT_HOST}:${DEFAULT_PORT}${ROUTES.desktopVersion}`, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Desktop handshake failed with status ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function buildChecklist(state, history, integration, providers) {
    return [
      { key: 'install-plugin', title: '1. Install plugin', subtitle: integration.status === 'installed' ? 'dll installed' : 'dll not installed', actionLabel: 'Install' },
      { key: 'context-builder', title: '2. Build context', subtitle: state.profiles.length ? `${state.profiles.length} profile(s)` : 'No profile yet', actionLabel: 'Configure' },
      { key: 'provider-hub', title: '3. Connect AI', subtitle: providers.filter((item) => item.enabled).length ? `${providers.filter((item) => item.enabled).length} provider(s)` : 'No provider yet', actionLabel: 'Configure' },
      { key: 'history', title: '4. Verify run', subtitle: history.length ? `${history.length} record(s)` : 'No history yet', actionLabel: 'Review' }
    ];
  }

  function buildNotices(state, providers, history, integration, updateStatus) {
    const notices = [];
    if (!integration.installations.length) notices.push('No memoQ installation directory was detected.');
    if (!providers.length) notices.push('No provider has been configured yet.');
    const unhealthy = providers.filter((provider) => provider.enabled && provider.status === 'failed');
    if (unhealthy.length) notices.push(`${unhealthy.map((provider) => provider.name).join(', ')} need attention.`);
    const latest = history[0];
    if (latest) notices.push(latest.status === 'success' ? `Latest translation succeeded: ${latest.requestId}` : `Latest translation failed: ${latest.requestId}`);

    const previewStatus = String(previewState.status || '').trim().toLowerCase();
    if (previewStatus === 'connected') {
      notices.push(`Preview bridge connected: ${previewState.activePreviewPartIds.length || 0} active part(s), ${previewState.previewPartsById.size || 0} cached part(s).`);
    } else if (previewStatus === 'error' && previewState.lastError) {
      notices.push(`Preview bridge unavailable: ${previewState.lastError}`);
    }

    if (updateStatus?.updateStatus === 'available' && updateStatus?.latestVersion) {
      notices.push(`Update available: ${updateStatus.latestVersion}.`);
    } else if (updateStatus?.updateStatus === 'prepared' && updateStatus?.preparedDirectory) {
      notices.push(`A prepared update is ready at ${updateStatus.preparedDirectory}.`);
    } else if (updateStatus?.updateStatus === 'error' && updateStatus?.lastError) {
      notices.push(`Update check failed: ${updateStatus.lastError}`);
    }

    if (!notices.length) notices.push('The app is ready for first-time configuration.');
    return notices;
  }

  function updatePreviewBridgeStatus(statusPatch = {}) {
    if (typeof statusPatch !== 'object' || !statusPatch) {
      return buildPreviewStatusSnapshot(previewState);
    }

    previewState.status = String(statusPatch.status || previewState.status || 'disconnected').trim() || 'disconnected';
    previewState.statusMessage = String(statusPatch.statusMessage || previewState.statusMessage || '').trim();
    previewState.serviceBaseUrl = String(statusPatch.serviceBaseUrl || previewState.serviceBaseUrl || PREVIEW.serviceBaseUrl || '').trim();
    previewState.sessionId = String(statusPatch.sessionId || previewState.sessionId || '').trim();
    previewState.callbackAddress = String(statusPatch.callbackAddress || previewState.callbackAddress || '').trim();
    previewState.connectedAt = String(statusPatch.connectedAt || previewState.connectedAt || '').trim();
    previewState.lastUpdatedAt = String(statusPatch.lastUpdatedAt || nowIso()).trim();
    previewState.lastError = String(statusPatch.lastError || '').trim();
    return buildPreviewStatusSnapshot(previewState);
  }

  function ingestPreviewContentUpdate(payload = {}) {
    const previewParts = payload.PreviewParts || payload.previewParts || [];
    mergePreviewParts(previewState, previewParts);
    previewState.lastUpdatedAt = nowIso();
    return buildPreviewStatusSnapshot(previewState);
  }

  function ingestPreviewHighlight(payload = {}) {
    const activePreviewParts = payload.ActivePreviewParts || payload.activePreviewParts || [];
    mergePreviewParts(previewState, activePreviewParts);
    previewState.activePreviewPartIds = activePreviewParts
      .map((item) => normalizePreviewPart(item).previewPartId)
      .filter(Boolean);
    previewState.activePreviewPartId = previewState.activePreviewPartIds[0] || '';
    const firstActivePart = previewState.activePreviewPartId ? previewState.previewPartsById.get(previewState.activePreviewPartId) : null;
    previewState.activeSourceDocument = firstActivePart?.sourceDocument || normalizeSourceDocument();
    previewState.lastUpdatedAt = nowIso();
    return buildPreviewStatusSnapshot(previewState);
  }

  function ingestPreviewPartIds(payload = {}) {
    const previewPartIds = Array.isArray(payload.PreviewPartIds || payload.previewPartIds)
      ? (payload.PreviewPartIds || payload.previewPartIds)
      : [];
    previewState.previewPartOrder = previewPartIds.map((item) => String(item || '').trim()).filter(Boolean);
    previewState.lastUpdatedAt = nowIso();
    return buildPreviewStatusSnapshot(previewState);
  }

  function syncPreviewBridgeStatusFromClient() {
    const status = previewContextClient?.getStatus?.() || {};
    const runtimeStartedMs = parseTimeMs(runtimeIdentity.runtimeStartedAt);
    const statusUpdatedAtMs = parseTimeMs(status.lastUpdatedAt);
    const normalizedStatus = String(status.state || status.status || 'disconnected').trim().toLowerCase() || 'disconnected';
    const staleStatus = !Number.isFinite(statusUpdatedAtMs) || (Number.isFinite(runtimeStartedMs) && statusUpdatedAtMs < runtimeStartedMs);
    const timeoutRetryState = looksLikePreviewStartupTimeout(status, normalizedStatus);
    const shouldTreatAsStarting = status.available !== false
      && status.connected !== true
      && (staleStatus || timeoutRetryState);

    return updatePreviewBridgeStatus({
      status: status.connected ? 'connected' : (shouldTreatAsStarting ? 'starting' : normalizedStatus),
      statusMessage: status.available === false
        ? 'Preview helper executable is not available.'
        : (shouldTreatAsStarting ? 'Waiting for memoQ startup.' : ''),
      connectedAt: status.lastConnectedAt || '',
      lastUpdatedAt: status.lastUpdatedAt || nowIso(),
      lastError: shouldTreatAsStarting ? '' : (status.lastError || '')
    });
  }

  function buildSegmentMetadataIndex(segmentLevelMetadata = []) {
    return new Map(
      (Array.isArray(segmentLevelMetadata) ? segmentLevelMetadata : []).map((item) => [
        Number.isFinite(Number(item.segmentIndex)) ? Number(item.segmentIndex) : -1,
        item
      ])
    );
  }

  function getRouteExecutionKey(route) {
    return `${String(route?.provider?.id || '')}:${String(route?.model?.id || route?.model?.modelName || '')}`;
  }

  function getEffectiveConcurrencyLimit(route) {
    const explicitLimit = Number(route?.model?.concurrencyLimit);
    if (Number.isFinite(explicitLimit) && explicitLimit > 0) {
      return Math.max(1, Math.floor(explicitLimit));
    }

    const parsed = parseRateLimitHint(route?.model?.rateLimitHint || '');
    return Math.max(1, parsed.recommendedConcurrency || 1);
  }

  function getRateLimiterConfig(route) {
    const parsed = parseRateLimitHint(route?.model?.rateLimitHint || '');
    if (parsed.requestsPerSecond && parsed.requestsPerSecond > 0) {
      return {
        requestsPerWindow: Math.max(1, Math.floor(parsed.requestsPerSecond)),
        windowMs: 1000,
        smoothness: 1
      };
    }
    if (parsed.requestsPerMinute && parsed.requestsPerMinute > 0) {
      return {
        requestsPerWindow: Math.max(1, Math.floor(parsed.requestsPerMinute)),
        windowMs: 60000,
        smoothness: 1
      };
    }
    return null;
  }

  function getEffectiveRetryAttempts(route, isBatch = false) {
    if (route?.model?.retryEnabled === false) {
      return 0;
    }

    const configured = Number(route?.model?.retryAttempts);
    const fallback = isBatch ? 1 : 2;
    const budget = Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : fallback;
    return Math.min(isBatch ? 1 : 2, budget);
  }

  async function withProviderSlot(route, operation) {
    const routeKey = getRouteExecutionKey(route);
    const concurrencyLimit = getEffectiveConcurrencyLimit(route);
    let semaphore = providerSlotMap.get(routeKey);

    if (!semaphore || semaphore.limit !== concurrencyLimit) {
      semaphore = {
        limit: concurrencyLimit,
        gate: createSemaphore(concurrencyLimit)
      };
      providerSlotMap.set(routeKey, semaphore);
    }

    const slot = await semaphore.gate.acquire();
    try {
      return await operation(slot.queuedMs);
    } finally {
      slot.release();
    }
  }

  async function withProviderRateLimit(route, operation) {
    const routeKey = getRouteExecutionKey(route);
    const limiterConfig = getRateLimiterConfig(route);
    if (!limiterConfig) {
      return operation(0);
    }

    const configKey = JSON.stringify(limiterConfig);
    let limiter = providerRateLimitMap.get(routeKey);
    if (!limiter || limiter.configKey !== configKey) {
      limiter = {
        configKey,
        gate: createRateLimiter(limiterConfig)
      };
      providerRateLimitMap.set(routeKey, limiter);
    }

    const acquisition = await limiter.gate.acquire();
    return operation(acquisition.rateLimitedWaitMs || 0);
  }

  async function runProviderCallWithGovernance({ route, isBatch = false, execute }) {
    const maxRetries = getEffectiveRetryAttempts(route, isBatch);
    let retryCount = 0;
    let totalQueuedMs = 0;
    let totalRateLimitedWaitMs = 0;
    let retryAfterSeconds = null;

    while (true) {
      try {
        const result = await withProviderRateLimit(route, async (rateLimitedWaitMs) => {
          totalRateLimitedWaitMs += rateLimitedWaitMs;
          return withProviderSlot(route, async (queuedMs) => {
            totalQueuedMs += queuedMs;
            return execute({
              retryCount,
              queuedMs,
              totalQueuedMs,
              rateLimitedWaitMs,
              totalRateLimitedWaitMs,
              retryAfterSeconds
            });
          });
        });

        return {
          ...result,
          retryCount,
          queuedMs: totalQueuedMs,
          rateLimitedWaitMs: totalRateLimitedWaitMs,
          retryAfterSeconds
        };
      } catch (error) {
        if (error instanceof PromptTemplateError) {
          throw error;
        }

        const mapped = error?.mappedError || mapProviderError(error);
        retryAfterSeconds = resolveRetryAfterSeconds(mapped?.retryAfterSeconds, mapped?.message || error?.message || '');
        if (retryCount >= maxRetries || !shouldRetryProviderError(mapped)) {
          const finalError = new Error(mapped.message);
          finalError.mappedError = mapped;
          finalError.retryCount = retryCount;
          finalError.queuedMs = totalQueuedMs;
          finalError.rateLimitedWaitMs = totalRateLimitedWaitMs;
          finalError.retryAfterSeconds = retryAfterSeconds;
          throw finalError;
        }

        retryCount += 1;
        await sleep(computeRetryDelayMs(mapped, retryCount));
      }
    }
  }

  function truncateDocumentText(text, maxCharacters = 18000) {
    return truncateSummarySourceText(text, maxCharacters);
  }

  function normalizeDocumentSummaryText(text, maxCharacters = 320) {
    const normalized = String(text || '').trim();
    if (!normalized) {
      return '';
    }

    const flattened = normalized
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/^\s*[A-Za-z][A-Za-z /&-]{1,40}:\s*/gm, '')
      .replace(/\n{2,}/g, '\n')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!flattened) {
      return '';
    }

    return flattened.length > maxCharacters
      ? `${flattened.slice(0, maxCharacters).trim()}...`
      : flattened;
  }

  function attachNeighborContexts(segments = []) {
    for (let index = 0; index < segments.length; index += 1) {
      const previous = segments[index - 1] || null;
      const next = segments[index + 1] || null;
      segments[index].neighborContext = {
        previousSegment: previous ? {
          index: previous.index,
          sourceText: previous.sourceText,
          targetText: previous.previewContext?.targetText || ''
        } : null,
        nextSegment: next ? {
          index: next.index,
          sourceText: next.sourceText,
          targetText: next.previewContext?.targetText || ''
        } : null
      };
    }
  }

  async function generateDocumentSummary({
    route,
    secret,
    documentName,
    documentId,
    sourceLanguage,
    targetLanguage,
    fullText
  }) {
    if (!route || !secret || !fullText || typeof providerRegistry.generateText !== 'function') {
      return '';
    }

    const result = await providerRegistry.generateText({
      provider: route.provider,
      apiKey: secret,
      modelName: route.model.modelName,
      systemPrompt: 'You generate concise, single-paragraph document summaries for translation context.',
      prompt: [
        'Summarize this source document for machine-translation context in 1-2 short sentences.',
        `Document name: ${documentName || 'Unknown document'}`,
        `Document ID: ${documentId || 'Unknown document ID'}`,
        `Source language: ${sourceLanguage || 'Unknown'}`,
        `Target language: ${targetLanguage || 'Unknown'}`,
        'Focus on the document domain, audience, required terminology, and any important formatting or structural constraints.',
        'Do not use headings, labels, bullet lists, markdown tables, or code fences.',
        'Do not exceed 320 characters.',
        'Return plain text only.',
        `Source document text:\n${truncateDocumentText(fullText)}`
      ].join('\n\n'),
      maxOutputTokens: 120,
      temperature: 0.1,
      timeoutMs: 120000
    });

    return normalizeDocumentSummaryText(result.text);
  }

  function isSharedOnlyPreviewMode(payload, incomingSegments = []) {
    const useCase = String(payload?.profileResolution?.useCase || '').trim().toLowerCase();
    const requestType = String(payload?.requestType || '').trim().toLowerCase();
    return incomingSegments.length > 1
      || useCase === 'pretranslate'
      || requestType.includes('pretranslate')
      || requestType.includes('batch');
  }

  function buildPreviewFeaturePolicy(profile, payload, incomingSegments = []) {
    const sharedOnly = isSharedOnlyPreviewMode(payload, incomingSegments);
    const includeFullText = profile?.usePreviewFullText === true;
    const includeSummary = profile?.usePreviewSummary === true;
    const wantsLocalContext = profile?.usePreviewAboveBelow === true || profile?.usePreviewTargetText === true;

    return {
      sharedOnly,
      includeFullText,
      includeSummary,
      includeTargetText: !sharedOnly && profile?.usePreviewTargetText === true,
      includeAboveContext: !sharedOnly && profile?.usePreviewAboveBelow === true,
      includeBelowContext: !sharedOnly && profile?.usePreviewAboveBelow === true,
      includeSharedContext: includeFullText || includeSummary,
      wantsLocalContext,
      wantsLocalContextInPrompt: !sharedOnly && wantsLocalContext,
      previewAvailableFeatures: [
        includeFullText ? 'fullText' : '',
        includeSummary ? 'summary' : '',
        !sharedOnly && profile?.usePreviewTargetText === true ? 'targetText' : '',
        !sharedOnly && profile?.usePreviewAboveBelow === true ? 'above' : '',
        !sharedOnly && profile?.usePreviewAboveBelow === true ? 'below' : ''
      ].filter(Boolean),
      reason: sharedOnly && wantsLocalContext ? 'batch_shared_only_mode' : ''
    };
  }

  function buildRequestPreviewDebugContext(previewContext, lookup, policy, summaryDebug = null) {
    if (previewContext) {
      return {
        available: true,
        ...previewContext,
        previewAvailableFeatures: policy.previewAvailableFeatures,
        activePreviewPartIds: Array.isArray(lookup?.activePreviewPartIds) ? lookup.activePreviewPartIds : [],
        previewPartId: String(lookup?.previewPartId || ''),
        previewMatchMode: String(lookup?.previewMatchMode || ''),
        sourceFocusedRange: lookup?.sourceFocusedRange || null,
        targetFocusedRange: lookup?.targetFocusedRange || null,
        neighborSource: String(lookup?.neighborSource || ''),
        targetTextSource: String(lookup?.targetTextSource || ''),
        reason: policy.reason || '',
        summary: summaryDebug
      };
    }

    if (lookup) {
      return {
        available: false,
        documentId: String(lookup.documentId || ''),
        documentName: String(lookup.documentName || ''),
        importPath: String(lookup.importPath || ''),
        previewAvailableFeatures: policy.previewAvailableFeatures,
        activePreviewPartIds: Array.isArray(lookup.activePreviewPartIds) ? lookup.activePreviewPartIds : [],
        previewPartId: String(lookup.previewPartId || ''),
        previewMatchMode: String(lookup.previewMatchMode || ''),
        sourceFocusedRange: lookup.sourceFocusedRange || null,
        targetFocusedRange: lookup.targetFocusedRange || null,
        neighborSource: String(lookup.neighborSource || ''),
        targetTextSource: String(lookup.targetTextSource || ''),
        reason: String(lookup.reason || policy.reason || ''),
        summary: summaryDebug
      };
    }

    if (!policy.previewAvailableFeatures.length && !policy.reason) {
      return null;
    }

    return {
      available: false,
      previewAvailableFeatures: policy.previewAvailableFeatures,
      reason: policy.reason || 'document_not_cached',
      summary: summaryDebug
    };
  }

  function createSummaryDebugContext(policy) {
    return {
      requested: policy?.includeSummary === true,
      cacheKey: '',
      cacheHit: false,
      generated: false,
      available: false,
      routeProviderId: '',
      routeProviderName: '',
      routeModel: '',
      skipReason: '',
      error: ''
    };
  }

  function createPreviewWarmupDebug() {
    return {
      attempted: false,
      timedOut: false,
      waitedMs: 0,
      pollCount: 0,
      coldStart: false,
      helperStateAtStart: '',
      helperStateAtEnd: '',
      documentCacheSeen: false,
      documentCacheUpdatedAt: '',
      resolvedOnPoll: 0,
      activePreviewPartSeen: false,
      focusedRangeSeen: false
    };
  }

  function finalizePreviewWarmupDebug(warmup, timedOut = false) {
    if (!warmup) {
      return null;
    }

    return {
      attempted: Boolean(warmup.attempted),
      timedOut: Boolean(timedOut),
      waitedMs: Math.max(0, Date.now() - Number(warmup.startedAtMs || Date.now())),
      pollCount: Number(warmup.pollCount || 0),
      coldStart: Boolean(warmup.coldStart),
      helperStateAtStart: String(warmup.helperStateAtStart || ''),
      helperStateAtEnd: String(warmup.helperStateAtEnd || warmup.helperStateAtStart || ''),
      documentCacheSeen: Boolean(warmup.documentCacheSeen),
      documentCacheUpdatedAt: String(warmup.documentCacheUpdatedAt || ''),
      resolvedOnPoll: Number(warmup.resolvedOnPoll || 0),
      activePreviewPartSeen: Boolean(warmup.activePreviewPartSeen),
      focusedRangeSeen: Boolean(warmup.focusedRangeSeen)
    };
  }

  function reconcilePreviewWarmupDebug(warmup, {
    requestPreviewContext = null,
    segmentPreviewContexts = new Map()
  } = {}) {
    if (!warmup || warmup.timedOut !== true) {
      return warmup;
    }

    const hasResolvedSharedContext = Boolean(requestPreviewContext);
    const hasResolvedLocalContext = segmentPreviewContexts instanceof Map
      ? segmentPreviewContexts.size > 0
      : Array.isArray(segmentPreviewContexts) && segmentPreviewContexts.length > 0;

    if (!hasResolvedSharedContext && !hasResolvedLocalContext) {
      return warmup;
    }

    return {
      ...warmup,
      timedOut: false,
      resolvedOnPoll: Number(warmup.resolvedOnPoll || warmup.pollCount || 1),
      documentCacheSeen: true
    };
  }

  function resolvePreviewMissReason({ lookup, policy, warmup, wantsLocalContext = false }) {
    if (lookup?.available) {
      return String(policy?.reason || lookup.reason || '');
    }

    if (warmup?.attempted && warmup.timedOut) {
      if (!warmup.documentCacheSeen) {
        return warmup.helperStateAtEnd === 'connected' || warmup.helperStateAtStart === 'connected'
          ? 'document_cache_not_ready_in_time'
          : 'helper_not_connected_in_time';
      }

      if (wantsLocalContext) {
        if (!warmup.activePreviewPartSeen) {
          return 'active_part_not_ready_in_time';
        }
        if (lookup?.reason === 'segment_not_aligned_with_active_part') {
          return 'segment_not_aligned_with_active_part';
        }
        if (lookup?.reason === 'active_part_without_range' || !warmup.focusedRangeSeen) {
          return 'active_part_without_range';
        }
      }

      return 'preview_warmup_timeout';
    }

    return String(lookup?.reason || policy?.reason || 'document_not_cached');
  }

  function buildSegmentPreviewDebugContext(segmentLookup, policy) {
    if (segmentLookup) {
      return {
        available: Boolean(segmentLookup.available),
        documentId: String(segmentLookup.documentId || ''),
        documentName: String(segmentLookup.documentName || ''),
        previewPartId: String(segmentLookup.previewPartId || ''),
        activePreviewPartIds: Array.isArray(segmentLookup.activePreviewPartIds) ? segmentLookup.activePreviewPartIds : [],
        previewMatchMode: String(segmentLookup.previewMatchMode || ''),
        sourceFocusedRange: segmentLookup.sourceFocusedRange || null,
        targetFocusedRange: segmentLookup.targetFocusedRange || null,
        neighborSource: String(segmentLookup.neighborSource || ''),
        targetTextSource: String(segmentLookup.targetTextSource || ''),
        targetText: String(segmentLookup.targetText || ''),
        above: String(segmentLookup.aboveText || ''),
        below: String(segmentLookup.belowText || ''),
        resolvedRange: segmentLookup.resolvedRange || null,
        previewAvailableFeatures: policy.previewAvailableFeatures,
        reason: String(segmentLookup.reason || policy.reason || '')
      };
    }

    if (!policy.previewAvailableFeatures.length && !policy.reason) {
      return null;
    }

    return {
      available: false,
      previewAvailableFeatures: policy.previewAvailableFeatures,
      reason: policy.reason || 'segment_not_aligned_with_active_part'
    };
  }

  async function resolvePreviewContexts({
    state,
    routes,
    profile,
    payload,
    normalizedMetadata,
    incomingSegments
  }) {
    syncPreviewBridgeStatusFromClient();
    const previewPolicy = buildPreviewFeaturePolicy(profile, payload, incomingSegments);

    if (
      profile?.usePreviewContext !== true
      || !normalizedMetadata.documentId
      || !payload.sourceLanguage
      || !payload.targetLanguage
      || !previewContextClient
    ) {
      return {
        requestPreviewContext: null,
        requestPreviewDebug: null,
        segmentPreviewContexts: new Map(),
        segmentPreviewDebugContexts: new Map(),
        previewWarmup: null,
        previewPolicy
      };
    }

    async function waitForPreviewContextCacheReady() {
      const warmup = {
        ...createPreviewWarmupDebug(),
        attempted: true,
        startedAtMs: Date.now()
      };

      if (previewContextWaitMs <= 0 || !previewContextClient) {
        return finalizePreviewWarmupDebug(warmup, false);
      }

      if (!previewPolicy.includeSharedContext && !previewPolicy.wantsLocalContextInPrompt) {
        warmup.attempted = false;
        return finalizePreviewWarmupDebug(warmup, false);
      }

      const helperStatus = previewContextClient?.getStatus?.() || {};
      warmup.helperStateAtStart = normalizeHelperWarmupState(helperStatus);
      warmup.helperStateAtEnd = warmup.helperStateAtStart;
      if (warmup.helperStateAtStart === 'missing') {
        return finalizePreviewWarmupDebug(warmup, false);
      }

      const initialRawDocument = typeof previewContextClient.readDocument === 'function'
        ? previewContextClient.readDocument(
          normalizedMetadata.documentId,
          payload.sourceLanguage,
          payload.targetLanguage
        )
        : null;
      const initialDocumentUpdatedAt = String(initialRawDocument?.updatedAt || '');
      const initialActivePreviewPartIds = Array.isArray(initialRawDocument?.activePreviewPartIds) ? initialRawDocument.activePreviewPartIds : [];
      const initialActiveParts = Array.isArray(initialRawDocument?.parts)
        ? initialRawDocument.parts.filter((part) => initialActivePreviewPartIds.includes(part.previewPartId))
        : [];

      warmup.coldStart = warmup.helperStateAtStart !== 'connected' || !initialRawDocument;
      warmup.documentCacheSeen = Boolean(initialRawDocument);
      warmup.documentCacheUpdatedAt = initialDocumentUpdatedAt;
      warmup.activePreviewPartSeen = initialActiveParts.length > 0;
      warmup.focusedRangeSeen = initialActiveParts.some((part) => part?.sourceFocusedRange || part?.targetFocusedRange);

      const warmupStartedAt = Date.now();
      const deadline = Date.now() + previewContextWaitMs;
      while (Date.now() <= deadline) {
        warmup.pollCount += 1;
        warmup.helperStateAtEnd = normalizeHelperWarmupState(previewContextClient?.getStatus?.() || {});

        const rawDocument = typeof previewContextClient.readDocument === 'function'
          ? previewContextClient.readDocument(
            normalizedMetadata.documentId,
            payload.sourceLanguage,
            payload.targetLanguage
          )
          : null;
        const activePreviewPartIds = Array.isArray(rawDocument?.activePreviewPartIds) ? rawDocument.activePreviewPartIds : [];
        const activeParts = Array.isArray(rawDocument?.parts)
          ? rawDocument.parts.filter((part) => activePreviewPartIds.includes(part.previewPartId))
          : [];
        const hasDocumentCache = Boolean(rawDocument);
        const hasActivePart = activeParts.length > 0;
        const hasActiveFocusedRange = activeParts.some((part) => part?.sourceFocusedRange || part?.targetFocusedRange);
        const documentUpdatedAt = String(rawDocument?.updatedAt || '');
        const hasFreshDocumentCache = hasDocumentCache && (
          !warmup.coldStart
          || !initialRawDocument
          || !initialDocumentUpdatedAt
          || documentUpdatedAt !== initialDocumentUpdatedAt
        );

        warmup.documentCacheSeen = warmup.documentCacheSeen || hasDocumentCache;
        warmup.activePreviewPartSeen = warmup.activePreviewPartSeen || hasActivePart;
        warmup.focusedRangeSeen = warmup.focusedRangeSeen || hasActiveFocusedRange;
        if (documentUpdatedAt) {
          warmup.documentCacheUpdatedAt = documentUpdatedAt;
        }

        const sharedProbe = previewContextClient.getContext({
          documentId: normalizedMetadata.documentId,
          sourceLanguage: payload.sourceLanguage,
          targetLanguage: payload.targetLanguage,
          includeFullText: previewPolicy.includeSharedContext,
          includeSummary: previewPolicy.includeSummary
        });
        if (sharedProbe?.available) {
          warmup.documentCacheSeen = true;
        }

        const sharedReady = previewPolicy.includeSharedContext
          ? (sharedProbe.available || (hasDocumentCache && hasFreshDocumentCache))
          : true;

        if (previewPolicy.wantsLocalContextInPrompt) {
          const allowActivePartOnlyFallback = (Date.now() - warmupStartedAt) >= Math.min(ACTIVE_PART_ONLY_FALLBACK_GRACE_MS, previewContextWaitMs);
          let localReady = false;

          for (const segment of incomingSegments) {
            const previewSegmentIndex = Number.isFinite(Number(segment.segmentMetadata?.segmentIndex))
              ? Number(segment.segmentMetadata.segmentIndex)
              : Number(segment.index);

            const segmentProbe = previewContextClient.getContext({
              documentId: normalizedMetadata.documentId,
              sourceLanguage: payload.sourceLanguage,
              targetLanguage: payload.targetLanguage,
              segmentIndex: previewSegmentIndex,
              sourceText: segment.plainText || segment.sourceText || segment.text || '',
              includeTargetText: previewPolicy.includeTargetText,
              includeAboveContext: previewPolicy.includeAboveContext,
              includeBelowContext: previewPolicy.includeBelowContext,
              aboveOptions: {
                maxSegments: profile.previewAboveSegments,
                maxChars: profile.previewAboveCharacters,
                includeSource: profile.previewAboveIncludeSource === true,
                includeTarget: profile.previewAboveIncludeTarget === true
              },
              belowOptions: {
                maxSegments: profile.previewBelowSegments,
                maxChars: profile.previewBelowCharacters,
                includeSource: profile.previewBelowIncludeSource === true,
                includeTarget: profile.previewBelowIncludeTarget === true
              }
            });

            warmup.documentCacheSeen = warmup.documentCacheSeen || Boolean(segmentProbe?.available);
            warmup.activePreviewPartSeen = warmup.activePreviewPartSeen
              || (Array.isArray(segmentProbe?.activePreviewPartIds) && segmentProbe.activePreviewPartIds.length > 0);
            warmup.focusedRangeSeen = warmup.focusedRangeSeen
              || Boolean(segmentProbe?.hasFocusedRange || segmentProbe?.sourceFocusedRange || segmentProbe?.targetFocusedRange);

            if (
              segmentProbe.available
              && (
                segmentProbe.hasFocusedRange
                || typeof previewContextClient.readDocument !== 'function'
              )
            ) {
              localReady = true;
              break;
            }

            if (
              allowActivePartOnlyFallback
              && (
                segmentProbe.available
                || (
                  hasDocumentCache
                  && hasFreshDocumentCache
                  && hasActivePart
                )
                || segmentProbe.reason === 'active_part_without_range'
                || segmentProbe.reason === 'segment_not_aligned_with_active_part'
              )
            ) {
              localReady = true;
              break;
            }
          }

          if (!localReady && incomingSegments.length === 0 && hasDocumentCache && hasFreshDocumentCache && (hasActiveFocusedRange || allowActivePartOnlyFallback)) {
            localReady = true;
          }

          if (localReady) {
            warmup.resolvedOnPoll = warmup.pollCount;
            return finalizePreviewWarmupDebug(warmup, false);
          }
        } else if (sharedReady) {
          warmup.resolvedOnPoll = warmup.pollCount;
          return finalizePreviewWarmupDebug(warmup, false);
        }

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          warmup.helperStateAtEnd = normalizeHelperWarmupState(previewContextClient?.getStatus?.() || {});
          return finalizePreviewWarmupDebug(warmup, true);
        }

        await sleep(Math.min(previewContextPollMs, remainingMs));
      }

      warmup.helperStateAtEnd = normalizeHelperWarmupState(previewContextClient?.getStatus?.() || {});
      return finalizePreviewWarmupDebug(warmup, true);
    }

    let previewWarmup = await waitForPreviewContextCacheReady();

    let requestPreviewContext = null;
    let requestPreviewDebug = null;
    const segmentPreviewContexts = new Map();
    const segmentPreviewDebugContexts = new Map();

    const sharedLookup = previewContextClient.getContext({
      documentId: normalizedMetadata.documentId,
      sourceLanguage: payload.sourceLanguage,
      targetLanguage: payload.targetLanguage,
      includeFullText: previewPolicy.includeSharedContext,
      includeSummary: previewPolicy.includeSummary
    });

    if (sharedLookup.available) {
      requestPreviewContext = {
        documentId: sharedLookup.documentId || normalizedMetadata.documentId,
        documentName: sharedLookup.documentName || '',
        importPath: sharedLookup.importPath || '',
        fullText: previewPolicy.includeFullText === true ? String(sharedLookup.fullText || '') : '',
        summary: ''
      };
    }

    const summaryDebug = createSummaryDebugContext(previewPolicy);

    if (!summaryDebug.requested) {
      summaryDebug.skipReason = 'summary_disabled';
    } else if (!sharedLookup.available) {
      summaryDebug.skipReason = 'preview_unavailable';
    } else if (!sharedLookup.fullText) {
      summaryDebug.skipReason = 'full_text_unavailable';
    }

    if (previewPolicy.includeSummary === true && sharedLookup.available && sharedLookup.fullText) {
      const summarizationRoute = routes.find((candidate) => secretStore.has(candidate.provider.secretRef));
      if (summarizationRoute) {
        const secret = secretStore.get(summarizationRoute.provider.secretRef);
        const summaryCacheKey = createDocumentSummaryCacheKey({
          providerId: summarizationRoute.provider.id,
          modelName: summarizationRoute.model.modelName,
          documentId: normalizedMetadata.documentId,
          sourceLanguage: payload.sourceLanguage,
          targetLanguage: payload.targetLanguage,
          fullText: sharedLookup.fullText
        });
        summaryDebug.cacheKey = summaryCacheKey;
        summaryDebug.routeProviderId = String(summarizationRoute.provider.id || '');
        summaryDebug.routeProviderName = String(summarizationRoute.provider.name || '');
        summaryDebug.routeModel = String(summarizationRoute.model.modelName || '');

        let summary = normalizeDocumentSummaryText(persistence.readDocumentSummaryCache(summaryCacheKey));
        summaryDebug.cacheHit = Boolean(summary);
        if (!summary) {
          try {
            summary = await generateDocumentSummary({
              route: summarizationRoute,
              secret,
              documentName: sharedLookup.documentName,
              documentId: normalizedMetadata.documentId,
              sourceLanguage: payload.sourceLanguage,
              targetLanguage: payload.targetLanguage,
              fullText: sharedLookup.fullText
            });
            summaryDebug.generated = Boolean(summary);
          } catch {
            summary = '';
            summaryDebug.error = 'summary_generation_failed';
          }

          if (summary) {
            persistence.writeDocumentSummaryCache(summaryCacheKey, summary, nowIso());
          }
        }

        if (requestPreviewContext) {
          requestPreviewContext.summary = summary;
        }
        summaryDebug.available = Boolean(summary);
        if (!summaryDebug.cacheHit && !summaryDebug.generated && !summaryDebug.error && !summary) {
          summaryDebug.skipReason = 'summary_empty';
        }
      } else {
        summaryDebug.skipReason = 'no_summary_route';
      }
    }

    requestPreviewDebug = buildRequestPreviewDebugContext(requestPreviewContext, sharedLookup, previewPolicy, summaryDebug);
    if (requestPreviewDebug && !requestPreviewDebug.available) {
      requestPreviewDebug.reason = resolvePreviewMissReason({
        lookup: requestPreviewDebug,
        policy: previewPolicy,
        warmup: previewWarmup,
        wantsLocalContext: previewPolicy.wantsLocalContextInPrompt
      });
    }

    for (const segment of incomingSegments) {
      if (!previewPolicy.wantsLocalContextInPrompt) {
        segmentPreviewDebugContexts.set(segment.index, buildSegmentPreviewDebugContext(null, previewPolicy));
        continue;
      }

      const previewSegmentIndex = Number.isFinite(Number(segment.segmentMetadata?.segmentIndex))
        ? Number(segment.segmentMetadata.segmentIndex)
        : Number(segment.index);

      const segmentLookup = previewContextClient.getContext({
        documentId: normalizedMetadata.documentId,
        sourceLanguage: payload.sourceLanguage,
        targetLanguage: payload.targetLanguage,
        segmentIndex: previewSegmentIndex,
        sourceText: segment.plainText || segment.sourceText || segment.text || '',
        includeTargetText: previewPolicy.includeTargetText,
        includeAboveContext: previewPolicy.includeAboveContext,
        includeBelowContext: previewPolicy.includeBelowContext,
        aboveOptions: {
          maxSegments: profile.previewAboveSegments,
          maxChars: profile.previewAboveCharacters,
          includeSource: profile.previewAboveIncludeSource === true,
          includeTarget: profile.previewAboveIncludeTarget === true
        },
        belowOptions: {
          maxSegments: profile.previewBelowSegments,
          maxChars: profile.previewBelowCharacters,
          includeSource: profile.previewBelowIncludeSource === true,
          includeTarget: profile.previewBelowIncludeTarget === true
        }
      });

      const segmentPreviewDebug = buildSegmentPreviewDebugContext(segmentLookup, previewPolicy);
      if (segmentPreviewDebug && !segmentPreviewDebug.available) {
        segmentPreviewDebug.reason = resolvePreviewMissReason({
          lookup: segmentPreviewDebug,
          policy: previewPolicy,
          warmup: previewWarmup,
          wantsLocalContext: previewPolicy.wantsLocalContextInPrompt
        });
      }
      segmentPreviewDebugContexts.set(segment.index, segmentPreviewDebug);
      if (segmentLookup.available) {
        segmentPreviewContexts.set(segment.index, {
          documentId: normalizedMetadata.documentId,
          documentName: segmentLookup.documentName || '',
          previewPartId: String(segmentLookup.previewPartId || ''),
          targetText: String(segmentLookup.targetText || ''),
          targetTextSource: String(segmentLookup.targetTextSource || ''),
          neighborSource: String(segmentLookup.neighborSource || ''),
          above: String(segmentLookup.aboveText || ''),
          below: String(segmentLookup.belowText || ''),
          resolvedRange: segmentLookup.resolvedRange || null
        });
      }
    }

    previewWarmup = reconcilePreviewWarmupDebug(previewWarmup, {
      requestPreviewContext,
      segmentPreviewContexts
    });

    return {
      requestPreviewContext,
      requestPreviewDebug,
      segmentPreviewContexts,
      segmentPreviewDebugContexts,
      previewWarmup,
      previewPolicy
    };
  }

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
      || (currentProvider ? secretStore.get(currentProvider.secretRef) : '');
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

  async function discoverProviderModelsAgainstState(state, providerDraft = {}) {
    const currentProvider = state.providers.find((item) => item.id === providerDraft.id);
    assertSupportedProviderDraft({ ...currentProvider, ...providerDraft });
    const provider = ensureProvider({
      ...currentProvider,
      ...providerDraft,
      secretRef: providerDraft.secretRef || currentProvider?.secretRef
    });
    const secret = String(providerDraft.apiKey || '').trim()
      || (currentProvider ? secretStore.get(currentProvider.secretRef) : '');

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

  function getState(filters = {}) {
    const state = loadState();
    const historyEntries = loadHistoryEntries();
    const integration = getIntegrationStatus(paths, buildIntegrationConfig(state));
    const history = filterHistoryEntries(historyEntries, filters);
    const providers = enrichProviders(state, historyEntries);
    const previewStatus = syncPreviewBridgeStatusFromClient();
    const updateStatus = updateService.getStatus();
    return {
      productName: PRODUCT_NAME,
      contractVersion: CONTRACT_VERSION,
      gatewayBaseUrl: `http://${DEFAULT_HOST}:${DEFAULT_PORT}`,
      dashboard: {
        checklist: buildChecklist(state, history, integration, providers),
        runtimeStatus: {
          memoqInstallPath: integration.selectedInstallDir || integration.installations[0]?.rootDir || 'Not detected',
          pluginStatus: integration.status,
          connectionStatus: gatewayReady ? 'Connected' : 'Disconnected',
          previewStatus
        },
        updateCenter: updateStatus,
        notices: buildNotices(state, providers, history, integration, updateStatus)
      },
      integration,
      previewBridge: previewStatus,
      updateCenter: updateStatus,
      contextBuilder: {
        profiles: state.profiles,
        defaultProfileId: state.defaultProfileId,
        assets: state.assets,
        supportedPlaceholders: getFirstReleaseVisiblePlaceholders(getSupportedPlaceholders()),
        assetImportRules: getAssetImportRules(),
        translationCacheBypassProfileIds: Array.from(bypassTranslationCacheProfileIds)
      },
      memoqMetadataMapping: {
        rules: [...state.mappingRules]
          .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999))
          .map((rule) => ({ ...rule, conditionSummary: summarizeRuleConditions(rule) }))
      },
      providerHub: {
        providers,
        summary: {
          enabled: providers.filter((item) => item.enabled).length,
          healthy: providers.filter((item) => item.enabled && item.status === 'connected').length
        }
      },
      historyExplorer: {
        items: history.map((entry) => ({
          ...entry,
          ...buildHistorySummary(entry)
        }))
      }
    };
  }

  function getAssetPreview(assetId, options = {}) {
    const state = loadState();
    const normalizedAssetId = String(assetId || '').trim();
    const asset = findAssetById(state, normalizedAssetId);
    if (!asset) {
      throw new Error(`Asset "${normalizedAssetId || 'unknown'}" was not found.`);
    }
    return buildAssetPreviewResponse(state, asset, options);
  }

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
    requestMode
  }) {
    const batchResult = await runProviderCallWithGovernance({
      route,
      isBatch: true,
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
          segmentMetadata: segment.segmentMetadata,
          previewContext: segment.previewContext || null,
          tbContext: segment.tbContext || null
        })),
        metadata: normalizedMetadata,
        previewContext,
        profile,
        requestType: payload.requestType,
        timeoutMs: 120000,
        assetContext,
        requestOptions: {
          localPromptCacheEnabled: true,
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
    requestMode
  }) {
    const translations = [];
    const attempts = [];
    let latencyMs = 0;
    let lastError = null;

    for (const segment of segments) {
      try {
        const result = await runProviderCallWithGovernance({
          route,
          execute: async () => providerRegistry.translateSegment({
            provider: route.provider,
            apiKey: secret,
            modelName: route.model.modelName,
            sourceLanguage: payload.sourceLanguage,
            targetLanguage: payload.targetLanguage,
            sourceText: segment.sourceText,
            tmSource: segment.tmSource,
            tmTarget: segment.tmTarget,
            metadata: normalizedMetadata,
            previewContext,
            profile,
            requestType: payload.requestType,
            timeoutMs: 120000,
            assetContext,
            tbContext: segment.tbContext || null,
            segmentMetadata: segment.segmentMetadata,
            segmentPreviewContext: segment.previewContext || null,
            neighborContext: segment.neighborContext || null,
            requestOptions: {
              localPromptCacheEnabled: true,
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
      } catch (error) {
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
    const batches = splitSegmentsForRoute(pendingSegments, route.capabilities);
    const batchResults = await Promise.all(
      batches.map(async (batch, batchIndex) => {
        if (batch.length > 1 && route.capabilities.supportsBatch && typeof providerRegistry.translateBatch === 'function') {
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
              requestMode
            });
            return {
              batchIndex,
              translations: batchResult.translations,
              attempts: batchResult.attempts,
              latencyMs: batchResult.latencyMs,
              error: null
            };
          } catch (error) {
            const mappedError = mapProviderError(error);
            const failedBatchAttempt = {
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
              retryAfterSeconds: resolveRetryAfterSeconds(error?.retryAfterSeconds, (error?.mappedError || mapProviderError(error))?.message || error?.message || ''),
              cacheKind: '',
              errorCode: String((error?.mappedError || mapProviderError(error))?.code || ''),
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
                  segmentCount: batch.length
                }
              }),
              error: mappedError
            };
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
              requestMode
            });
            return {
              batchIndex,
              translations: sequentialResult.translations,
              attempts: [failedBatchAttempt, ...sequentialResult.attempts],
              latencyMs: sequentialResult.latencyMs,
              error: sequentialResult.error || null
            };
          }
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
          requestMode
        });
        return {
          batchIndex,
          translations: sequentialResult.translations,
          attempts: sequentialResult.attempts,
          latencyMs: sequentialResult.latencyMs,
          error: sequentialResult.error || null
        };
      })
    );

    const translated = [];
    const attempts = [];
    let latencyMs = 0;
    let lastError = null;

    for (const result of batchResults.sort((left, right) => left.batchIndex - right.batchIndex)) {
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

  async function performTranslation(payload) {
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

    const resolved = resolveProfile(state, {
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

    const routes = await resolveProviderRoute(state, profile);
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
    } catch (error) {
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
    const resolvedPreview = await resolvePreviewContexts({
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

    attachNeighborContexts(incomingSegments);

    const effectiveRequestPreviewContext = profile.usePreviewContext === false ? null : requestPreviewContext;
    try {
      validateRuntimePromptTemplates({
        payload,
        profile,
        assetContext,
        previewContext: effectiveRequestPreviewContext,
        segments: incomingSegments
      });
    } catch (error) {
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
            tbFingerprint: segment.tbContext?.fingerprint || '',
            previewContext: effectiveRequestPreviewContext,
            segmentPreviewContext: segment.previewContext,
            previewCacheContext: requestPreviewDebug,
            segmentPreviewCacheContext: segment.previewDebugContext
          });
        }
        if (!segment.adaptiveCacheKey) {
          segment.adaptiveCacheKey = createAdaptiveTranslationCacheKey({
            sourceLanguage: payload.sourceLanguage,
            targetLanguage: payload.targetLanguage,
            requestType: payload.requestType,
            sourceText: segment.sourceText
          });
        }
      }

      if (profile.cacheEnabled && !requestBypassTranslationCache) {
        const unresolved = [];
        for (const segment of remainingSegments) {
          const exactCachedText = persistence.readTranslationCache(segment.cacheKey);
          const cachedText = exactCachedText || persistence.readTranslationCache(segment.adaptiveCacheKey);
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

      const secret = secretStore.get(route.provider.secretRef);

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
      } catch (error) {
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
        break;
      }
      translations.push({ index: segment.index, text: translated.text });
      segment.qaSummary = evaluateTerminologyQa({
        sourceText: segment.sourceText,
        translatedText: translated.text,
        matches: segment.tbContext?.matches || []
      });
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

    if (resolved.matchedRule) {
      const rule = state.mappingRules.find((item) => item.id === resolved.matchedRule.id);
      if (rule) {
        rule.hitCount = Number(rule.hitCount || 0) + 1;
      }
    }

    persistence.appendHistoryEntry(historyEntry);

    if (winningRoute) {
      const provider = state.providers.find((item) => item.id === winningRoute.provider.id);
      if (provider) {
        provider.status = terminalError ? 'failed' : 'connected';
        provider.lastCheckedAt = completedAt;
        provider.lastError = terminalError ? terminalError.message : '';
        provider.lastLatencyMs = totalLatencyMs || null;
      }
    }

    saveState(state);

    if (terminalError) {
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
        profileResolution: {
          profileId: profile.id,
          profileName: profile.name,
          ruleId: resolved.matchedRule?.id || '',
          ruleName: resolved.matchedRule?.ruleName || ''
        },
        translations
      }
    };
  }

  return {
    paths,
    markGatewayReady,
    async testHandshake() {
      return testLocalHandshake();
    },
    getDesktopVersionPayload() {
      return {
        productName: PRODUCT_NAME,
        desktopVersion: runtimeIdentity.desktopVersion,
        contractVersion: CONTRACT_VERSION,
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
        runtime: {
          ...runtimeIdentity
        },
        routes: ROUTES,
        mt: {
          maxBatchSegments: 10,
          requestTimeoutMs: 120000,
          capabilities: {
            requestTypePolicy: true,
            batching: true,
            glossary: true,
            customTm: true,
            brief: true,
            previewContext: true,
            mappingRules: true,
            history: true
          }
        },
        preview: syncPreviewBridgeStatusFromClient()
      };
    },
    getIntegrationStatus() {
      const state = loadState();
      return getIntegrationStatus(paths, buildIntegrationConfig(state));
    },
    installIntegration(config) {
      const state = loadState();
      const integrationConfig = buildIntegrationConfig(state, config);
      const result = installIntegration(paths, integrationConfig);
      state.integrationPreferences = ensureIntegrationPreferences({
        memoqVersion: integrationConfig.memoqVersion,
        customInstallDir: integrationConfig.customInstallDir,
        selectedInstallDir: result.selectedInstallDir
      });
      saveState(state);
      return result;
    },
    getAppState(filters = {}) {
      return getState(filters);
    },
    getUpdateStatus() {
      return updateService.getStatus();
    },
    async checkForUpdates(options = {}) {
      return updateService.checkForUpdates(options || {});
    },
    async downloadPortableUpdate(versionOrAssetId) {
      return updateService.downloadPortableUpdate(versionOrAssetId);
    },
    async downloadInstallerUpdate(versionOrAssetId) {
      return updateService.downloadInstallerUpdate(versionOrAssetId);
    },
    async preparePortableUpdate(downloadedFile, targetDir) {
      return updateService.preparePortableUpdate(downloadedFile, targetDir);
    },
    saveProfile(profile) {
      const state = loadState();
      const blockedTokens = collectFirstReleaseProfilePlaceholderViolations(profile);
      if (blockedTokens.length) {
        throw new Error(`First-release profiles cannot use these placeholders: ${blockedTokens.map((token) => `{{${token}}}`).join(', ')}.`);
      }
      const nextProfile = ensureProfile(profile);
      const index = state.profiles.findIndex((item) => item.id === nextProfile.id);
      if (index >= 0) state.profiles[index] = nextProfile;
      else state.profiles.push(nextProfile);
      saveState(state);
      return nextProfile;
    },
    setDefaultProfile(profileId) {
      const state = loadState();
      const normalizedProfileId = String(profileId || '').trim();
      if (normalizedProfileId && !state.profiles.some((item) => item.id === normalizedProfileId)) {
        throw new Error(`Profile ${normalizedProfileId} not found`);
      }
      state.defaultProfileId = normalizedProfileId;
      saveState(state);
      return { ok: true, defaultProfileId: state.defaultProfileId };
    },
    duplicateProfile(profileId) {
      const state = loadState();
      const source = state.profiles.find((item) => item.id === profileId);
      if (!source) throw new Error(`Profile ${profileId} not found`);
      const copy = ensureProfile({ ...source, id: createId('profile'), name: `${source.name} Copy` });
      state.profiles.push(copy);
      saveState(state);
      return copy;
    },
    deleteProfile(profileId) {
      const state = loadState();
      const profile = state.profiles.find((item) => item.id === profileId);
      if (!profile) throw new Error(`Profile ${profileId} not found`);

      const ruleReferences = state.mappingRules.filter((rule) => rule.profileId === profileId).map((rule) => rule.ruleName);
      if (ruleReferences.length) {
        throw new Error(`Profile "${profile.name}" is still used by mapping rules: ${ruleReferences.join(', ')}.`);
      }

      state.profiles = state.profiles.filter((item) => item.id !== profileId);
      bypassTranslationCacheProfileIds.delete(normalizeProfileId(profileId));
      if (state.defaultProfileId === profileId) {
        state.defaultProfileId = '';
      }
      saveState(state);
      return { ok: true };
    },
    importAssetFromPath(assetType, sourcePath) {
      const state = loadState();
      const normalizedAsset = validateAssetImport(assetType, sourcePath);
      const buffer = fs.readFileSync(sourcePath);
      const id = createId('asset');
      const fileName = path.basename(sourcePath);
      const storedPath = path.join(paths.assetsDir, `${id}-${fileName}`);
      fs.copyFileSync(sourcePath, storedPath);
      const asset = {
        id,
        type: normalizedAsset.type,
        name: fileName,
        fileName,
        storedPath,
        fileSize: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        createdAt: nowIso()
      };
      state.assets.unshift(asset);
      saveState(state);
      return asset;
    },
    deleteAsset(assetId) {
      const state = loadState();
      const asset = state.assets.find((item) => item.id === assetId);
      if (!asset) throw new Error(`Asset ${assetId} not found`);

      const referencedBy = state.profiles
        .filter((profile) => (profile.assetBindings || []).some((binding) => binding.assetId === assetId))
        .map((profile) => profile.name);
      if (referencedBy.length) {
        throw new Error(buildProfileReferenceMessage(referencedBy, `Asset "${asset.name}"`));
      }

      state.assets = state.assets.filter((item) => item.id !== assetId);
      parsedAssetCache.delete(`${asset.id}:${asset.sha256 || ''}`);
      if (asset.storedPath && fs.existsSync(asset.storedPath)) {
        fs.rmSync(asset.storedPath, { force: true });
      }
      saveState(state);
      return { ok: true };
    },
    saveMappingRule(rule) {
      const state = loadState();
      const nextRule = ensureRule(rule);
      const index = state.mappingRules.findIndex((item) => item.id === nextRule.id);
      if (index >= 0) state.mappingRules[index] = nextRule;
      else state.mappingRules.push(nextRule);
      saveState(state);
      return nextRule;
    },
    deleteMappingRule(ruleId) {
      const state = loadState();
      state.mappingRules = state.mappingRules.filter((item) => item.id !== ruleId);
      saveState(state);
      return { ok: true };
    },
    testMapping(metadata) {
      const state = loadState();
      const normalized = normalizeMemoQMetadata(metadata || {});
      const resolved = resolveProfile(state, normalized);
      return { matched: Boolean(resolved.profile), profile: resolved.profile, rule: resolved.matchedRule };
    },
    updatePreviewBridgeStatus(statusPatch) {
      return updatePreviewBridgeStatus(statusPatch || {});
    },
    ingestPreviewContentUpdate(payload) {
      return ingestPreviewContentUpdate(payload || {});
    },
    ingestPreviewHighlight(payload) {
      return ingestPreviewHighlight(payload || {});
    },
    ingestPreviewPartIds(payload) {
      return ingestPreviewPartIds(payload || {});
    },
    saveProvider(provider) {
      const state = loadState();
      const currentProvider = state.providers.find((item) => item.id === provider.id);
      assertSupportedProviderDraft({ ...currentProvider, ...provider });
      const nextProvider = ensureProvider({ ...currentProvider, ...provider, secretRef: provider.secretRef || currentProvider?.secretRef });
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
        secretStore.set(nextProvider.secretRef, provider.apiKey);
      }
      delete nextProvider.apiKey;
      const index = state.providers.findIndex((item) => item.id === nextProvider.id);
      if (index >= 0) state.providers[index] = nextProvider;
      else state.providers.push(nextProvider);
      saveState(state);
      const metrics = buildHistoryMetrics(loadHistoryEntries(), nextProvider.id);
      return { ...nextProvider, hasSecret: secretStore.has(nextProvider.secretRef), successRate24h: metrics.successRate24h, avgLatencyMs: metrics.avgLatencyMs };
    },
    async testProviderDraft(providerDraft) {
      const state = loadState();
      return testProviderDraftAgainstState(state, providerDraft || {});
    },
    async discoverProviderModels(providerDraft) {
      const state = loadState();
      return discoverProviderModelsAgainstState(state, providerDraft || {});
    },
    deleteProvider(providerId) {
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
      secretStore.delete(provider.secretRef);
      return { ok: true };
    },
    deleteProviderModel(providerId, modelId) {
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
      provider.defaultModelId = resolveProviderDefaultModelId(provider.models, provider.defaultModelId === modelId ? '' : provider.defaultModelId);
      saveState(state);
      return { ok: true };
    },
    async testProviderConnection(providerId) {
      const state = loadState();
      const provider = state.providers.find((item) => item.id === providerId);
      if (!provider) throw new Error(`Provider ${providerId} not found`);
      const result = await testProviderDraftAgainstState(state, provider);
      provider.status = result.status;
      provider.lastCheckedAt = result.testedAt || nowIso();
      provider.lastError = result.ok ? '' : result.message;
      provider.lastLatencyMs = result.latencyMs;
      saveState(state);
      return { ok: result.ok, status: provider.status, message: result.message, latencyMs: result.latencyMs, testedAt: result.testedAt };
    },
    async translate(payload) {
      const nextPayload = payload && typeof payload === 'object'
        ? { ...payload }
        : {};
      const explicitProfileId = normalizeProfileId(nextPayload?.profileResolution?.profileId);
      if (nextPayload.bypassTranslationCache !== true && explicitProfileId && consumeTranslationCacheBypass(explicitProfileId)) {
        nextPayload.bypassTranslationCache = true;
      }
      return performTranslation(nextPayload);
    },
    async storeTranslations(payload) {
      const requestId = payload.requestId || createId('store');
      const traceId = payload.traceId || createId('trace');
      const sourceLanguage = String(payload.sourceLanguage || '').trim();
      const targetLanguage = String(payload.targetLanguage || '').trim();
      const requestType = String(payload.requestType || 'Plaintext').trim() || 'Plaintext';
      const entries = Array.isArray(payload.translations) ? payload.translations : [];

      if (!sourceLanguage || !targetLanguage) {
        return {
          statusCode: 400,
          body: {
            success: false,
            requestId,
            traceId,
            error: {
              code: ERROR_CODES.requestNotEligible,
              message: 'Translation writeback requires both sourceLanguage and targetLanguage.'
            }
          }
        };
      }

      let storedCount = 0;
      for (const entry of entries) {
        const sourceText = String(entry?.sourceText || '').trim();
        const targetText = String(entry?.targetText || '').trim();
        if (!sourceText || !targetText) {
          continue;
        }

        const adaptiveCacheKey = createAdaptiveTranslationCacheKey({
          sourceLanguage,
          targetLanguage,
          requestType,
          sourceText
        });
        persistence.writeTranslationCache(adaptiveCacheKey, targetText, nowIso());
        storedCount += 1;
      }

      return {
        statusCode: 200,
        body: {
          success: true,
          requestId,
          traceId,
          storedCount
        }
      };
    },
    exportHistory(options = {}) {
      const entriesSource = loadHistoryEntries();
      const entries = options.scope === 'selected'
        ? entriesSource.filter((item) => (options.selectedIds || []).includes(item.id))
        : filterHistoryEntries(entriesSource, options.filters || {});
      const rows = entries.flatMap((entry) => entry.segments.map((segment) => ({
        requestId: entry.requestId,
        projectId: entry.projectId,
        client: entry.client,
        domain: entry.domain,
        subject: entry.subject,
        documentId: entry.documentId,
        projectGuid: entry.projectGuid,
        profile: entry.profileName,
        provider: entry.providerName,
        model: entry.model,
        submittedAt: formatLocalTimestamp(entry.submittedAt),
        completedAt: formatLocalTimestamp(entry.completedAt),
        source: segment.sourceText,
        target: segment.targetText,
        tmSource: segment.tmSource,
        tmTarget: segment.tmTarget,
        status: entry.status
      })));
      const format = options.format === 'xlsx' ? 'xlsx' : 'csv';
      const outputPath = path.join(paths.exportsDir, `history-export-${Date.now()}.${format}`);
      if (format === 'csv') {
        const sheet = XLSX.utils.json_to_sheet(rows);
        fs.writeFileSync(outputPath, XLSX.utils.sheet_to_csv(sheet), 'utf8');
      } else {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'History');
        XLSX.writeFile(workbook, outputPath);
      }
      return { path: outputPath, count: rows.length };
    },
    bypassTranslationCacheOnce(profileId) {
      return armTranslationCacheBypass(profileId);
    },
    clearTranslationCache() {
      return persistence.clearTranslationCache();
    },
    getAssetPreview(assetId, options = {}) {
      return getAssetPreview(assetId, options);
    },
    applyAssetTbStructure(assetId, payload = {}) {
      return applyAssetTbStructure(assetId, payload || {});
    },
    saveAssetTbConfig(assetId, payload = {}) {
      return saveAssetTbConfig(assetId, payload || {});
    },
    dispose() {
      previewContextClient?.dispose?.();
      db.close?.();
      return { ok: true };
    }
  };
}

module.exports = {
  createRuntime,
  __internals: {
    parseLocalFilterDate,
    formatLocalTimestamp,
    filterHistory: filterHistoryEntries
  }
};
