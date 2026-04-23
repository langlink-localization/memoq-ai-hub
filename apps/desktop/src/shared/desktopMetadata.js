const fs = require('fs');
const path = require('path');

const DEFAULT_DESKTOP_VERSION = '0.0.0';

function safeStatMtimeIso(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return '';
  }
}

function buildSearchRoots(repoRoot) {
  const roots = [
    String(repoRoot || ''),
    String(process.resourcesPath || ''),
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar') : ''
  ].filter(Boolean);

  const uniqueRoots = [];
  const seen = new Set();

  for (const root of roots) {
    const resolved = path.resolve(root);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      uniqueRoots.push(resolved);
    }
  }

  return uniqueRoots;
}

function findNearestPackageJsonPath(startDir) {
  if (!startDir) {
    return '';
  }

  let currentDir = path.resolve(startDir);
  while (currentDir && currentDir !== path.dirname(currentDir)) {
    const packagePath = path.join(currentDir, 'package.json');
    if (fs.existsSync(packagePath)) {
      return packagePath;
    }
    currentDir = path.dirname(currentDir);
  }

  const finalCandidate = path.join(currentDir, 'package.json');
  return fs.existsSync(finalCandidate) ? finalCandidate : '';
}

function resolveDesktopPackagePath(repoRoot) {
  for (const searchRoot of buildSearchRoots(repoRoot)) {
    const packagePath = findNearestPackageJsonPath(searchRoot);
    if (packagePath) {
      return packagePath;
    }
  }

  return path.join(path.resolve(String(repoRoot || process.cwd() || '.')), 'package.json');
}

function readDesktopPackageMetadata(repoRoot) {
  const packagePath = resolveDesktopPackagePath(repoRoot);
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
  const metadataRoot = runtimeScriptPath ? path.dirname(runtimeScriptPath) : repoRoot;
  const packageMetadata = readDesktopPackageMetadata(metadataRoot);
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
  resolveDesktopPackagePath,
  safeStatMtimeIso,
  readDesktopPackageMetadata,
  buildRuntimeIdentity,
  readDesktopVersionFromPayload
};
