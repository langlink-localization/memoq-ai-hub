// Single source for the renderer-facing IPC surface. `main.js` registers the
// worker-proxied handlers from WORKER_PROXIED_METHODS, `preload.js` generates
// the matching bridge methods from the same table, and MAIN_LOCAL_METHODS
// names the channels whose handlers live in mainIpcRegistrar because they need
// Electron APIs or startup state. Adding an operation means one table entry
// here (plus, when needed, a worker requestHandlers entry) instead of parallel
// edits in main.js and preload.js.

/**
 * @typedef {Object} MainLocalMethodSpec
 * @property {string} channel
 */

/**
 * @typedef {Object} WorkerProxiedMethodSpec
 * @property {string} channel
 * @property {string} worker
 * @property {((...args: unknown[]) => unknown)=} workerPayload
 */

/** @type {Record<string, MainLocalMethodSpec>} */
const MAIN_LOCAL_METHODS = {
  getGatewayBaseUrl: { channel: 'desktop:get-gateway-base-url' },
  getAppState: { channel: 'desktop:get-app-state' },
  getIntegrationStatus: { channel: 'desktop:get-integration-status' },
  getLogState: { channel: 'desktop:get-log-state' },
  pruneLogs: { channel: 'desktop:prune-logs' },
  recordRendererLog: { channel: 'desktop:record-renderer-log' },
  pickDirectory: { channel: 'desktop:pick-directory' },
  importAsset: { channel: 'desktop:import-asset' },
  importBilingualQa: { channel: 'desktop:import-bilingual-qa' },
  openQualityWindow: { channel: 'desktop:open-quality-window' },
  openAssistantWindow: { channel: 'desktop:open-assistant-window' },
  copyText: { channel: 'desktop:copy-text' },
  openPath: { channel: 'desktop:open-path' },
  showItemInFolder: { channel: 'desktop:show-item-in-folder' },
  openExternalUrl: { channel: 'desktop:open-external-url' },
  launchDownloadedInstallerUpdate: { channel: 'desktop:launch-downloaded-installer-update' }
};

/** @type {Record<string, WorkerProxiedMethodSpec>} */
const WORKER_PROXIED_METHODS = {
  getHistoryEntry: {
    channel: 'desktop:get-history-entry',
    worker: 'getHistoryEntry',
    workerPayload: (entryId) => ({ entryId })
  },
  saveProfile: {
    channel: 'desktop:save-profile',
    worker: 'saveProfile',
    workerPayload: (profile) => profile || {}
  },
  savePromptPreset: {
    channel: 'desktop:save-prompt-preset',
    worker: 'savePromptPreset',
    workerPayload: (payload) => payload || {}
  },
  deletePromptPreset: {
    channel: 'desktop:delete-prompt-preset',
    worker: 'deletePromptPreset',
    workerPayload: (presetId) => ({ presetId })
  },
  restoreBuiltinPromptPreset: {
    channel: 'desktop:restore-builtin-prompt-preset',
    worker: 'restoreBuiltinPromptPreset',
    workerPayload: (presetId) => ({ presetId })
  },
  setDefaultProfile: {
    channel: 'desktop:set-default-profile',
    worker: 'setDefaultProfile'
  },
  duplicateProfile: {
    channel: 'desktop:duplicate-profile',
    worker: 'duplicateProfile'
  },
  deleteProfile: {
    channel: 'desktop:delete-profile',
    worker: 'deleteProfile'
  },
  saveRule: {
    channel: 'desktop:save-rule',
    worker: 'saveRule',
    workerPayload: (rule) => rule || {}
  },
  deleteRule: {
    channel: 'desktop:delete-rule',
    worker: 'deleteRule'
  },
  testMatch: {
    channel: 'desktop:test-match',
    worker: 'testMatch',
    workerPayload: (metadata) => metadata || {}
  },
  saveProvider: {
    channel: 'desktop:save-provider',
    worker: 'saveProvider',
    workerPayload: (provider) => provider || {}
  },
  deleteProvider: {
    channel: 'desktop:delete-provider',
    worker: 'deleteProvider'
  },
  deleteProviderModel: {
    channel: 'desktop:delete-provider-model',
    worker: 'deleteProviderModel',
    workerPayload: (providerId, modelId) => ({ providerId, modelId })
  },
  testProvider: {
    channel: 'desktop:test-provider',
    worker: 'testProvider'
  },
  testProviderDraft: {
    channel: 'desktop:test-provider-draft',
    worker: 'testProviderDraft',
    workerPayload: (providerDraft) => providerDraft || {}
  },
  discoverProviderModels: {
    channel: 'desktop:discover-provider-models',
    worker: 'discoverProviderModels',
    workerPayload: (providerDraft) => providerDraft || {}
  },
  installIntegration: {
    channel: 'desktop:install-integration',
    worker: 'installIntegration',
    workerPayload: (config) => config || {}
  },
  exportHistory: {
    channel: 'desktop:export-history',
    worker: 'exportHistory',
    workerPayload: (options) => options || {}
  },
  deleteHistoryEntries: {
    channel: 'desktop:delete-history-entries',
    worker: 'deleteHistoryEntries',
    workerPayload: (entryIds) => ({ entryIds: Array.isArray(entryIds) ? entryIds : [] })
  },
  bypassTranslationCacheOnce: {
    channel: 'desktop:bypass-translation-cache-once',
    worker: 'bypassTranslationCacheOnce',
    workerPayload: (profileId) => ({ profileId })
  },
  clearTranslationCache: {
    channel: 'desktop:clear-translation-cache',
    worker: 'clearTranslationCache'
  },
  getQaStatus: {
    channel: 'desktop:get-qa-status',
    worker: 'getQaStatus'
  },
  checkQaSegment: {
    channel: 'desktop:check-qa-segment',
    worker: 'checkQaSegment',
    workerPayload: (payload) => payload || {}
  },
  checkQaDocument: {
    channel: 'desktop:check-qa-document',
    worker: 'checkQaDocument',
    workerPayload: (payload) => payload || {}
  },
  cancelQa: {
    channel: 'desktop:cancel-qa',
    worker: 'cancelQa',
    workerPayload: (payload) => payload || {}
  },
  saveQaFeedback: {
    channel: 'desktop:save-qa-feedback',
    worker: 'saveQaFeedback',
    workerPayload: (payload) => payload || {}
  },
  getQaResults: {
    channel: 'desktop:get-qa-results',
    worker: 'getQaResults',
    workerPayload: (documentId) => ({ documentId })
  },
  getQaHistory: {
    channel: 'desktop:get-qa-history',
    worker: 'getQaHistory',
    workerPayload: (filters) => filters || {}
  },
  getQaHistoryEntry: {
    channel: 'desktop:get-qa-history-entry',
    worker: 'getQaHistoryEntry',
    workerPayload: (requestId) => ({ requestId })
  },
  deleteQaHistory: {
    channel: 'desktop:delete-qa-history',
    worker: 'deleteQaHistory',
    workerPayload: (requestIds) => ({ requestIds: Array.isArray(requestIds) ? requestIds : [] })
  },
  exportQaHistory: {
    channel: 'desktop:export-qa-history',
    worker: 'exportQaHistory',
    workerPayload: (options) => options || {}
  },
  runPreviewAssistant: {
    channel: 'desktop:run-preview-assistant',
    worker: 'runPreviewAssistant',
    workerPayload: (payload) => payload || {}
  },
  cancelPreviewAssistant: {
    channel: 'desktop:cancel-preview-assistant',
    worker: 'cancelPreviewAssistant',
    workerPayload: (payload) => payload || {}
  },
  getAssetPreview: {
    channel: 'desktop:get-asset-preview',
    worker: 'getAssetPreview',
    workerPayload: (payload) => payload || {}
  },
  applyAssetTbStructure: {
    channel: 'desktop:apply-asset-tb-structure',
    worker: 'applyAssetTbStructure',
    workerPayload: (payload) => payload || {}
  },
  saveAssetTbConfig: {
    channel: 'desktop:save-asset-tb-config',
    worker: 'saveAssetTbConfig',
    workerPayload: (payload) => payload || {}
  },
  deleteAsset: {
    channel: 'desktop:delete-asset',
    worker: 'deleteAsset'
  },
  getUpdateStatus: {
    channel: 'desktop:get-update-status',
    worker: 'getUpdateStatus'
  },
  checkForUpdates: {
    channel: 'desktop:check-for-updates',
    worker: 'checkForUpdates',
    workerPayload: (payload) => payload || {}
  },
  downloadPortableUpdate: {
    channel: 'desktop:download-portable-update',
    worker: 'downloadPortableUpdate',
    workerPayload: (payload) => payload || {}
  },
  downloadInstallerUpdate: {
    channel: 'desktop:download-installer-update',
    worker: 'downloadInstallerUpdate',
    workerPayload: (payload) => payload || {}
  },
  preparePortableUpdate: {
    channel: 'desktop:prepare-portable-update',
    worker: 'preparePortableUpdate',
    workerPayload: (payload) => payload || {}
  },
  testHandshake: {
    channel: 'desktop:test-handshake',
    worker: 'testHandshake'
  }
};

module.exports = {
  MAIN_LOCAL_METHODS,
  WORKER_PROXIED_METHODS
};
