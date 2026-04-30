const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function createAppPaths(options = {}) {
  const appDataRoot = String(
    options.appDataRoot
    || process.env.MEMOQ_AI_DESKTOP_DATA_DIR
    || path.join(process.env.APPDATA || process.cwd(), 'memoq-ai-hub')
  );

  const logsDir = String(
    options.logsDir
    || process.env.MEMOQ_AI_DESKTOP_LOGS_DIR
    || (process.env.MEMOQ_AI_DESKTOP_DATA_DIR
      ? path.join(appDataRoot, 'logs')
      : path.join(process.env.LOCALAPPDATA || appDataRoot, 'memoQ AI Hub', 'Logs'))
  );
  const assetsDir = path.join(appDataRoot, 'assets');
  const exportsDir = path.join(appDataRoot, 'exports');
  const tempDir = path.join(appDataRoot, 'temp');
  const updatesDir = path.join(appDataRoot, 'updates');
  const updateDownloadsDir = path.join(updatesDir, 'downloads');
  const preparedUpdatesDir = path.join(updatesDir, 'prepared');
  const updateStatePath = path.join(updatesDir, 'update-state.json');
  const dbPath = path.join(appDataRoot, 'memoq-ai-hub.db');

  ensureDir(appDataRoot);
  ensureDir(logsDir);
  ensureDir(assetsDir);
  ensureDir(exportsDir);
  ensureDir(tempDir);
  ensureDir(updatesDir);
  ensureDir(updateDownloadsDir);
  ensureDir(preparedUpdatesDir);

  return {
    appDataRoot,
    logsDir,
    assetsDir,
    exportsDir,
    tempDir,
    updatesDir,
    updateDownloadsDir,
    preparedUpdatesDir,
    updateStatePath,
    dbPath,
    repoRoot: path.resolve(__dirname, '..', '..', '..')
  };
}

module.exports = {
  createAppPaths,
  ensureDir
};
