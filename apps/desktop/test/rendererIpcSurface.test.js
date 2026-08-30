const test = require('node:test');
const assert = require('node:assert/strict');

const { MAIN_LOCAL_METHODS, WORKER_PROXIED_METHODS } = require('../src/rendererIpcSurface');
const workerRequestPolicy = require('../src/workerRequestPolicy');

test('every IPC surface entry maps a camelCase method to a unique desktop channel', () => {
  const seenChannels = new Map();

  for (const [methodName, spec] of Object.entries({ ...WORKER_PROXIED_METHODS, ...MAIN_LOCAL_METHODS })) {
    assert.match(methodName, /^[a-zA-Z][a-zA-Z0-9]*$/, `method ${methodName} must be a plain identifier`);
    assert.match(spec.channel, /^desktop:[a-z0-9-]+$/, `channel for ${methodName} must be a desktop: channel`);
    assert.equal(seenChannels.has(spec.channel), false, `channel ${spec.channel} is registered twice`);
    seenChannels.set(spec.channel, methodName);
  }
});

test('worker-proxied entries name an existing worker request policy channel', () => {
  for (const [methodName, spec] of Object.entries(WORKER_PROXIED_METHODS)) {
    assert.ok(spec.worker, `worker-proxied method ${methodName} must declare its worker channel`);
    assert.equal(typeof workerRequestPolicy.getWorkerRequestTimeoutMs(spec.worker), 'number');
  }
});

test('main-local entries never declare worker channels', () => {
  for (const [methodName, spec] of Object.entries(MAIN_LOCAL_METHODS)) {
    assert.equal(spec.worker, undefined, `main-local method ${methodName} must not declare a worker channel`);
  }
});

test('the surface covers the bridge methods the renderer expects', () => {
  const methodNames = new Set(Object.keys({ ...WORKER_PROXIED_METHODS, ...MAIN_LOCAL_METHODS }));

  for (const expected of [
    'getAppState', 'saveProfile', 'saveProvider', 'deleteProviderModel', 'importAsset',
    'getAssetPreview', 'exportHistory', 'checkQaDocument', 'runPreviewAssistant',
    'checkForUpdates', 'openPath', 'copyText', 'testHandshake'
  ]) {
    assert.equal(methodNames.has(expected), true, `expected renderer bridge method ${expected}`);
  }

  assert.equal(methodNames.size, 60, 'the renderer bridge exposes exactly 60 methods');
});
