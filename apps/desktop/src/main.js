const path = require('path');
const { fork } = require('child_process');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { createAppPaths } = require('./shared/paths');
const { getIntegrationStatus } = require('./integration/integrationService');
const { DEFAULT_HOST, DEFAULT_PORT, PRODUCT_NAME, CONTRACT_VERSION } = require('./shared/desktopContract');
const { getAssetImportRules } = require('./asset/assetRules');
const { getSupportedPlaceholders } = require('./shared/promptTemplate');

let mainWindow;
let backgroundWorker;
let workerRequestId = 0;
let appIsQuitting = false;
let startupState = { status: 'starting', message: '' };
const pendingWorkerRequests = new Map();

function buildWorkerForkOptions(baseEnv = {}) {
  return {
    env: {
      ...baseEnv,
      ELECTRON_RUN_AS_NODE: '1'
    },
    execArgv: [],
    windowsHide: true,
    silent: true
  };
}

function getConnectionStatusLabel() {
  if (startupState.status === 'ready') return 'Connected';
  if (startupState.status === 'starting') return 'Starting';
  if (startupState.status === 'error') return 'Error';
  return 'Disconnected';
}

function buildPlaceholderAppState() {
  const paths = createAppPaths();
  const integration = getIntegrationStatus(paths, { memoqVersion: '11' });
  const connectionStatus = getConnectionStatusLabel();
  const previewPlaceholderStatus = startupState.status === 'starting' ? 'starting' : 'disconnected';
  const notices = [];

  if (startupState.status === 'error') {
    notices.push(startupState.message || 'Desktop services failed to start.');
  } else if (startupState.status === 'starting') {
    notices.push('Desktop services are waiting for memoQ startup.');
  }

  if (!notices.length) {
    notices.push('The app is ready for first-time configuration.');
  }

  return {
    productName: PRODUCT_NAME,
    contractVersion: CONTRACT_VERSION,
    gatewayBaseUrl: `http://${DEFAULT_HOST}:${DEFAULT_PORT}`,
    startup: { ...startupState },
    dashboard: {
      checklist: [
        { key: 'install-plugin', title: '1. Install plugin', subtitle: integration.status === 'installed' ? 'dll installed' : 'dll not installed', actionLabel: 'Install' },
        { key: 'context-builder', title: '2. Build context', subtitle: 'No profile yet', actionLabel: 'Configure' },
        { key: 'provider-hub', title: '3. Connect AI', subtitle: 'No provider yet', actionLabel: 'Configure' },
        { key: 'history', title: '4. Verify run', subtitle: 'No history yet', actionLabel: 'Review' }
      ],
      runtimeStatus: {
        memoqInstallPath: integration.selectedInstallDir || integration.installations[0]?.rootDir || 'Not detected',
        pluginStatus: integration.status,
        connectionStatus,
        previewStatus: {
          status: previewPlaceholderStatus,
          statusMessage: previewPlaceholderStatus === 'starting' ? 'Waiting for memoQ startup.' : '',
          serviceBaseUrl: '',
          sessionId: '',
          callbackAddress: '',
          connectedAt: '',
          lastUpdatedAt: '',
          lastError: '',
          activePreviewPartId: '',
          activePreviewPartCount: 0,
          cachedPreviewPartCount: 0,
          sourceDocumentName: '',
          sourceDocumentGuid: ''
        }
      },
      notices
    },
    integration,
    previewBridge: {
      status: previewPlaceholderStatus,
      statusMessage: previewPlaceholderStatus === 'starting' ? 'Waiting for memoQ startup.' : '',
      serviceBaseUrl: '',
      sessionId: '',
      callbackAddress: '',
      connectedAt: '',
      lastUpdatedAt: '',
      lastError: '',
      activePreviewPartId: '',
      activePreviewPartCount: 0,
      cachedPreviewPartCount: 0,
      sourceDocumentName: '',
      sourceDocumentGuid: ''
    },
    contextBuilder: {
      profiles: [],
      defaultProfileId: '',
      assets: [],
      supportedPlaceholders: getSupportedPlaceholders(),
      assetImportRules: getAssetImportRules()
    },
    memoqMetadataMapping: { rules: [] },
    providerHub: { providers: [], summary: { enabled: 0, healthy: 0 } },
    historyExplorer: { items: [] }
  };
}

function buildWorkerPath() {
  return path.join(__dirname, 'backgroundWorker.js');
}

function createWorkerError(serializedError, fallbackMessage = 'Desktop worker request failed.') {
  const error = new Error(String(serializedError?.message || fallbackMessage));
  error.code = serializedError?.code || '';
  error.statusCode = Number.isFinite(Number(serializedError?.statusCode)) ? Number(serializedError.statusCode) : 500;
  if (serializedError?.stack) {
    error.stack = serializedError.stack;
  }
  return error;
}

function rejectPendingRequests(serializedError) {
  const error = createWorkerError(serializedError, 'Desktop background worker stopped before replying.');
  for (const { reject } of pendingWorkerRequests.values()) {
    reject(error);
  }
  pendingWorkerRequests.clear();
}

function handleWorkerMessage(message) {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'status') {
    startupState = {
      status: String(message.payload?.status || 'starting'),
      message: String(message.payload?.message || '')
    };
    return;
  }

  if (message.type !== 'response') {
    return;
  }

  const pending = pendingWorkerRequests.get(message.id);
  if (!pending) {
    return;
  }

  pendingWorkerRequests.delete(message.id);

  if (message.ok) {
    pending.resolve(message.result);
    return;
  }

  pending.reject(createWorkerError(message.error));
}

function startBackgroundWorker() {
  if (backgroundWorker) {
    return backgroundWorker;
  }

  startupState = { status: 'starting', message: '' };

  backgroundWorker = fork(buildWorkerPath(), [], buildWorkerForkOptions(process.env));

  backgroundWorker.on('message', handleWorkerMessage);
  backgroundWorker.once('exit', (code, signal) => {
    const exitedWorker = backgroundWorker;
    backgroundWorker = null;

    rejectPendingRequests({
      message: signal
        ? `Desktop background worker stopped with signal ${signal}.`
        : `Desktop background worker exited with code ${code}.`,
      code: 'DESKTOP_WORKER_EXITED',
      statusCode: 500
    });

    if (appIsQuitting) {
      startupState = { status: 'stopped', message: '' };
      return;
    }

    startupState = {
      status: 'error',
      message: signal
        ? `Desktop background worker stopped with signal ${signal}.`
        : `Desktop background worker exited with code ${code}.`
    };

    if (exitedWorker?.stdout) {
      exitedWorker.stdout.removeAllListeners();
    }
    if (exitedWorker?.stderr) {
      exitedWorker.stderr.removeAllListeners();
    }
  });

  if (backgroundWorker.stdout) {
    backgroundWorker.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
    });
  }

  if (backgroundWorker.stderr) {
    backgroundWorker.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
  }

  return backgroundWorker;
}

function invokeWorker(channel, payload) {
  if (!backgroundWorker) {
    startBackgroundWorker();
  }

  if (!backgroundWorker) {
    throw new Error('Desktop background worker is unavailable.');
  }

  const id = `worker_req_${Date.now()}_${workerRequestId += 1}`;

  return new Promise((resolve, reject) => {
    pendingWorkerRequests.set(id, { resolve, reject });

    try {
      backgroundWorker.send({
        type: 'request',
        id,
        channel,
        payload
      });
    } catch (error) {
      pendingWorkerRequests.delete(id);
      reject(error);
    }
  });
}

function requireWorkerReady() {
  if (backgroundWorker && startupState.status === 'ready') {
    return;
  }

  throw new Error(
    startupState.status === 'error'
      ? (startupState.message || 'Desktop services failed to start.')
      : 'Desktop services are waiting for memoQ startup.'
  );
}

function revealWindow() {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show();
  }
}

function createWindow() {
  const rendererDevServerUrl = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined'
    ? MAIN_WINDOW_VITE_DEV_SERVER_URL
    : null;

  let revealTimeout;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    title: PRODUCT_NAME,
    backgroundColor: '#f3f5f9',
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Renderer finished loading.');
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`Renderer failed to load (${errorCode}): ${errorDescription}`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process exited unexpectedly.', details);
  });

  mainWindow.webContents.on('console-message', (_event, level, messageText, line, sourceId) => {
    if (level >= 2) {
      console.error(`Renderer console [${level}] ${sourceId}:${line} ${messageText}`);
    }
  });

  const revealWindowSafely = () => {
    if (revealTimeout) {
      clearTimeout(revealTimeout);
      revealTimeout = null;
    }

    revealWindow();
  };

  mainWindow.once('ready-to-show', revealWindowSafely);
  mainWindow.webContents.once('did-finish-load', revealWindowSafely);
  mainWindow.webContents.once('did-fail-load', revealWindowSafely);
  mainWindow.on('closed', () => {
    if (revealTimeout) {
      clearTimeout(revealTimeout);
      revealTimeout = null;
    }
    mainWindow = null;
  });

  revealTimeout = setTimeout(revealWindowSafely, 1500);

  if (rendererDevServerUrl) {
    mainWindow.loadURL(rendererDevServerUrl);
    return;
  }

  const rendererName = typeof MAIN_WINDOW_VITE_NAME !== 'undefined'
    ? MAIN_WINDOW_VITE_NAME
    : 'main_window';
  mainWindow.loadFile(path.join(__dirname, `../renderer/${rendererName}/index.html`));
}

function registerIpcHandlers() {
  ipcMain.handle('desktop:get-gateway-base-url', () => `http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
  ipcMain.handle('desktop:get-app-state', (_event, filters) => {
    if (startupState.status !== 'ready') {
      return buildPlaceholderAppState();
    }

    return invokeWorker('getAppState', filters || {});
  });
  ipcMain.handle('desktop:save-profile', (_event, profile) => {
    requireWorkerReady();
    return invokeWorker('saveProfile', profile || {});
  });
  ipcMain.handle('desktop:set-default-profile', (_event, profileId) => {
    requireWorkerReady();
    return invokeWorker('setDefaultProfile', profileId);
  });
  ipcMain.handle('desktop:duplicate-profile', (_event, profileId) => {
    requireWorkerReady();
    return invokeWorker('duplicateProfile', profileId);
  });
  ipcMain.handle('desktop:delete-profile', (_event, profileId) => {
    requireWorkerReady();
    return invokeWorker('deleteProfile', profileId);
  });
  ipcMain.handle('desktop:save-rule', (_event, rule) => {
    requireWorkerReady();
    return invokeWorker('saveRule', rule || {});
  });
  ipcMain.handle('desktop:delete-rule', (_event, ruleId) => {
    requireWorkerReady();
    return invokeWorker('deleteRule', ruleId);
  });
  ipcMain.handle('desktop:test-match', (_event, metadata) => {
    requireWorkerReady();
    return invokeWorker('testMatch', metadata || {});
  });
  ipcMain.handle('desktop:save-provider', (_event, provider) => {
    requireWorkerReady();
    return invokeWorker('saveProvider', provider || {});
  });
  ipcMain.handle('desktop:delete-provider', (_event, providerId) => {
    requireWorkerReady();
    return invokeWorker('deleteProvider', providerId);
  });
  ipcMain.handle('desktop:delete-provider-model', (_event, providerId, modelId) => {
    requireWorkerReady();
    return invokeWorker('deleteProviderModel', { providerId, modelId });
  });
  ipcMain.handle('desktop:test-provider', (_event, providerId) => {
    requireWorkerReady();
    return invokeWorker('testProvider', providerId);
  });
  ipcMain.handle('desktop:test-provider-draft', (_event, providerDraft) => {
    requireWorkerReady();
    return invokeWorker('testProviderDraft', providerDraft || {});
  });
  ipcMain.handle('desktop:discover-provider-models', (_event, providerDraft) => {
    requireWorkerReady();
    return invokeWorker('discoverProviderModels', providerDraft || {});
  });
  ipcMain.handle('desktop:get-integration-status', () => {
    if (startupState.status !== 'ready') {
      return buildPlaceholderAppState().integration;
    }

    return invokeWorker('getIntegrationStatus');
  });
  ipcMain.handle('desktop:install-integration', (_event, config) => {
    requireWorkerReady();
    return invokeWorker('installIntegration', config || {});
  });
  ipcMain.handle('desktop:export-history', (_event, options) => {
    requireWorkerReady();
    return invokeWorker('exportHistory', options || {});
  });
  ipcMain.handle('desktop:test-handshake', () => {
    requireWorkerReady();
    return invokeWorker('testHandshake');
  });
  ipcMain.handle('desktop:pick-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select memoQ installation folder',
      properties: ['openDirectory']
    });

    if (result.canceled || !result.filePaths.length) {
      return null;
    }

    return result.filePaths[0];
  });
  ipcMain.handle('desktop:import-asset', async (_event, assetType) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select an asset file to import',
      properties: ['openFile']
    });

    if (result.canceled || !result.filePaths.length) {
      return null;
    }

    requireWorkerReady();
    return invokeWorker('importAsset', {
      assetType,
      sourcePath: result.filePaths[0]
    });
  });
  ipcMain.handle('desktop:get-asset-preview', (_event, payload) => {
    requireWorkerReady();
    return invokeWorker('getAssetPreview', payload || {});
  });
  ipcMain.handle('desktop:apply-asset-tb-structure', (_event, payload) => {
    requireWorkerReady();
    return invokeWorker('applyAssetTbStructure', payload || {});
  });
  ipcMain.handle('desktop:save-asset-tb-config', (_event, payload) => {
    requireWorkerReady();
    return invokeWorker('saveAssetTbConfig', payload || {});
  });
  ipcMain.handle('desktop:delete-asset', (_event, assetId) => {
    requireWorkerReady();
    return invokeWorker('deleteAsset', assetId);
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  startBackgroundWorker();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  appIsQuitting = true;

  if (backgroundWorker) {
    try {
      backgroundWorker.send({
        type: 'request',
        id: `worker_shutdown_${Date.now()}`,
        channel: 'shutdown',
        payload: null
      });
    } catch {
    }

    setTimeout(() => {
      if (backgroundWorker) {
        backgroundWorker.kill();
      }
    }, 1000).unref();
  }
});
