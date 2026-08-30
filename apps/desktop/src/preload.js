const { contextBridge, ipcRenderer } = require('electron');
const { MAIN_LOCAL_METHODS, WORKER_PROXIED_METHODS } = require('./rendererIpcSurface');

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
    },
    prompt: {
      presetId: String(payload.prompt?.presetId || '').slice(0, 160),
      additionalInstruction: String(payload.prompt?.additionalInstruction || '').slice(0, 4000)
    }
  };
}

const bridgeMethodBuilders = { ...WORKER_PROXIED_METHODS, ...MAIN_LOCAL_METHODS };

const generatedBridgeMethods = Object.fromEntries(
  Object.entries(bridgeMethodBuilders).map(([methodName, spec]) => [
    methodName,
    (...args) => ipcRenderer.invoke(spec.channel, ...args)
  ])
);

contextBridge.exposeInMainWorld('memoqDesktop', {
  ...generatedBridgeMethods,

  recordRendererLog: (payload) => ipcRenderer.invoke('desktop:record-renderer-log', payload || {}),

  savePromptPreset: (preset) => ipcRenderer.invoke('desktop:save-prompt-preset', preset || {}),
  deletePromptPreset: (presetId) => ipcRenderer.invoke('desktop:delete-prompt-preset', String(presetId || '').slice(0, 160)),
  restoreBuiltinPromptPreset: (presetId) => ipcRenderer.invoke('desktop:restore-builtin-prompt-preset', String(presetId || '').slice(0, 160)),

  getAssetPreview: (assetId, options) => ipcRenderer.invoke('desktop:get-asset-preview', { assetId, ...(options || {}) }),
  applyAssetTbStructure: (assetId, payload) => ipcRenderer.invoke('desktop:apply-asset-tb-structure', { assetId, ...(payload || {}) }),
  saveAssetTbConfig: (assetId, payload) => ipcRenderer.invoke('desktop:save-asset-tb-config', { assetId, ...(payload || {}) }),

  deleteQaHistory: (requestIds) => ipcRenderer.invoke('desktop:delete-qa-history', Array.isArray(requestIds) ? requestIds : []),

  runPreviewAssistant: (payload) => ipcRenderer.invoke('desktop:run-preview-assistant', normalizeAssistantPayload(payload)),
  cancelPreviewAssistant: (requestId) => ipcRenderer.invoke('desktop:cancel-preview-assistant', { requestId: String(requestId || '').slice(0, 160) }),

  downloadPortableUpdate: (versionOrAssetId) => ipcRenderer.invoke('desktop:download-portable-update', { versionOrAssetId }),
  downloadInstallerUpdate: (versionOrAssetId) => ipcRenderer.invoke('desktop:download-installer-update', { versionOrAssetId }),
  preparePortableUpdate: (downloadedFile, targetDir) => ipcRenderer.invoke('desktop:prepare-portable-update', { downloadedFile, targetDir })
});
