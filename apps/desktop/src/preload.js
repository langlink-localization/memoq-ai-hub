const { contextBridge, ipcRenderer } = require('electron');

function normalizeAssistantPayload(payload = {}) {
  const operation = payload.operation === 'polish' ? 'polish' : payload.operation === 'translate' ? 'translate' : '';
  if (!operation) throw new Error('Preview Assistant operation must be translate or polish.');
  const glossaryAssetIds = [...new Set((Array.isArray(payload.assets?.glossaryAssetIds) ? payload.assets.glossaryAssetIds : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))].slice(0, 50);
  return {
    operation,
    requestId: String(payload.requestId || '').slice(0, 160),
    profileId: String(payload.profileId || '').slice(0, 160),
    providerId: String(payload.providerId || '').slice(0, 160),
    model: String(payload.model || '').slice(0, 240),
    assets: {
      mode: payload.assets?.mode === 'override' ? 'override' : 'inherit',
      glossaryAssetIds
    }
  };
}

contextBridge.exposeInMainWorld('memoqDesktop', {
  getGatewayBaseUrl: () => ipcRenderer.invoke('desktop:get-gateway-base-url'),
  getAppState: (filters) => ipcRenderer.invoke('desktop:get-app-state', filters),
  getHistoryEntry: (entryId) => ipcRenderer.invoke('desktop:get-history-entry', entryId),
  getLogState: () => ipcRenderer.invoke('desktop:get-log-state'),
  pruneLogs: () => ipcRenderer.invoke('desktop:prune-logs'),
  recordRendererLog: (payload) => ipcRenderer.invoke('desktop:record-renderer-log', payload || {}),
  saveProfile: (profile) => ipcRenderer.invoke('desktop:save-profile', profile),
  setDefaultProfile: (profileId) => ipcRenderer.invoke('desktop:set-default-profile', profileId),
  duplicateProfile: (profileId) => ipcRenderer.invoke('desktop:duplicate-profile', profileId),
  deleteProfile: (profileId) => ipcRenderer.invoke('desktop:delete-profile', profileId),
  saveRule: (rule) => ipcRenderer.invoke('desktop:save-rule', rule),
  deleteRule: (ruleId) => ipcRenderer.invoke('desktop:delete-rule', ruleId),
  testMatch: (metadata) => ipcRenderer.invoke('desktop:test-match', metadata),
  saveProvider: (provider) => ipcRenderer.invoke('desktop:save-provider', provider),
  deleteProvider: (providerId) => ipcRenderer.invoke('desktop:delete-provider', providerId),
  deleteProviderModel: (providerId, modelId) => ipcRenderer.invoke('desktop:delete-provider-model', providerId, modelId),
  testProvider: (providerId) => ipcRenderer.invoke('desktop:test-provider', providerId),
  testProviderDraft: (providerDraft) => ipcRenderer.invoke('desktop:test-provider-draft', providerDraft),
  discoverProviderModels: (providerDraft) => ipcRenderer.invoke('desktop:discover-provider-models', providerDraft),
  getIntegrationStatus: () => ipcRenderer.invoke('desktop:get-integration-status'),
  installIntegration: (config) => ipcRenderer.invoke('desktop:install-integration', config),
  pickDirectory: () => ipcRenderer.invoke('desktop:pick-directory'),
  importAsset: (assetType) => ipcRenderer.invoke('desktop:import-asset', assetType),
  getAssetPreview: (assetId, options) => ipcRenderer.invoke('desktop:get-asset-preview', { assetId, ...(options || {}) }),
  applyAssetTbStructure: (assetId, payload) => ipcRenderer.invoke('desktop:apply-asset-tb-structure', { assetId, ...(payload || {}) }),
  saveAssetTbConfig: (assetId, payload) => ipcRenderer.invoke('desktop:save-asset-tb-config', { assetId, ...(payload || {}) }),
  deleteAsset: (assetId) => ipcRenderer.invoke('desktop:delete-asset', assetId),
  exportHistory: (options) => ipcRenderer.invoke('desktop:export-history', options),
  deleteHistoryEntries: (entryIds) => ipcRenderer.invoke('desktop:delete-history-entries', entryIds),
  bypassTranslationCacheOnce: (profileId) => ipcRenderer.invoke('desktop:bypass-translation-cache-once', profileId),
  clearTranslationCache: () => ipcRenderer.invoke('desktop:clear-translation-cache'),
  getQaStatus: () => ipcRenderer.invoke('desktop:get-qa-status'),
  checkQaSegment: (payload) => ipcRenderer.invoke('desktop:check-qa-segment', payload || {}),
  checkQaDocument: (payload) => ipcRenderer.invoke('desktop:check-qa-document', payload || {}),
  cancelQa: (payload) => ipcRenderer.invoke('desktop:cancel-qa', payload || {}),
  saveQaFeedback: (payload) => ipcRenderer.invoke('desktop:save-qa-feedback', payload || {}),
  getQaResults: (documentId) => ipcRenderer.invoke('desktop:get-qa-results', documentId),
  importBilingualQa: (payload) => ipcRenderer.invoke('desktop:import-bilingual-qa', payload || {}),
  openQualityWindow: () => ipcRenderer.invoke('desktop:open-quality-window'),
  openAssistantWindow: () => ipcRenderer.invoke('desktop:open-assistant-window'),
  runPreviewAssistant: (payload) => ipcRenderer.invoke('desktop:run-preview-assistant', normalizeAssistantPayload(payload)),
  cancelPreviewAssistant: (requestId) => ipcRenderer.invoke('desktop:cancel-preview-assistant', { requestId: String(requestId || '').slice(0, 160) }),
  copyText: (value) => ipcRenderer.invoke('desktop:copy-text', value),
  getUpdateStatus: () => ipcRenderer.invoke('desktop:get-update-status'),
  checkForUpdates: (options) => ipcRenderer.invoke('desktop:check-for-updates', options),
  downloadPortableUpdate: (versionOrAssetId) => ipcRenderer.invoke('desktop:download-portable-update', { versionOrAssetId }),
  downloadInstallerUpdate: (versionOrAssetId) => ipcRenderer.invoke('desktop:download-installer-update', { versionOrAssetId }),
  preparePortableUpdate: (downloadedFile, targetDir) => ipcRenderer.invoke('desktop:prepare-portable-update', { downloadedFile, targetDir }),
  openPath: (targetPath) => ipcRenderer.invoke('desktop:open-path', targetPath),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('desktop:show-item-in-folder', targetPath),
  openExternalUrl: (url) => ipcRenderer.invoke('desktop:open-external-url', url),
  launchDownloadedInstallerUpdate: (installerPath) => ipcRenderer.invoke('desktop:launch-downloaded-installer-update', installerPath),
  testHandshake: () => ipcRenderer.invoke('desktop:test-handshake')
});
