const { createRuntimeProviderStatus } = require('./runtimeProviderStatus');
const crypto = require('crypto');
const { createAppPaths } = require('../shared/paths');
const { createLogger } = require('../shared/logging');
const { createDatabase } = require('../database');
const { createProviderRegistry } = require('../provider/providerRegistry');
const { createPreviewContextClient } = require('../preview/previewContextClient');
const {
  buildRuntimeIdentity
} = require('../shared/desktopMetadata');
const { PRODUCT_NAME, CONTRACT_VERSION, DEFAULT_HOST, DEFAULT_PORT, ROUTES } = require('../shared/desktopContract');
const { getIntegrationStatus, installIntegration } = require('../integration/integrationService');
const {
  parseLocalFilterDate,
  formatLocalTimestamp,
  filterHistoryEntries
} = require('./runtimeHistory');
const {
  buildHistorySummary,
  buildIntegrationConfig
} = require('./runtimeHistoryIntegrationSupport');
const { createPreviewState } = require('./runtimePreviewStateSupport');
const { createRuntimePreviewBridge } = require('./runtimePreviewBridge');
const { createRuntimeTranslationCacheBypass } = require('./runtimeTranslationCacheBypass');
const { createRuntimeTranslationWriteback } = require('./runtimeTranslationWriteback');
const { createRuntimeHistoryExport } = require('./runtimeHistoryExport');
const { createRuntimeBilingualInspection } = require('./runtimeBilingualInspection');
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

/**
 * @param {any} prefix
 */
function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

const DEFAULT_PREVIEW_CONTEXT_WAIT_MS = 1000;
const DEFAULT_PREVIEW_CONTEXT_POLL_MS = 50;

/**
 * @param {any} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {Record<string, any>=} options
 */
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
  const previewBridge = createRuntimePreviewBridge({
    previewState,
    previewContextClient,
    runtimeStartedAt: runtimeIdentity.runtimeStartedAt,
    nowIso
  });
  const parsedAssetCache = new Map();
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

  function loadState() {
    return persistence.loadConfigState();
  }

  /**
   * @param {any} state
   */
  function saveState(state) {
    return persistence.saveConfigState(state);
  }

  const translationCacheBypass = createRuntimeTranslationCacheBypass({ loadState });
  const historyPresentation = createRuntimeHistoryPresentation({ persistence });
  const { loadHistoryEntries, loadHistoryEntry, buildHistoryListItem, buildHistoryIssueFlags } = historyPresentation;
  const historyExport = createRuntimeHistoryExport({
    loadHistoryEntries,
    exportsDir: paths.exportsDir
  });
  const stateView = createRuntimeStateView({
    loadState,
    loadHistoryEntries,
    getHistoryOverview: () => persistence.getHistoryOverview(),
    buildHistoryListItem,
    secretStore,
    syncPreviewBridgeStatusFromClient: previewBridge.syncPreviewBridgeStatusFromClient,
    updateService,
    isGatewayReady: () => gatewayReady,
    bypassTranslationCacheProfileIds: translationCacheBypass.pendingIds,
    paths
  });

  const qaHistoryService = createRuntimeQaHistoryService({
    persistence,
    exportsDir: paths.exportsDir
  });
  const promptPresetStore = createRuntimePromptPresetStore({
    loadState,
    saveState,
    nowIso
  });

  const profileService = createRuntimeProfileService({
    loadState,
    saveState,
    createId,
    onProfileDeleted(/** @type {any} */ profileId) {
      translationCacheBypass.clear(profileId);
    }
  });
  const providerStatus = createRuntimeProviderStatus();
  const providerService = createRuntimeProviderService({
    providerStatus,
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

  /**
   * @param {any} ready
   */
  function markGatewayReady(ready) {
    gatewayReady = Boolean(ready);
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

  const previewContextResolver = createRuntimePreviewContextResolver({
    providerRegistry,
    secretStore,
    persistence,
    previewContextClient,
    syncPreviewBridgeStatusFromClient: previewBridge.syncPreviewBridgeStatusFromClient,
    previewContextWaitMs,
    previewContextPollMs,
    nowIso
  });

  /**
   * @param {any} assetId
   * @param {any} options
   */
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
    providerStatus,
    aggregateRescueBatchSize,
    aggregateRescueSingleTimeoutMs,
    consumeTranslationCacheBypass: translationCacheBypass.consume,
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
  const translationWriteback = createRuntimeTranslationWriteback({
    persistence,
    nowIso,
    createId,
    runtimeLogger
  });
  const bilingualInspection = createRuntimeBilingualInspection({
    qaService,
    exportsDir: paths.exportsDir
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
        preview: previewBridge.syncPreviewBridgeStatusFromClient()
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
    getQaResults(/** @type {any} */ documentId) {
      return qaService.listResults(documentId);
    },
    getQaHistory(filters = {}) {
      return qaHistoryService.list(filters);
    },
    getQaHistoryEntry(payload = {}) {
      return qaHistoryService.getEntry(payload);
    },
    deleteQaHistory(/** @type {any} */ requestIds = []) {
      return qaHistoryService.remove(requestIds);
    },
    exportQaHistory(/** @type {any} */ options = {}) {
      return qaHistoryService.exportHistory(options);
    },
    /**
     * @param {Record<string, any>=} payload
     */
    async inspectBilingualFile(payload = {}) {
      return bilingualInspection.inspectBilingualFile(payload);
    },
    installIntegration(/** @type {any} */ config) {
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
    getHistoryEntry(/** @type {any} */ entryId) {
      const entry = loadHistoryEntry(entryId);
      return entry ? { ...entry, ...buildHistorySummary(entry), issueFlags: buildHistoryIssueFlags(entry) } : null;
    },
    getUpdateStatus() {
      return updateService.getStatus();
    },
    async checkForUpdates(/** @type {any} */ options = {}) {
      return updateService.checkForUpdates(options || {});
    },
    async downloadPortableUpdate(/** @type {any} */ versionOrAssetId) {
      return updateService.downloadPortableUpdate(versionOrAssetId);
    },
    async downloadInstallerUpdate(/** @type {any} */ versionOrAssetId) {
      return updateService.downloadInstallerUpdate(versionOrAssetId);
    },
    async verifyDownloadedInstallerUpdate(/** @type {any} */ installerPath) {
      return updateService.verifyDownloadedInstallerUpdate(installerPath);
    },
    async preparePortableUpdate(/** @type {any} */ downloadedFile, /** @type {any} */ targetDir) {
      return updateService.preparePortableUpdate(downloadedFile, targetDir);
    },
    markPortableUpdateRestarting() {
      return updateService.markPortableUpdateRestarting();
    },
    saveProfile: profileService.saveProfile,
    savePromptPreset(preset = {}) {
      return promptPresetStore.save(preset);
    },
    deletePromptPreset(/** @type {any} */ presetId) {
      return promptPresetStore.remove(presetId);
    },
    restoreBuiltinPromptPreset(/** @type {any} */ presetId) {
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
    updatePreviewBridgeStatus(/** @type {any} */ statusPatch) {
      return previewBridge.updatePreviewBridgeStatus(statusPatch || {});
    },
    ingestPreviewContentUpdate(/** @type {any} */ payload) {
      return previewBridge.ingestPreviewContentUpdate(payload || {});
    },
    ingestPreviewHighlight(/** @type {any} */ payload) {
      return previewBridge.ingestPreviewHighlight(payload || {});
    },
    ingestPreviewPartIds(/** @type {any} */ payload) {
      return previewBridge.ingestPreviewPartIds(payload || {});
    },
    saveProvider: providerService.saveProvider,
    testProviderDraft: providerService.testProviderDraft,
    discoverProviderModels: providerService.discoverProviderModels,
    deleteProvider: providerService.deleteProvider,
    deleteProviderModel: providerService.deleteProviderModel,
    testProviderConnection: providerService.testProviderConnection,
    async translate(/** @type {any} */ payload) {
      const startedAtMs = Date.now();
      const nextPayload = payload && typeof payload === 'object'
        ? { ...payload }
        : {};
      const explicitProfileId = translationCacheBypass.normalizeProfileId(nextPayload?.profileResolution?.profileId);
      if (nextPayload.bypassTranslationCache !== true && explicitProfileId && translationCacheBypass.consume(explicitProfileId)) {
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
      } catch (/** @type {any} */ error) {
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
    async submitAggregateTranslation(/** @type {any} */ payload) {
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
    async waitAggregateTranslation(/** @type {any} */ payload) {
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
    async storeTranslations(/** @type {any} */ payload) {
      return translationWriteback.storeTranslations(payload);
    },
    /**
     * @param {Record<string, any>=} options
     */
    exportHistory(/** @type {any} */ options = {}) {
      return historyExport.exportHistory(options);
    },
    deleteHistoryEntries(/** @type {any} */ entryIds = []) {
      return persistence.deleteHistoryEntries(entryIds);
    },
    bypassTranslationCacheOnce(/** @type {any} */ profileId) {
      return translationCacheBypass.arm(profileId);
    },
    clearTranslationCache() {
      return persistence.clearTranslationCache();
    },
    getAssetPreview(/** @type {any} */ assetId, options = {}) {
      return getAssetPreview(assetId, options);
    },
    applyAssetTbStructure(/** @type {any} */ assetId, payload = {}) {
      return assetTbService.applyAssetTbStructure(assetId, payload || {});
    },
    saveAssetTbConfig(/** @type {any} */ assetId, payload = {}) {
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
