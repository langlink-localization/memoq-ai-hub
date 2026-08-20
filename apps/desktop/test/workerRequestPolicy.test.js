const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
  INTERACTIVE_WORKER_REQUEST_TIMEOUT_MS,
  BULK_WORKER_REQUEST_TIMEOUT_MS,
  getWorkerRequestTimeoutMs
} = require('../src/workerRequestPolicy');

test('worker request policy assigns bounded deadlines by workload', () => {
  for (const channel of ['testProvider', 'testProviderDraft', 'discoverProviderModels', 'checkQaSegment', 'runPreviewAssistant']) {
    assert.equal(getWorkerRequestTimeoutMs(channel), INTERACTIVE_WORKER_REQUEST_TIMEOUT_MS, channel);
  }

  for (const channel of [
    'checkQaDocument', 'importAsset', 'getAssetPreview', 'applyAssetTbStructure', 'saveAssetTbConfig',
    'exportHistory', 'exportQaHistory', 'inspectBilingualFile', 'installIntegration',
    'downloadPortableUpdate', 'downloadInstallerUpdate', 'preparePortableUpdate', 'verifyDownloadedInstallerUpdate'
  ]) {
    assert.equal(getWorkerRequestTimeoutMs(channel), BULK_WORKER_REQUEST_TIMEOUT_MS, channel);
  }

  assert.equal(getWorkerRequestTimeoutMs('getAppState'), DEFAULT_WORKER_REQUEST_TIMEOUT_MS);
});
