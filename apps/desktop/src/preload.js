const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memoqDesktop', {
  getGatewayBaseUrl: () => ipcRenderer.invoke('desktop:get-gateway-base-url'),
  getAppState: (filters) => ipcRenderer.invoke('desktop:get-app-state', filters),
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
  saveAssetTbConfig: (assetId, payload) => ipcRenderer.invoke('desktop:save-asset-tb-config', { assetId, ...(payload || {}) }),
  deleteAsset: (assetId) => ipcRenderer.invoke('desktop:delete-asset', assetId),
  exportHistory: (options) => ipcRenderer.invoke('desktop:export-history', options),
  testHandshake: () => ipcRenderer.invoke('desktop:test-handshake')
});
