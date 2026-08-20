const DEFAULT_WORKER_REQUEST_TIMEOUT_MS = 30000;
const INTERACTIVE_WORKER_REQUEST_TIMEOUT_MS = 135000;
const BULK_WORKER_REQUEST_TIMEOUT_MS = 600000;

const INTERACTIVE_CHANNELS = new Set([
  'testProvider',
  'testProviderDraft',
  'discoverProviderModels',
  'checkQaSegment',
  'runPreviewAssistant'
]);

const BULK_CHANNELS = new Set([
  'checkQaDocument',
  'importAsset',
  'getAssetPreview',
  'applyAssetTbStructure',
  'saveAssetTbConfig',
  'exportHistory',
  'exportQaHistory',
  'inspectBilingualFile',
  'installIntegration',
  'downloadPortableUpdate',
  'downloadInstallerUpdate',
  'preparePortableUpdate',
  'verifyDownloadedInstallerUpdate'
]);

function getWorkerRequestTimeoutMs(channel) {
  if (BULK_CHANNELS.has(channel)) {
    return BULK_WORKER_REQUEST_TIMEOUT_MS;
  }
  if (INTERACTIVE_CHANNELS.has(channel)) {
    return INTERACTIVE_WORKER_REQUEST_TIMEOUT_MS;
  }
  return DEFAULT_WORKER_REQUEST_TIMEOUT_MS;
}

module.exports = {
  DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
  INTERACTIVE_WORKER_REQUEST_TIMEOUT_MS,
  BULK_WORKER_REQUEST_TIMEOUT_MS,
  getWorkerRequestTimeoutMs
};
