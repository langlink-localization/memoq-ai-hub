// Registers the renderer-facing IPC handlers. Worker-proxied channels are
// registered straight from rendererIpcSurface; main-local channels (dialogs,
// shell, windows, logging, startup-aware state) live here because they need
// Electron APIs or process state. Electron dependencies arrive via deps so the
// registrar stays loadable and testable outside Electron.

const { MAIN_LOCAL_METHODS, WORKER_PROXIED_METHODS } = require('./rendererIpcSurface');
const { normalizeExternalHttpsUrl } = require('./shared/externalNavigation');
const { DEFAULT_LOG_POLICY, getLogState, pruneLogs } = require('./shared/logging');

function createRendererIpcRegistrar(deps) {
  const {
    ipcMain,
    dialog,
    shell,
    clipboard,
    appPaths,
    rendererLogger,
    getMainWindow,
    getStartupState,
    buildPlaceholderAppState,
    requireWorkerReady,
    invokeWorker,
    createQualityWindow,
    requestQuit
  } = deps;

  function registerWorkerProxiedHandlers() {
    for (const spec of Object.values(WORKER_PROXIED_METHODS)) {
      ipcMain.handle(spec.channel, (_event, ...args) => {
        requireWorkerReady();
        return invokeWorker(spec.worker, spec.workerPayload ? spec.workerPayload(...args) : args[0]);
      });
    }
  }

  function registerLocalHandlers() {
    ipcMain.handle(MAIN_LOCAL_METHODS.getGatewayBaseUrl.channel, () => deps.gatewayBaseUrl);

    ipcMain.handle(MAIN_LOCAL_METHODS.getLogState.channel, () => getLogState(appPaths.logsDir, DEFAULT_LOG_POLICY));
    ipcMain.handle(MAIN_LOCAL_METHODS.pruneLogs.channel, () => pruneLogs(appPaths.logsDir, DEFAULT_LOG_POLICY));

    ipcMain.handle(MAIN_LOCAL_METHODS.recordRendererLog.channel, (_event, payload) => {
      const level = String(payload?.level || 'info').toLowerCase();
      const event = String(payload?.event || 'renderer-event');
      const messageText = String(payload?.message || '');
      const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};

      if (level === 'error') {
        rendererLogger.error(event, messageText, data);
      } else if (level === 'warn') {
        rendererLogger.warn(event, messageText, data);
      } else if (level === 'debug') {
        rendererLogger.debug(event, messageText, data);
      } else {
        rendererLogger.info(event, messageText, data);
      }

      return { ok: true };
    });

    ipcMain.handle(MAIN_LOCAL_METHODS.getAppState.channel, (_event, filters) => {
      if (getStartupState().status !== 'ready') {
        return buildPlaceholderAppState();
      }

      return invokeWorker('getAppState', filters || {});
    });

    ipcMain.handle(MAIN_LOCAL_METHODS.getIntegrationStatus.channel, () => {
      if (getStartupState().status !== 'ready') {
        return buildPlaceholderAppState().integration;
      }

      return invokeWorker('getIntegrationStatus');
    });

    ipcMain.handle(MAIN_LOCAL_METHODS.pickDirectory.channel, async () => {
      const result = await dialog.showOpenDialog(getMainWindow(), {
        title: 'Select memoQ installation folder',
        properties: ['openDirectory']
      });

      if (result.canceled || !result.filePaths.length) {
        return null;
      }

      return result.filePaths[0];
    });

    ipcMain.handle(MAIN_LOCAL_METHODS.importAsset.channel, async (_event, assetType) => {
      const result = await dialog.showOpenDialog(getMainWindow(), {
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

    ipcMain.handle(MAIN_LOCAL_METHODS.importBilingualQa.channel, async (_event, payload) => {
      const result = await dialog.showOpenDialog(getMainWindow(), {
        title: 'Select an MQXLIFF or XLIFF file to inspect',
        properties: ['openFile'],
        filters: [{ name: 'Bilingual files', extensions: ['mqxliff', 'xlf', 'xliff'] }]
      });
      if (result.canceled || !result.filePaths.length) return null;
      requireWorkerReady();
      return invokeWorker('inspectBilingualFile', { ...(payload || {}), filePath: result.filePaths[0] });
    });

    ipcMain.handle(MAIN_LOCAL_METHODS.openQualityWindow.channel, () => {
      createQualityWindow();
      return { ok: true };
    });

    ipcMain.handle(MAIN_LOCAL_METHODS.openAssistantWindow.channel, () => {
      createQualityWindow();
      return { ok: true };
    });

    ipcMain.handle(MAIN_LOCAL_METHODS.copyText.channel, (_event, value) => {
      clipboard.writeText(String(value || ''));
      return { ok: true };
    });

    ipcMain.handle(MAIN_LOCAL_METHODS.openPath.channel, async (_event, targetPath) => {
      const normalizedPath = String(targetPath || '').trim();
      if (!normalizedPath) {
        return { ok: false, opened: false };
      }
      const openError = await shell.openPath(normalizedPath);
      if (openError) {
        throw new Error(openError);
      }
      return { ok: true, opened: true, targetPath: normalizedPath };
    });

    ipcMain.handle(MAIN_LOCAL_METHODS.showItemInFolder.channel, (_event, targetPath) => {
      const normalizedPath = String(targetPath || '').trim();
      if (!normalizedPath) {
        return { ok: false, revealed: false };
      }
      shell.showItemInFolder(normalizedPath);
      return { ok: true, revealed: true, targetPath: normalizedPath };
    });

    ipcMain.handle(MAIN_LOCAL_METHODS.openExternalUrl.channel, async (_event, url) => {
      const requestedUrl = String(url || '').trim();
      if (!requestedUrl) {
        return { ok: false, opened: false };
      }
      const normalizedUrl = normalizeExternalHttpsUrl(requestedUrl);
      await shell.openExternal(normalizedUrl);
      return { ok: true, opened: true, url: normalizedUrl };
    });

    ipcMain.handle(MAIN_LOCAL_METHODS.launchDownloadedInstallerUpdate.channel, async (_event, installerPath) => {
      const normalizedPath = String(installerPath || '').trim();
      if (!normalizedPath) {
        throw new Error('Installer path is required.');
      }

      const verification = await invokeWorker('verifyDownloadedInstallerUpdate', {
        installerPath: normalizedPath
      });
      const verifiedInstallerPath = String(verification?.installerPath || '').trim();
      if (verification?.ok !== true || !verifiedInstallerPath) {
        throw new Error('Downloaded installer integrity verification failed.');
      }

      const openError = await shell.openPath(verifiedInstallerPath);
      if (openError) {
        throw new Error(openError);
      }

      requestQuit();
      return { ok: true, launched: true, installerPath: verifiedInstallerPath };
    });
  }

  return function registerIpcHandlers() {
    registerWorkerProxiedHandlers();
    registerLocalHandlers();
  };
}

module.exports = {
  createRendererIpcRegistrar
};
