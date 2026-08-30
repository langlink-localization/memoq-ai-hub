const test = require('node:test');
const assert = require('node:assert/strict');

const { createRendererIpcRegistrar } = require('../src/mainIpcRegistrar');
const { MAIN_LOCAL_METHODS, WORKER_PROXIED_METHODS } = require('../src/rendererIpcSurface');

function createStubIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      assert.equal(handlers.has(channel), false, `channel ${channel} registered twice`);
      handlers.set(channel, handler);
    }
  };
}

function createDeps(overrides = {}) {
  const logCalls = [];
  return {
    deps: {
      ipcMain: overrides.ipcMain || createStubIpcMain(),
      dialog: overrides.dialog || { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      shell: overrides.shell || { openPath: async () => '', showItemInFolder: () => {}, openExternal: async () => {} },
      clipboard: overrides.clipboard || { writeText: (value) => logCalls.push(['clipboard', value]) },
      appPaths: { logsDir: 'C:/logs' },
      rendererLogger: overrides.rendererLogger || {
        error: (...args) => logCalls.push(['error', ...args]),
        warn: (...args) => logCalls.push(['warn', ...args]),
        info: (...args) => logCalls.push(['info', ...args]),
        debug: (...args) => logCalls.push(['debug', ...args])
      },
      gatewayBaseUrl: 'http://127.0.0.1:5271',
      getMainWindow: () => overrides.mainWindow || { id: 'main-window' },
      getStartupState: () => overrides.startupState || { status: 'ready', message: '' },
      buildPlaceholderAppState: overrides.buildPlaceholderAppState || (() => ({ placeholder: true, integration: { status: 'not_installed' } })),
      requireWorkerReady: overrides.requireWorkerReady || (() => {}),
      invokeWorker: overrides.invokeWorker || (async () => ({})),
      createQualityWindow: overrides.createQualityWindow || (() => {}),
      requestQuit: overrides.requestQuit || (() => logCalls.push(['quit']))
    },
    logCalls
  };
}

test('registrar registers exactly one handler for every renderer surface channel', () => {
  const ipcMain = createStubIpcMain();
  const { deps } = createDeps({ ipcMain });
  const register = createRendererIpcRegistrar(deps);

  register();

  const expectedChannels = Object.values({ ...WORKER_PROXIED_METHODS, ...MAIN_LOCAL_METHODS }).map((spec) => spec.channel);
  assert.equal(ipcMain.handlers.size, expectedChannels.length);
  for (const channel of expectedChannels) {
    assert.equal(typeof ipcMain.handlers.get(channel), 'function');
  }
});

test('worker-proxied handlers require a ready worker and forward the normalized payload', async () => {
  let requireWorkerReadyCalls = 0;
  const workerInvocations = [];
  const ipcMain = createStubIpcMain();
  const { deps } = createDeps({
    ipcMain,
    requireWorkerReady: () => { requireWorkerReadyCalls += 1; },
    invokeWorker: (worker, payload) => {
      workerInvocations.push([worker, payload]);
      return { worker };
    }
  });
  createRendererIpcRegistrar(deps)();

  await ipcMain.handlers.get(WORKER_PROXIED_METHODS.saveProfile.channel)(null, undefined);
  assert.deepEqual(workerInvocations.at(-1), ['saveProfile', {}]);

  await ipcMain.handlers.get(WORKER_PROXIED_METHODS.getQaResults.channel)(null, 'doc-1');
  assert.deepEqual(workerInvocations.at(-1), ['getQaResults', { documentId: 'doc-1' }]);

  await ipcMain.handlers.get(WORKER_PROXIED_METHODS.deleteProviderModel.channel)(null, 'prov-1', 'model-2');
  assert.deepEqual(workerInvocations.at(-1), ['deleteProviderModel', { providerId: 'prov-1', modelId: 'model-2' }]);

  await ipcMain.handlers.get(WORKER_PROXIED_METHODS.deleteQaHistory.channel)(null, 'not-an-array');
  assert.deepEqual(workerInvocations.at(-1), ['deleteQaHistory', { requestIds: [] }]);

  await ipcMain.handlers.get(WORKER_PROXIED_METHODS.getQaStatus.channel)(null);
  assert.deepEqual(workerInvocations.at(-1), ['getQaStatus', undefined]);

  assert.equal(requireWorkerReadyCalls, 5);
});

test('startup-aware state channels serve the placeholder until the worker is ready', async () => {
  const ipcMain = createStubIpcMain();
  const workerInvocations = [];
  const { deps } = createDeps({
    ipcMain,
    startupState: { status: 'starting', message: '' },
    invokeWorker: (worker, payload) => {
      workerInvocations.push([worker, payload]);
      return {};
    }
  });
  createRendererIpcRegistrar(deps)();

  const appState = await ipcMain.handlers.get(MAIN_LOCAL_METHODS.getAppState.channel)(null, { section: 'dashboard' });
  assert.deepEqual(appState, { placeholder: true, integration: { status: 'not_installed' } });

  const integration = await ipcMain.handlers.get(MAIN_LOCAL_METHODS.getIntegrationStatus.channel)(null);
  assert.deepEqual(integration, { status: 'not_installed' });
  assert.equal(workerInvocations.length, 0, 'no worker call should happen while starting');
});

test('shell and clipboard handlers keep their previous contracts', async () => {
  const ipcMain = createStubIpcMain();
  const clipboardWrites = [];
  const openedPaths = [];
  const { deps, logCalls } = createDeps({
    ipcMain,
    clipboard: { writeText: (value) => clipboardWrites.push(value) },
    shell: { openPath: async (target) => { openedPaths.push(target); return target === 'blocked' ? 'denied' : ''; }, showItemInFolder: () => {}, openExternal: async () => {} },
    requestQuit: () => logCalls.push(['quit'])
  });
  createRendererIpcRegistrar(deps)();

  await ipcMain.handlers.get(MAIN_LOCAL_METHODS.copyText.channel)(null, 'hello');
  assert.deepEqual(clipboardWrites, ['hello']);

  const emptyOpen = await ipcMain.handlers.get(MAIN_LOCAL_METHODS.openPath.channel)(null, '');
  assert.deepEqual(emptyOpen, { ok: false, opened: false });

  const openResult = await ipcMain.handlers.get(MAIN_LOCAL_METHODS.openPath.channel)(null, 'C:/file');
  assert.deepEqual(openResult, { ok: true, opened: true, targetPath: 'C:/file' });
  assert.deepEqual(openedPaths, ['C:/file']);

  await assert.rejects(
    () => ipcMain.handlers.get(MAIN_LOCAL_METHODS.openPath.channel)(null, 'blocked'),
    /denied/
  );
});

test('renderer logs route to the matching logger level', async () => {
  const ipcMain = createStubIpcMain();
  const { deps, logCalls } = createDeps({ ipcMain });
  createRendererIpcRegistrar(deps)();

  const handler = ipcMain.handlers.get(MAIN_LOCAL_METHODS.recordRendererLog.channel);
  await handler(null, { level: 'error', event: 'boom', message: 'failed', data: { id: 1 } });
  await handler(null, { level: 'debug', event: 'quiet' });
  await handler(null, undefined);

  assert.deepEqual(
    logCalls.map(([level]) => level),
    ['error', 'debug', 'info']
  );
});

test('import dialogs forward the selected file to the worker and cancel to null', async () => {
  const ipcMain = createStubIpcMain();
  const dialogResults = [
    { canceled: false, filePaths: ['C:/assets/terms.xlsx'] },
    { canceled: true, filePaths: [] }
  ];
  const workerInvocations = [];
  const { deps } = createDeps({
    ipcMain,
    dialog: { showOpenDialog: async () => dialogResults.shift() },
    invokeWorker: (worker, payload) => {
      workerInvocations.push([worker, payload]);
      return { ok: true };
    }
  });
  createRendererIpcRegistrar(deps)();

  const imported = await ipcMain.handlers.get(MAIN_LOCAL_METHODS.importAsset.channel)(null, 'glossary');
  assert.deepEqual(workerInvocations.at(-1), ['importAsset', { assetType: 'glossary', sourcePath: 'C:/assets/terms.xlsx' }]);
  assert.deepEqual(imported, { ok: true });

  const canceled = await ipcMain.handlers.get(MAIN_LOCAL_METHODS.pickDirectory.channel)(null);
  assert.equal(canceled, null);
});
