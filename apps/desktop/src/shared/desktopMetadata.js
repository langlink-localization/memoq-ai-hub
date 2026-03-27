const fs = require('fs');
const path = require('path');

const DEFAULT_DESKTOP_VERSION = '1.0.9';

function safeStatMtimeIso(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return '';
  }
}

function readDesktopPackageMetadata(repoRoot) {
  const packagePath = path.join(String(repoRoot || ''), 'package.json');
  try {
    const raw = fs.readFileSync(packagePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      desktopVersion: String(parsed.version || DEFAULT_DESKTOP_VERSION).trim() || DEFAULT_DESKTOP_VERSION,
      packagePath,
      packageLastModifiedAt: safeStatMtimeIso(packagePath)
    };
  } catch {
    return {
      desktopVersion: DEFAULT_DESKTOP_VERSION,
      packagePath,
      packageLastModifiedAt: ''
    };
  }
}

function buildRuntimeIdentity({
  repoRoot,
  runtimeScriptPath,
  nowIso = () => new Date().toISOString()
}) {
  const packageMetadata = readDesktopPackageMetadata(repoRoot);
  return {
    desktopVersion: packageMetadata.desktopVersion,
    runtimeStartedAt: nowIso(),
    processId: process.pid,
    execPath: String(process.execPath || ''),
    execLastModifiedAt: safeStatMtimeIso(process.execPath),
    packagePath: packageMetadata.packagePath,
    packageLastModifiedAt: packageMetadata.packageLastModifiedAt,
    runtimeScriptPath: runtimeScriptPath || ''
  };
}

function readDesktopVersionFromPayload(payload = {}) {
  const directValue = String(payload.desktopVersion || '').trim();
  if (directValue) {
    return directValue;
  }
  const nestedValue = String(payload.runtime?.desktopVersion || '').trim();
  return nestedValue || DEFAULT_DESKTOP_VERSION;
}

module.exports = {
  DEFAULT_DESKTOP_VERSION,
  safeStatMtimeIso,
  readDesktopPackageMetadata,
  buildRuntimeIdentity,
  readDesktopVersionFromPayload
};
