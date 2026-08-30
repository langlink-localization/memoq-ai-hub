const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain, dialog, shell, screen, clipboard, session, Tray, Menu, nativeImage } = require('electron');
const { createAppPaths } = require('./shared/paths');
const {
  DEFAULT_LOG_POLICY,
  createLogger,
  pruneLogs
} = require('./shared/logging');
const { getIntegrationStatus } = require('./integration/integrationService');
const { DEFAULT_HOST, DEFAULT_PORT, PRODUCT_NAME, CONTRACT_VERSION } = require('./shared/desktopContract');
const { getAssetImportRules } = require('./asset/assetRules');
const { getSupportedPlaceholders } = require('./shared/promptTemplate');
const { readDesktopPackageMetadata } = require('./shared/desktopMetadata');
const { createPreviewStatusPlaceholder, createUpdateCenterPlaceholder } = require('./shared/appStateDefaults');
const { createRendererIpcRegistrar } = require('./mainIpcRegistrar');
const { buildWorkerForkOptions } = require('./workerLaunch');
const { createWorkerSupervisor } = require('./workerSupervisor');
const { getWorkerRequestTimeoutMs } = require('./workerRequestPolicy');
const { createMainSecretService } = require('./mainSecretService');
const { createLifecycleSettings } = require('./lifecycleSettings');
const { TRAY_ICON_PNG_BASE64, trayStatusLabel, buildTrayMenuTemplate } = require('./desktopTray');

const appPaths = createAppPaths();
const logger = createLogger({ source: 'desktop-main', logsDir: appPaths.logsDir });
const rendererLogger = createLogger({ source: 'renderer', logsDir: appPaths.logsDir });
let mainWindow;
let qualityWindow;
let appIsQuitting = false;
let startupState = { status: 'starting', message: '' };
const startHidden = process.argv.includes('--hidden');
const lifecycleSettings = createLifecycleSettings({
  settingsPath: path.join(app.getPath('userData'), 'lifecycle-settings.json')
});
let lifecycleState = lifecycleSettings.read();
let tray = null;
let trayNoticeShown = false;

function applyLaunchAtLogin(enabled) {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    args: enabled ? ['--hidden'] : []
  });
}

function rebuildTrayMenu() {
  if (!tray) {
    return;
  }
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate({
    productName: PRODUCT_NAME,
    settings: lifecycleState,
    statusLabel: trayStatusLabel(workerSupervisor.getStartupState().status),
    callbacks: {
      showMainWindow: () => revealWindow(),
      openAssistantWindow: () => createQualityWindow(),
      setCloseToTray: (enabled) => {
        lifecycleState = lifecycleSettings.write({ ...lifecycleState, closeToTray: enabled });
        rebuildTrayMenu();
      },
      setLaunchAtLogin: (enabled) => {
        lifecycleState = lifecycleSettings.write({ ...lifecycleState, launchAtLogin: enabled });
        applyLaunchAtLogin(enabled);
        rebuildTrayMenu();
      },
      quitApp: () => app.quit()
    }
  })));
}

function updateTrayStatus(workerStatus) {
  if (!tray) {
    return;
  }
  tray.setToolTip(`${PRODUCT_NAME} - ${trayStatusLabel(workerStatus)}`);
  rebuildTrayMenu();
}

function createTray() {
  if (tray) {
    return tray;
  }
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, 'base64'));
  tray = new Tray(icon);
  tray.setToolTip(`${PRODUCT_NAME} - ${trayStatusLabel(workerSupervisor.getStartupState().status)}`);
  tray.on('double-click', () => revealWindow());
  rebuildTrayMenu();
  return tray;
}

const mainSecretService = createMainSecretService({ paths: appPaths, logger });

const workerSupervisor = createWorkerSupervisor({
  workerPath: path.join(__dirname, 'backgroundWorker.js'),
  forkWorker: (workerModulePath, workerArgs, workerOptions) => fork(workerModulePath, workerArgs, workerOptions),
  buildForkOptions: () => buildWorkerForkOptions({
    ...process.env,
    MEMOQ_AI_DESKTOP_LOGS_DIR: appPaths.logsDir
  }),
  logger,
  mainRequestHandler: async ({ channel, payload }) => {
    if (channel === 'secrets.get') {
      return { value: mainSecretService.get(String(payload?.id || '')) };
    }
    if (channel === 'secrets.set') {
      mainSecretService.set(String(payload?.id || ''), payload?.secret);
      return { ok: true };
    }
    if (channel === 'secrets.delete') {
      mainSecretService.delete(String(payload?.id || ''));
      return { ok: true };
    }
    if (channel === 'secrets.listIds') {
      return { ids: mainSecretService.listIds() };
    }
    throw new Error(`Unknown main request channel: ${channel}`);
  },
  onStatusChange(state) {
    startupState = state;
    updateTrayStatus(state.status);
  },
  onStdout: (chunk) => {
    process.stdout.write(chunk);
    logger.info('worker-stdout', 'Desktop worker wrote to stdout.', { bytes: Buffer.byteLength(chunk) });
  },
  onStderr: (chunk) => {
    process.stderr.write(chunk);
    logger.warn('worker-stderr', 'Desktop worker wrote to stderr.', { bytes: Buffer.byteLength(chunk) });
  }
});

function getConnectionStatusLabel() {
  if (startupState.status === 'ready') return 'Connected';
  if (startupState.status === 'starting') return 'Starting';
  if (startupState.status === 'restarting') return 'Restarting';
  if (startupState.status === 'error') return 'Error';
  return 'Disconnected';
}

let placeholderSnapshot = null;

function getStartupPlaceholderSnapshot() {
  if (!placeholderSnapshot) {
    placeholderSnapshot = {
      versionMetadata: readDesktopPackageMetadata(path.join(__dirname, '..')),
      integration: getIntegrationStatus(appPaths, { memoqVersion: '11' })
    };
  }
  return placeholderSnapshot;
}

function buildPlaceholderAppState() {
  const { versionMetadata, integration } = getStartupPlaceholderSnapshot();
  const connectionStatus = getConnectionStatusLabel();
  const previewPlaceholderStatus = ['starting', 'restarting'].includes(startupState.status) ? 'starting' : 'disconnected';
  const notices = [];

  if (startupState.status === 'error') {
    notices.push(startupState.message || 'Desktop services failed to start.');
  } else if (startupState.status === 'restarting') {
    notices.push(startupState.message || 'Desktop services are restarting after an unexpected stop.');
  } else if (startupState.status === 'starting') {
    notices.push('Desktop services are waiting for memoQ startup.');
  }

  if (!notices.length) {
    notices.push('The app is ready for first-time configuration.');
  }

  const previewStatus = createPreviewStatusPlaceholder({
    status: previewPlaceholderStatus,
    statusMessage: previewPlaceholderStatus === 'starting' ? 'Waiting for memoQ startup.' : ''
  });
  const updateCenter = createUpdateCenterPlaceholder(versionMetadata.desktopVersion);

  return {
    productName: PRODUCT_NAME,
    contractVersion: CONTRACT_VERSION,
    gatewayBaseUrl: `http://${DEFAULT_HOST}:${DEFAULT_PORT}`,
    startup: { ...startupState },
    dashboard: {
      checklist: [
        { key: 'install-plugin', title: '1. Install integration', subtitle: integration.status === 'installed' ? 'Integration ready' : 'Integration not installed', actionLabel: 'Install or repair', completed: integration.status === 'installed', count: integration.status === 'installed' ? 1 : 0 },
        { key: 'provider-hub', title: '2. Connect AI service', subtitle: 'No AI service yet', actionLabel: 'Connect', completed: false, count: 0 },
        { key: 'asset-hub', title: '3. Add optional assets', subtitle: 'Optional — no assets uploaded', actionLabel: 'Add assets', completed: false, optional: true, count: 0 },
        { key: 'context-builder', title: '4. Create profile', subtitle: 'No profile yet', actionLabel: 'Create', completed: false, count: 0 },
        { key: 'history', title: '5. Review a run', subtitle: 'No translation records yet', actionLabel: 'Review', completed: false, count: 0 }
      ],
      runtimeStatus: {
        memoqInstallPath: integration.selectedInstallDir || integration.installations[0]?.rootDir || 'Not detected',
        pluginStatus: integration.status,
        connectionStatus,
        previewStatus
      },
      updateCenter,
      notices
    },
    integration,
    previewBridge: previewStatus,
    contextBuilder: {
      profiles: [],
      defaultProfileId: '',
      assets: [],
      supportedPlaceholders: getSupportedPlaceholders(),
      assetImportRules: getAssetImportRules()
    },
    memoqMetadataMapping: { rules: [] },
    providerHub: { providers: [], summary: { enabled: 0, healthy: 0 } },
    historyExplorer: { items: [] },
    updateCenter,
    quality: {
      enabled: true,
      aiDefaultEnabled: false,
      activeRequestCount: 0,
      retentionDays: 30,
      latestResult: null,
      lastError: ''
    }
  };
}

function invokeWorker(channel, payload) {
  return workerSupervisor.invoke(channel, payload, { timeoutMs: getWorkerRequestTimeoutMs(channel) });
}

function requireWorkerReady() {
  const workerState = workerSupervisor.getStartupState();

  if (workerState.status === 'ready') {
    return;
  }

  throw new Error(
    workerState.status === 'error' || workerState.status === 'restarting'
      ? (workerState.message || 'Desktop services failed to start.')
      : 'Desktop services are waiting for memoQ startup.'
  );
}

function revealWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
}

function getInitialWindowWidth() {
  const requestedWidth = Number.parseInt(process.env.MEMOQ_AI_DESKTOP_WINDOW_WIDTH || '', 10);
  return Number.isInteger(requestedWidth) && requestedWidth >= 720 && requestedWidth <= 3840
    ? requestedWidth
    : 1440;
}

let startupLogPruneDone = false;

function scheduleStartupLogPrune() {
  if (startupLogPruneDone) {
    return;
  }
  startupLogPruneDone = true;
  setImmediate(() => {
    try {
      pruneLogs(appPaths.logsDir, DEFAULT_LOG_POLICY);
    } catch (error) {
      logger.warn('log-prune-failed', 'Startup log prune failed.', { error });
    }
  });
}

function getRendererDevServerUrl() {
  return typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined'
    ? MAIN_WINDOW_VITE_DEV_SERVER_URL
    : null;
}

function isAllowedRendererNavigationUrl(url, rendererDevServerUrl) {
  const targetUrl = String(url || '');
  if (!targetUrl) {
    return false;
  }
  if (targetUrl.startsWith('devtools://')) {
    return true;
  }
  if (rendererDevServerUrl && targetUrl.startsWith(rendererDevServerUrl)) {
    return true;
  }
  const rendererRootUrl = pathToFileURL(path.join(__dirname, '..', 'renderer') + path.sep).href;
  return targetUrl.startsWith(rendererRootUrl);
}

function lockdownWebContents(webContents, windowLabel) {
  webContents.setWindowOpenHandler(({ url }) => {
    logger.warn('window-open-blocked', 'Blocked a renderer window.open call.', { url, windowLabel });
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (isAllowedRendererNavigationUrl(url, getRendererDevServerUrl())) {
      return;
    }
    event.preventDefault();
    logger.warn('navigation-blocked', 'Blocked a renderer navigation.', { url, windowLabel });
  });
}

function createWindow() {
  const rendererDevServerUrl = getRendererDevServerUrl();

  let revealTimeout;

  mainWindow = new BrowserWindow({
    width: getInitialWindowWidth(),
    height: 960,
    minWidth: 720,
    minHeight: 760,
    useContentSize: true,
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

  lockdownWebContents(mainWindow.webContents, 'main-window');

  mainWindow.webContents.on('did-finish-load', () => {
    logger.info('renderer-loaded', 'Renderer finished loading.');
    scheduleStartupLogPrune();
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    logger.error('renderer-load-failed', 'Renderer failed to load.', { errorCode, errorDescription });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error('renderer-process-gone', 'Renderer process exited unexpectedly.', { details });
    if (mainWindow && !mainWindow.isDestroyed() && details.reason !== 'clean-exit') {
      mainWindow.webContents.reload();
    }
  });

  mainWindow.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      rendererLogger.warn('console-message', 'Renderer console warning or error.', {
        level: details.level,
        message: details.message,
        line: details.lineNumber,
        sourceId: details.sourceId
      });
    }
  });

  const revealWindowSafely = () => {
    if (revealTimeout) {
      clearTimeout(revealTimeout);
      revealTimeout = null;
    }

    revealWindow();
  };

  mainWindow.on('close', (event) => {
    if (appIsQuitting || !lifecycleState.closeToTray) {
      return;
    }
    event.preventDefault();
    mainWindow.hide();
    if (!trayNoticeShown && tray) {
      trayNoticeShown = true;
      tray.displayBalloon?.({
        title: PRODUCT_NAME,
        content: 'memoQ AI Hub keeps running in the tray so memoQ translations stay available. Use Quit in the tray menu to exit.'
      });
    }
  });

  if (!startHidden) {
    mainWindow.once('ready-to-show', revealWindowSafely);
    mainWindow.webContents.once('did-finish-load', revealWindowSafely);
    mainWindow.webContents.once('did-fail-load', revealWindowSafely);
    revealTimeout = setTimeout(revealWindowSafely, 1500);
  }

  mainWindow.on('closed', () => {
    if (revealTimeout) {
      clearTimeout(revealTimeout);
      revealTimeout = null;
    }
    mainWindow = null;
  });

  if (rendererDevServerUrl) {
    mainWindow.loadURL(rendererDevServerUrl);
    return;
  }

  const rendererName = typeof MAIN_WINDOW_VITE_NAME !== 'undefined'
    ? MAIN_WINDOW_VITE_NAME
    : 'main_window';
  mainWindow.loadFile(path.join(__dirname, `../renderer/${rendererName}/index.html`));
}

function getQualityBoundsPath() {
  return path.join(app.getPath('userData'), 'quality-window-bounds.json');
}

function readQualityBounds() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getQualityBoundsPath(), 'utf8'));
    const bounds = { x: Number(parsed.x), y: Number(parsed.y), width: Number(parsed.width), height: Number(parsed.height) };
    if (Object.values(bounds).every(Number.isFinite)) {
      const workArea = screen.getDisplayMatching(bounds).workArea;
      const width = Math.max(360, Math.min(bounds.width, workArea.width));
      const height = Math.max(420, Math.min(bounds.height, workArea.height));
      return {
        width,
        height,
        x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width)),
        y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height))
      };
    }
  } catch {
    // Bounds file is absent or unreadable (typical first run) — use the default size.
  }
  return { width: 400, height: 560 };
}

function saveQualityBounds() {
  if (!qualityWindow || qualityWindow.isDestroyed()) return;
  try {
    fs.mkdirSync(path.dirname(getQualityBoundsPath()), { recursive: true });
    fs.writeFileSync(getQualityBoundsPath(), JSON.stringify(qualityWindow.getBounds()), 'utf8');
  } catch (error) {
    logger.warn('quality-window-bounds-save-failed', 'Could not save quality window bounds.', { error });
  }
}

function createQualityWindow() {
  if (qualityWindow && !qualityWindow.isDestroyed()) {
    qualityWindow.showInactive();
    return qualityWindow;
  }
  const rendererDevServerUrl = getRendererDevServerUrl();
  qualityWindow = new BrowserWindow({
    ...readQualityBounds(),
    minWidth: 360,
    minHeight: 420,
    alwaysOnTop: true,
    title: `${PRODUCT_NAME} - Assistant`,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
  });
  lockdownWebContents(qualityWindow.webContents, 'assistant-window');
  qualityWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error('assistant-renderer-process-gone', 'Assistant renderer process exited unexpectedly.', { details });
    if (qualityWindow && !qualityWindow.isDestroyed() && details.reason !== 'clean-exit') {
      qualityWindow.webContents.reload();
    }
  });
  qualityWindow.on('close', saveQualityBounds);
  qualityWindow.on('closed', () => { qualityWindow = null; });
  qualityWindow.once('ready-to-show', () => qualityWindow?.showInactive());
  if (rendererDevServerUrl) {
    qualityWindow.loadURL(`${rendererDevServerUrl}${rendererDevServerUrl.includes('?') ? '&' : '?'}window=assistant-float`);
  } else {
    const rendererName = typeof MAIN_WINDOW_VITE_NAME !== 'undefined' ? MAIN_WINDOW_VITE_NAME : 'main_window';
    qualityWindow.loadFile(path.join(__dirname, `../renderer/${rendererName}/index.html`), { query: { window: 'assistant-float' } });
  }
  return qualityWindow;
}

const registerIpcHandlers = createRendererIpcRegistrar({
  ipcMain,
  dialog,
  shell,
  clipboard,
  appPaths,
  rendererLogger,
  gatewayBaseUrl: `http://${DEFAULT_HOST}:${DEFAULT_PORT}`,
  getMainWindow: () => mainWindow,
  getStartupState: () => startupState,
  buildPlaceholderAppState,
  requireWorkerReady,
  invokeWorker,
  createQualityWindow,
  requestQuit: () => {
    setImmediate(() => {
      app.quit();
    });
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    revealWindow();
  });

  app.whenReady().then(() => {
    logger.info('app-ready', 'Electron app is ready.');
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      logger.warn('permission-denied', 'Denied a renderer permission request.', { permission });
      callback(false);
    });
    registerIpcHandlers();
    createWindow();
    createTray();
    workerSupervisor.start();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    appIsQuitting = true;
    saveQualityBounds();
    logger.info('app-before-quit', 'Electron app is shutting down.');
    workerSupervisor.requestShutdown();
  });
}
