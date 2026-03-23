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

  const assetsDir = path.join(appDataRoot, 'assets');
  const exportsDir = path.join(appDataRoot, 'exports');
  const tempDir = path.join(appDataRoot, 'temp');
  const dbPath = path.join(appDataRoot, 'memoq-ai-hub.db');

  ensureDir(appDataRoot);
  ensureDir(assetsDir);
  ensureDir(exportsDir);
  ensureDir(tempDir);

  return {
    appDataRoot,
    assetsDir,
    exportsDir,
    tempDir,
    dbPath,
    repoRoot: path.resolve(__dirname, '..', '..', '..')
  };
}

module.exports = {
  createAppPaths,
  ensureDir
};
