const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const DEFAULT_RELEASE_REPOSITORY = 'langlink-localization/memoq-ai-hub';
const STABLE_RELEASE_CHANNEL = 'stable';
const STABLE_UPDATE_MANIFEST_NAME = 'memoq-ai-hub-updates-stable.json';
const DEFAULT_UPDATE_STATUS = 'idle';
const AVAILABLE_UPDATE_STATUSES = new Set(['available', 'downloading', 'prepared']);
const DEFAULT_MANIFEST_TIMEOUT_MS = 12_000;
const UPDATE_CHECK_FAILED_CODE = 'UPDATE_CHECK_FAILED';
const UPDATE_CHECK_TIMEOUT_CODE = 'UPDATE_CHECK_TIMEOUT';
const UPDATE_CHECK_FAILED_MESSAGE = 'Unable to check for updates. Please try again later.';
const UPDATE_CHECK_TIMEOUT_MESSAGE = 'Update check timed out. Please try again later.';
const PORTABLE_IN_APP_UPDATE_DISABLED_MESSAGE = 'Portable builds use a browser download page instead of downloading updates inside the app.';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function parseVersionSegments(version) {
  return String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((segment) => Number.parseInt(segment, 10))
    .map((segment) => (Number.isFinite(segment) ? segment : 0));
}

function compareVersions(leftVersion, rightVersion) {
  const left = parseVersionSegments(leftVersion);
  const right = parseVersionSegments(rightVersion);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] || 0;
    const rightValue = right[index] || 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

function createDefaultUpdateState({ currentVersion, packagingMode, manifestUrl }) {
  return {
    currentVersion: String(currentVersion || '').trim(),
    releaseChannel: STABLE_RELEASE_CHANNEL,
    packagingMode: String(packagingMode || 'portable').trim() || 'portable',
    updateStatus: DEFAULT_UPDATE_STATUS,
    latestVersion: '',
    publishedAt: '',
    releaseNotes: '',
    releaseNotesUrl: '',
    portableDownloadUrl: '',
    downloadedArtifactPath: '',
    preparedDirectory: '',
    lastCheckedAt: '',
    lastError: '',
    lastErrorCode: '',
    manualCheckRequestedAt: '',
    manifestUrl: String(manifestUrl || '').trim(),
    pluginReinstallRecommended: true,
    availableAssets: {
      portable: null,
      installer: null
    }
  };
}

function normalizePersistedUpdateState(defaultState, persistedState = {}) {
  const nextState = {
    ...defaultState,
    ...(persistedState && typeof persistedState === 'object' ? persistedState : {})
  };

  const persistedCurrentVersion = String(persistedState?.currentVersion || '').trim();
  const persistedManifestUrl = String(persistedState?.manifestUrl || '').trim();
  const persistedPackagingMode = String(persistedState?.packagingMode || '').trim();
  const updateStatus = String(nextState.updateStatus || '').trim().toLowerCase();
  const latestVersion = String(nextState.latestVersion || '').trim();
  const currentVersion = String(defaultState.currentVersion || '').trim();
  const staleAvailableUpdate = AVAILABLE_UPDATE_STATUSES.has(updateStatus)
    && (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0);
  const stateBelongsToPreviousRuntime = (persistedCurrentVersion && persistedCurrentVersion !== defaultState.currentVersion)
    || (persistedManifestUrl && persistedManifestUrl !== defaultState.manifestUrl)
    || (persistedPackagingMode && persistedPackagingMode !== defaultState.packagingMode);

  if (!stateBelongsToPreviousRuntime && !staleAvailableUpdate) {
    return nextState;
  }

  return {
    ...defaultState,
    updateStatus: latestVersion && compareVersions(latestVersion, currentVersion) <= 0
      ? 'up-to-date'
      : DEFAULT_UPDATE_STATUS,
    lastCheckedAt: String(nextState.lastCheckedAt || ''),
    lastError: '',
    lastErrorCode: '',
    manualCheckRequestedAt: String(nextState.manualCheckRequestedAt || ''),
    pluginReinstallRecommended: nextState.pluginReinstallRecommended !== false
  };
}

function createNoopLogger() {
  return {
    info() {},
    warn() {},
    error() {}
  };
}

function createUpdateCheckTimeoutError(timeoutMs) {
  const error = new Error(UPDATE_CHECK_TIMEOUT_MESSAGE);
  error.code = UPDATE_CHECK_TIMEOUT_CODE;
  error.statusCode = 408;
  error.timeoutMs = timeoutMs;
  return error;
}

function normalizeUpdateCheckError(error) {
  const code = String(error?.code || '').trim();
  if (
    code === UPDATE_CHECK_TIMEOUT_CODE
    || error?.name === 'AbortError'
    || code === 'ABORT_ERR'
  ) {
    return {
      code: UPDATE_CHECK_TIMEOUT_CODE,
      message: UPDATE_CHECK_TIMEOUT_MESSAGE,
      detail: String(error?.message || UPDATE_CHECK_TIMEOUT_MESSAGE)
    };
  }

  return {
    code: code || UPDATE_CHECK_FAILED_CODE,
    message: UPDATE_CHECK_FAILED_MESSAGE,
    detail: String(error?.message || error || UPDATE_CHECK_FAILED_MESSAGE)
  };
}

function normalizeAsset(asset = {}) {
  if (!asset || typeof asset !== 'object') {
    return null;
  }

  const name = String(asset.name || '').trim();
  const url = String(asset.url || '').trim();
  if (!name || !url) {
    return null;
  }

  return {
    name,
    url,
    contentType: String(asset.contentType || '').trim(),
    size: Number.isFinite(Number(asset.size)) ? Number(asset.size) : null
  };
}

function normalizeManifest(manifest = {}) {
  const version = String(manifest.version || manifest.latestVersion || '').trim().replace(/^v/i, '');
  if (!version) {
    throw new Error('Update manifest is missing a version field.');
  }

  return {
    version,
    tag: String(manifest.tag || `v${version}`).trim(),
    channel: String(manifest.channel || STABLE_RELEASE_CHANNEL).trim() || STABLE_RELEASE_CHANNEL,
    publishedAt: String(manifest.publishedAt || '').trim(),
    releaseNotes: String(manifest.releaseNotes || '').trim(),
    releaseNotesUrl: String(manifest.releaseNotesUrl || '').trim(),
    assets: {
      portable: normalizeAsset(manifest.assets?.portable),
      installer: normalizeAsset(manifest.assets?.installer)
    }
  };
}

function resolvePackagingMode({
  packagingMode,
  fsImpl = fs,
  execPath = process.execPath
} = {}) {
  const explicit = String(
    packagingMode
    || process.env.MEMOQ_AI_PACKAGING_MODE
    || ''
  ).trim().toLowerCase();

  if (explicit === 'portable' || explicit === 'installed') {
    return explicit;
  }

  const normalizedExecPath = String(execPath || '').trim();
  if (!normalizedExecPath) {
    return 'portable';
  }

  const executableDir = path.dirname(normalizedExecPath);
  const squirrelUpdateExePath = path.join(path.dirname(executableDir), 'Update.exe');
  if (fsImpl.existsSync(squirrelUpdateExePath)) {
    return 'installed';
  }

  return 'portable';
}

async function expandArchiveWithPowerShell(sourcePath, targetDir) {
  const powershellPath = process.platform === 'win32'
    ? 'powershell.exe'
    : 'pwsh';
  await execFileAsync(powershellPath, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Expand-Archive -LiteralPath '${String(sourcePath).replace(/'/g, "''")}' -DestinationPath '${String(targetDir).replace(/'/g, "''")}' -Force`
  ]);
}

function getDefaultManifestUrl(repository = DEFAULT_RELEASE_REPOSITORY) {
  return `https://github.com/${repository}/releases/latest/download/${STABLE_UPDATE_MANIFEST_NAME}`;
}

function createUpdateService(options = {}) {
  const fsImpl = options.fs || fs;
  const fetchImpl = options.fetch || globalThis.fetch;
  const logger = options.logger || createNoopLogger();
  const manifestTimeoutMs = Number.isFinite(Number(options.manifestTimeoutMs))
    ? Math.max(1, Number(options.manifestTimeoutMs))
    : DEFAULT_MANIFEST_TIMEOUT_MS;
  const nowIso = typeof options.nowIso === 'function' ? options.nowIso : () => new Date().toISOString();
  const repository = String(options.releaseRepository || DEFAULT_RELEASE_REPOSITORY).trim() || DEFAULT_RELEASE_REPOSITORY;
  const manifestUrl = String(options.manifestUrl || getDefaultManifestUrl(repository)).trim();
  const currentVersion = String(options.currentVersion || '').trim();
  const packagingMode = resolvePackagingMode({
    packagingMode: options.packagingMode,
    fsImpl,
    execPath: options.execPath
  });
  const extractArchive = options.extractArchive || expandArchiveWithPowerShell;
  const appPaths = options.paths || {};

  ensureDir(appPaths.updatesDir || path.join(process.cwd(), 'updates'));
  ensureDir(appPaths.updateDownloadsDir || path.join(process.cwd(), 'updates', 'downloads'));
  ensureDir(appPaths.preparedUpdatesDir || path.join(process.cwd(), 'updates', 'prepared'));

  const persistedStatePath = String(
    options.updateStatePath
    || appPaths.updateStatePath
    || path.join(appPaths.updatesDir || process.cwd(), 'update-state.json')
  );

  function readPersistedState() {
    try {
      const raw = fsImpl.readFileSync(persistedStatePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writePersistedState(nextState) {
    ensureDir(path.dirname(persistedStatePath));
    fsImpl.writeFileSync(persistedStatePath, JSON.stringify(nextState, null, 2), 'utf8');
  }

  const defaultState = createDefaultUpdateState({ currentVersion, packagingMode, manifestUrl });
  const persistedState = readPersistedState();
  let state = normalizePersistedUpdateState(defaultState, persistedState);
  if (JSON.stringify(state) !== JSON.stringify({ ...defaultState, ...persistedState })) {
    writePersistedState(state);
  }

  function persistState(nextState) {
    state = {
      ...nextState,
      currentVersion,
      releaseChannel: STABLE_RELEASE_CHANNEL,
      packagingMode,
      manifestUrl
    };
    writePersistedState(state);
    return getStatus();
  }

  function getStatus() {
    return {
      ...state,
      currentVersion,
      releaseChannel: STABLE_RELEASE_CHANNEL,
      packagingMode,
      manifestUrl,
      availableAssets: {
        portable: normalizeAsset(state.availableAssets?.portable),
        installer: normalizeAsset(state.availableAssets?.installer)
      }
    };
  }

  function setState(patch = {}) {
    return persistState({
      ...state,
      ...patch
    });
  }

  async function fetchManifest() {
    if (typeof fetchImpl !== 'function') {
      throw new Error('Update checking is unavailable because fetch is not configured.');
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutError = createUpdateCheckTimeoutError(manifestTimeoutMs);
    let timeoutId;
    const requestOptions = {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache',
        pragma: 'no-cache'
      }
    };

    if (controller) {
      requestOptions.signal = controller.signal;
    }

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        if (controller) {
          controller.abort(timeoutError);
        }
        reject(timeoutError);
      }, manifestTimeoutMs);
      if (typeof timeoutId.unref === 'function') {
        timeoutId.unref();
      }
    });

    let response;
    try {
      response = await Promise.race([
        Promise.resolve().then(() => fetchImpl(manifestUrl, requestOptions)),
        timeoutPromise
      ]);
    } catch (error) {
      throw normalizeUpdateCheckError(error).code === UPDATE_CHECK_TIMEOUT_CODE
        ? createUpdateCheckTimeoutError(manifestTimeoutMs)
        : error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response || response.ok !== true) {
      throw new Error(`Update manifest request failed with status ${response?.status || 'unknown'}.`);
    }

    return normalizeManifest(await response.json());
  }

  function getRequestedAsset(kind) {
    const asset = kind === 'installer'
      ? state.availableAssets?.installer
      : state.availableAssets?.portable;
    if (!asset?.url || !asset?.name) {
      throw new Error(`No ${kind} update is currently available.`);
    }
    return asset;
  }

  async function downloadAsset(kind) {
    const asset = getRequestedAsset(kind);
    const destinationPath = path.join(appPaths.updateDownloadsDir, asset.name);

    setState({
      updateStatus: 'downloading',
      lastError: ''
    });

    const response = await fetchImpl(asset.url);
    if (!response || response.ok !== true) {
      throw new Error(`Update download failed with status ${response?.status || 'unknown'}.`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fsImpl.writeFileSync(destinationPath, buffer);

    return setState({
      updateStatus: 'available',
      downloadedArtifactPath: destinationPath,
      lastError: ''
    });
  }

  function buildPreparedDirectory(version) {
    const safeVersion = String(version || 'prepared').replace(/[^0-9A-Za-z._-]+/g, '-');
    return path.join(appPaths.preparedUpdatesDir, `memoq-ai-hub-v${safeVersion}`);
  }

  function isSquirrelFirstRun() {
    return Array.isArray(options.argv || process.argv)
      && (options.argv || process.argv).some((value) => String(value || '').trim().toLowerCase() === '--squirrel-firstrun');
  }

  return {
    getStatus,
    async checkForUpdates(options = {}) {
      if (packagingMode === 'installed' && isSquirrelFirstRun()) {
        return setState({
          updateStatus: DEFAULT_UPDATE_STATUS,
          lastError: '',
          lastErrorCode: '',
          lastCheckedAt: nowIso(),
          manualCheckRequestedAt: options.manual ? nowIso() : state.manualCheckRequestedAt
        });
      }

      setState({
        updateStatus: 'checking',
        lastError: '',
        lastErrorCode: '',
        manualCheckRequestedAt: options.manual ? nowIso() : state.manualCheckRequestedAt
      });

      const startedAtMs = Date.now();
      logger.info('update-check-start', 'Checking for updates.', {
        manual: options.manual === true,
        manifestUrl,
        currentVersion,
        packagingMode,
        timeoutMs: manifestTimeoutMs
      });

      try {
        const manifest = await fetchManifest();
        const hasUpdate = compareVersions(manifest.version, currentVersion) > 0;
        const portableDownloadUrl = hasUpdate ? (manifest.releaseNotesUrl || manifest.assets?.portable?.url || '') : '';
        const nextStatus = hasUpdate ? 'available' : 'up-to-date';
        logger.info('update-check-complete', 'Update check completed.', {
          elapsedMs: Date.now() - startedAtMs,
          updateStatus: nextStatus,
          currentVersion,
          latestVersion: manifest.version,
          hasUpdate,
          manifestUrl
        });
        return setState({
          updateStatus: nextStatus,
          latestVersion: manifest.version,
          publishedAt: manifest.publishedAt,
          releaseNotes: manifest.releaseNotes,
          releaseNotesUrl: manifest.releaseNotesUrl,
          portableDownloadUrl,
          lastCheckedAt: nowIso(),
          lastError: '',
          lastErrorCode: '',
          downloadedArtifactPath: hasUpdate && packagingMode !== 'portable' ? state.downloadedArtifactPath : '',
          preparedDirectory: hasUpdate && packagingMode !== 'portable' ? state.preparedDirectory : '',
          availableAssets: hasUpdate ? manifest.assets : defaultState.availableAssets
        });
      } catch (error) {
        const normalizedError = normalizeUpdateCheckError(error);
        logger.warn('update-check-failed', 'Update check failed.', {
          elapsedMs: Date.now() - startedAtMs,
          manifestUrl,
          errorCode: normalizedError.code,
          errorMessage: normalizedError.message,
          errorDetail: normalizedError.detail
        });
        return setState({
          updateStatus: 'error',
          lastCheckedAt: nowIso(),
          lastError: normalizedError.message,
          lastErrorCode: normalizedError.code
        });
      }
    },
    async downloadPortableUpdate() {
      if (packagingMode !== 'portable') {
        throw new Error('Portable update download is only available in portable mode.');
      }
      throw new Error(PORTABLE_IN_APP_UPDATE_DISABLED_MESSAGE);
    },
    async downloadInstallerUpdate() {
      if (packagingMode !== 'installed') {
        throw new Error('Installer update download is only available in installed mode.');
      }
      return downloadAsset('installer');
    },
    async preparePortableUpdate(downloadedFile, targetDir) {
      if (packagingMode === 'portable') {
        throw new Error(PORTABLE_IN_APP_UPDATE_DISABLED_MESSAGE);
      }
      const sourcePath = String(downloadedFile || state.downloadedArtifactPath || '').trim();
      if (!sourcePath) {
        throw new Error('A downloaded portable archive is required before preparing an update.');
      }
      if (!fsImpl.existsSync(sourcePath)) {
        throw new Error(`Downloaded update archive not found: ${sourcePath}`);
      }

      const destinationDir = String(targetDir || buildPreparedDirectory(state.latestVersion || nowIso())).trim();
      if (!destinationDir) {
        throw new Error('A target directory is required to prepare the portable update.');
      }

      if (fsImpl.existsSync(destinationDir)) {
        fsImpl.rmSync(destinationDir, { recursive: true, force: true });
      }
      ensureDir(destinationDir);

      await extractArchive(sourcePath, destinationDir);

      return setState({
        updateStatus: 'prepared',
        preparedDirectory: destinationDir,
        downloadedArtifactPath: sourcePath,
        lastError: ''
      });
    }
  };
}

module.exports = {
  DEFAULT_RELEASE_REPOSITORY,
  STABLE_RELEASE_CHANNEL,
  STABLE_UPDATE_MANIFEST_NAME,
  DEFAULT_MANIFEST_TIMEOUT_MS,
  UPDATE_CHECK_FAILED_CODE,
  UPDATE_CHECK_TIMEOUT_CODE,
  UPDATE_CHECK_FAILED_MESSAGE,
  UPDATE_CHECK_TIMEOUT_MESSAGE,
  compareVersions,
  createUpdateService,
  getDefaultManifestUrl,
  normalizeManifest,
  PORTABLE_IN_APP_UPDATE_DISABLED_MESSAGE,
  resolvePackagingMode
};
