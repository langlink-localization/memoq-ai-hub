const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  ASSET_PURPOSES,
  getAssetImportRules,
  normalizeAssetPurpose
} = require('../asset/assetContext');
const { createAppPaths } = require('../shared/paths');
const { createLogger } = require('../shared/logging');
const { createDatabase } = require('../database');
const { createProviderRegistry } = require('../provider/providerRegistry');
const { summarizeRuleConditions } = require('../shared/memoqMetadata');
const { createPreviewContextClient } = require('../preview/previewContextClient');
const {
  buildPreviewStatusSnapshot,
  normalizePreviewPart,
  normalizeSourceDocument
} = require('../preview/previewContext');
const { getSupportedPlaceholders } = require('../shared/promptTemplate');
const {
  getFirstReleaseVisiblePlaceholders
} = require('../shared/profilePolicy');
const {
  buildRuntimeIdentity
} = require('../shared/desktopMetadata');
const { PRODUCT_NAME, CONTRACT_VERSION, DEFAULT_HOST, DEFAULT_PORT, ROUTES, ERROR_CODES, PREVIEW } = require('../shared/desktopContract');
const { getIntegrationStatus, installIntegration } = require('../integration/integrationService');
const {
  looksLikePreviewStartupTimeout
} = require('./runtimePreviewPolicy');
const {
  parseTimeMs,
  parseLocalFilterDate,
  formatLocalTimestamp,
  filterHistoryEntries,
  hasHistoryFallback,
  SLOW_HISTORY_LATENCY_MS
} = require('./runtimeHistory');
const {
  buildHistoryInsights,
  buildHistoryMetricsByProvider,
  buildHistorySummary,
  buildIntegrationConfig
} = require('./runtimeHistoryIntegrationSupport');
const {
  createPreviewState,
  mergePreviewParts
} = require('./runtimePreviewStateSupport');
const { createAdaptiveTranslationCacheKey } = require('./runtimeTranslationSupport');
const {
  applySchemaMigrations,
  createRuntimePersistence
} = require('./runtimePersistence');
const { createRuntimeProviderExecution } = require('./runtimeProviderExecution');
const {
  createRuntimeAggregationService,
  getPayloadSegmentCount,
  resolveRuntimeAggregationSettings
} = require('./runtimeAggregationService');
const { createRuntimeQaService } = require('./runtimeQaService');
const { createRuntimeQaHistoryService } = require('./runtimeQaHistoryService');
const { createRuntimePreviewContextResolver } = require('./runtimePreviewContextResolver');
const { createRuntimePromptPresetStore } = require('./runtimePromptPresetStore');
const { createRuntimeProfileService } = require('./runtimeProfileService');
const { createRuntimeProviderService } = require('./runtimeProviderService');
const { createRuntimeAssetService } = require('./runtimeAssetService');
const { createRuntimeHistoryPresentation } = require('./runtimeHistoryPresentation');
const { createRuntimeStateView } = require('./runtimeStateView');
const { createRuntimeAssetTbService } = require('./runtimeAssetTbService');
const {
  buildSegmentMetadataIndex,
  createRuntimeTranslationService,
  hasSmartTbParsingCapability,
  selectModel
} = require('./runtimeTranslationService');
const {
  ensureIntegrationPreferences,
  normalizeState
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

async function createRuntime(options = {}) {
  const secretStore = options.secretStore;
  if (!secretStore || typeof secretStore.has !== 'function' || typeof secretStore.get !== 'function'
    || typeof secretStore.set !== 'function' || typeof secretStore.delete !== 'function') {
    throw new TypeError('A complete secretStore adapter is required.');
  }
  const paths = createAppPaths(options);
  const runtimeLogger = options.runtimeLogger || createLogger({ source: 'runtime', logsDir: paths.logsDir });
  const db = await createDatabase(paths);
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
    logsDir: paths.logsDir,
    repoRoot: paths.repoRoot,
    helperExecutablePath: options.helperExecutablePath
  });
  const previewState = createPreviewState();
  const parsedAssetCache = new Map();
  const bypassTranslationCacheProfileIds = new Set();
  const aggregationSettings = resolveRuntimeAggregationSettings(options);
  const {
    rescueBatchSize: aggregateRescueBatchSize,
    rescueConcurrency: aggregateRescueConcurrency,
    rescueSingleTimeoutMs: aggregateRescueSingleTimeoutMs
  } = aggregationSettings;
  const providerExecution = createRuntimeProviderExecution({
    rescueConcurrency: aggregateRescueConcurrency
  });
  let gatewayReady = false;
  applySchemaMigrations(db);
  const persistence = createRuntimePersistence(db, {
    nowIso,
    normalizeState
  });
  const updateService = options.updateService || createUpdateService({
    paths,
    currentVersion: runtimeIdentity.desktopVersion,
    fetch: options.fetch,
    logger: options.updateLogger || createLogger({ source: 'update', logsDir: paths.logsDir }),
    manifestTimeoutMs: options.manifestTimeoutMs,
    packagingMode: options.packagingMode,
    extractArchive: options.extractArchive,
    releaseRepository: options.releaseRepository,
    manifestUrl: options.manifestUrl,
    updateStatePath: options.updateStatePath,
    argv: options.argv
  });
  persistence.migrateLegacyState();
  previewContextClient?.start?.();

  const historyPresentation = createRuntimeHistoryPresentation({ persistence });
  const { loadHistoryEntries, loadHistoryEntry, buildHistoryListItem, buildHistoryIssueFlags } = historyPresentation;
  const stateView = createRuntimeStateView({
    loadState,
    loadHistoryEntries,
    buildHistoryListItem,
    enrichProviders,
    syncPreviewBridgeStatusFromClient,
    updateService,
    isGatewayReady: () => gatewayReady,
    bypassTranslationCacheProfileIds,
    paths
  });

  function loadState() {
    return persistence.loadConfigState();
  }

  function saveState(state) {
    return persistence.saveConfigState(state);
  }

  const qaHistoryService = createRuntimeQaHistoryService({
    persistence,
    exportsDir: paths.exportsDir
  });
  const promptPresetStore = createRuntimePromptPresetStore({
    loadState,
    saveState,
    nowIso
  });

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

  const profileService = createRuntimeProfileService({
    loadState,
    saveState,
    createId,
    onProfileDeleted(profileId) {
      bypassTranslationCacheProfileIds.delete(normalizeProfileId(profileId));
    }
  });
  const providerService = createRuntimeProviderService({
    loadState,
    saveState,
    loadHistoryEntries,
    secretStore,
    providerRegistry,
    nowIso
  });
  const assetService = createRuntimeAssetService({
    loadState,
    saveState,
    assetsDir: paths.assetsDir,
    parsedAssetCache,
    createId,
    nowIso
  });

  const assetTbService = createRuntimeAssetTbService({
    loadState,
    saveState,
    parsedAssetCache
  });

  function markGatewayReady(ready) {
    gatewayReady = Boolean(ready);
  }

  function enrichProviders(state, historyEntries = []) {
    const metricsByProvider = buildHistoryMetricsByProvider(historyEntries);
    return state.providers.map((provider) => {
      const metrics = metricsByProvider.get(provider.id) || {
        successRate24h: null,
        avgLatencyMs: null
      };
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

  const previewContextResolver = createRuntimePreviewContextResolver({
    providerRegistry,
    secretStore,
    persistence,
    previewContextClient,
    syncPreviewBridgeStatusFromClient,
    previewContextWaitMs,
    previewContextPollMs,
    nowIso
  });

  function getAssetPreview(assetId, options = {}) {
    const state = loadState();
    const normalizedAssetId = String(assetId || '').trim();
    const asset = assetTbService.findAssetById(state, normalizedAssetId);
    if (!asset) {
      throw new Error(`Asset "${normalizedAssetId || 'unknown'}" was not found.`);
    }
    return assetTbService.buildAssetPreviewResponse(state, asset, options);
  }

  const translationService = createRuntimeTranslationService({
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
  });
  const { performTranslation } = translationService;

  const qaService = createRuntimeQaService({
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
    hasSmartTbParsingCapability,
    previewSettleMs: options.previewSettleMs,
    previewSettleMaxWaits: options.previewSettleMaxWaits
  });

  const aggregationService = createRuntimeAggregationService({
    settings: aggregationSettings,
    runtimeLogger,
    performTranslation,
    createId,
    buildSegmentMetadataIndex,
    sleep
  });

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
          maxBatchSegments: 32,
          requestTimeoutMs: 120000,
          throughputModes: ['auto', 'reliable', 'fast', 'custom'],
          capabilities: {
            requestTypePolicy: true,
            batching: true,
            glossary: true,
            customTm: true,
            brief: true,
            previewContext: true,
            mappingRules: true,
            history: true,
            aggregation: true,
            mtConfidenceInfo: true,
            qa: true
          }
        },
        preview: syncPreviewBridgeStatusFromClient()
      };
    },
    getIntegrationStatus() {
      const state = loadState();
      return getIntegrationStatus(paths, buildIntegrationConfig(state));
    },
    getQaStatus() {
      return qaService.getStatus();
    },
    async checkQaSegment(payload = {}) {
      return qaService.checkSegment(payload);
    },
    runPreviewAssistant(payload = {}) {
      return qaService.runAssistant(payload);
    },
    cancelPreviewAssistant(payload = {}) {
      return qaService.cancelAssistant(payload);
    },
    checkQaDocument(payload = {}) {
      return qaService.checkDocument(payload);
    },
    cancelQa(payload = {}) {
      return qaService.cancel(payload);
    },
    saveQaFeedback(payload = {}) {
      return qaService.saveFeedback(payload);
    },
    getQaResults(documentId) {
      return qaService.listResults(documentId);
    },
    getQaHistory(filters = {}) {
      return qaHistoryService.list(filters);
    },
    getQaHistoryEntry(payload = {}) {
      return qaHistoryService.getEntry(payload);
    },
    deleteQaHistory(requestIds = []) {
      return qaHistoryService.remove(requestIds);
    },
    exportQaHistory(options = {}) {
      return qaHistoryService.exportHistory(options);
    },
    async inspectBilingualFile(payload = {}) {
      const { parseBilingualFile } = require('../bilingual/bilingualFile');
      const { writeQaReports } = require('../bilingual/qaReport');
      const imported = parseBilingualFile(payload.filePath);
      const result = await qaService.checkDocument({
        trigger: 'import',
        ...payload,
        document: imported.document,
        languages: imported.languages,
        segments: imported.segments
      });
      const reports = writeQaReports(result, paths.exportsDir, `qa-${path.parse(imported.document.name).name}-${Date.now()}`);
      return { imported, result, reports, containsCustomerText: true };
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
      return stateView.getState(filters);
    },
    getHistoryEntry(entryId) {
      const entry = loadHistoryEntry(entryId);
      return entry ? { ...entry, ...buildHistorySummary(entry), issueFlags: buildHistoryIssueFlags(entry) } : null;
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
    async verifyDownloadedInstallerUpdate(installerPath) {
      return updateService.verifyDownloadedInstallerUpdate(installerPath);
    },
    async preparePortableUpdate(downloadedFile, targetDir) {
      return updateService.preparePortableUpdate(downloadedFile, targetDir);
    },
    saveProfile: profileService.saveProfile,
    savePromptPreset(preset = {}) {
      return promptPresetStore.save(preset);
    },
    deletePromptPreset(presetId) {
      return promptPresetStore.remove(presetId);
    },
    restoreBuiltinPromptPreset(presetId) {
      return promptPresetStore.restoreBuiltin(presetId);
    },
    setDefaultProfile: profileService.setDefaultProfile,
    duplicateProfile: profileService.duplicateProfile,
    deleteProfile: profileService.deleteProfile,
    importAssetFromPath: assetService.importAssetFromPath,
    deleteAsset: assetService.deleteAsset,
    saveMappingRule: profileService.saveMappingRule,
    deleteMappingRule: profileService.deleteMappingRule,
    testMapping: profileService.testMapping,
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
    saveProvider: providerService.saveProvider,
    testProviderDraft: providerService.testProviderDraft,
    discoverProviderModels: providerService.discoverProviderModels,
    deleteProvider: providerService.deleteProvider,
    deleteProviderModel: providerService.deleteProviderModel,
    testProviderConnection: providerService.testProviderConnection,
    async translate(payload) {
      const startedAtMs = Date.now();
      const nextPayload = payload && typeof payload === 'object'
        ? { ...payload }
        : {};
      const explicitProfileId = normalizeProfileId(nextPayload?.profileResolution?.profileId);
      if (nextPayload.bypassTranslationCache !== true && explicitProfileId && consumeTranslationCacheBypass(explicitProfileId)) {
        nextPayload.bypassTranslationCache = true;
      }
      try {
        const result = await performTranslation(nextPayload);
        runtimeLogger.info('translation-complete', 'Translation request completed.', {
          requestId: nextPayload.requestId,
          traceId: nextPayload.traceId,
          statusCode: result?.statusCode,
          segmentCount: getPayloadSegmentCount(nextPayload),
          durationMs: Date.now() - startedAtMs
        });
        return result;
      } catch (error) {
        runtimeLogger.error('translation-failed', 'Translation request failed.', {
          requestId: nextPayload.requestId,
          traceId: nextPayload.traceId,
          segmentCount: getPayloadSegmentCount(nextPayload),
          durationMs: Date.now() - startedAtMs,
          error
        });
        throw error;
      }
    },
    async submitAggregateTranslation(payload) {
      const startedAtMs = Date.now();
      const result = await aggregationService.submit(payload);
      runtimeLogger.info('aggregate-submit', 'Aggregate translation submitted.', {
        requestId: payload?.requestId,
        traceId: payload?.traceId,
        statusCode: result?.statusCode,
        segmentCount: getPayloadSegmentCount(payload || {}),
        durationMs: Date.now() - startedAtMs
      });
      return result;
    },
    async waitAggregateTranslation(payload) {
      const startedAtMs = Date.now();
      const result = await aggregationService.wait(payload);
      runtimeLogger.info('aggregate-wait', 'Aggregate translation wait completed.', {
        requestId: payload?.requestId,
        traceId: payload?.traceId,
        jobRequestId: payload?.jobRequestId,
        statusCode: result?.statusCode,
        durationMs: Date.now() - startedAtMs
      });
      return result;
    },
    async storeTranslations(payload) {
      const requestId = payload.requestId || createId('store');
      const traceId = payload.traceId || createId('trace');

      if (payload.contractVersion !== undefined && String(payload.contractVersion) !== CONTRACT_VERSION) {
        return {
          statusCode: 409,
          body: {
            success: false,
            requestId,
            traceId,
            error: {
              code: ERROR_CODES.contractVersionMismatch,
              message: `Desktop contract version ${CONTRACT_VERSION} is required.`
            }
          }
        };
      }

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

      runtimeLogger.info('store-translations-complete', 'Stored translations in cache.', {
        requestId,
        traceId,
        storedCount
      });
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
      const XLSX = require('xlsx');
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
    deleteHistoryEntries(entryIds = []) {
      return persistence.deleteHistoryEntries(entryIds);
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
      return assetTbService.applyAssetTbStructure(assetId, payload || {});
    },
    saveAssetTbConfig(assetId, payload = {}) {
      return assetTbService.saveAssetTbConfig(assetId, payload || {});
    },
    dispose() {
      aggregationService.dispose();
      previewContextClient?.dispose?.();
      qaService.dispose();
      db.close?.();
      runtimeLogger.info('runtime-disposed', 'Runtime disposed.');
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
