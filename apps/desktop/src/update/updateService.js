const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
  normalizeExternalHttpsUrl,
  normalizeUpdateArtifactName
} = require('../shared/externalNavigation');

/** @typedef {import('../types/updateState').UpdateAsset} UpdateAsset */
/** @typedef {import('../types/updateState').UpdateAssetInput} UpdateAssetInput */
/** @typedef {import('../types/updateState').UpdateManifest} UpdateManifest */
/** @typedef {import('../types/updateState').UpdateManifestInput} UpdateManifestInput */
/** @typedef {import('../types/updateState').PersistedUpdateState} PersistedUpdateState */
/** @typedef {import('../types/updateState').DefaultUpdateStateInput} DefaultUpdateStateInput */
/** @typedef {import('../types/updateState').UpdateFs} UpdateFs */
/** @typedef {import('../types/updateState').UpdateServiceOptions} UpdateServiceOptions */

const execFileAsync = promisify(execFile);

const DEFAULT_RELEASE_REPOSITORY = 'langlink-localization/memoq-ai-hub';
const STABLE_RELEASE_CHANNEL = 'stable';
const STABLE_UPDATE_MANIFEST_NAME = 'memoq-ai-hub-updates-stable.json';
const DEFAULT_UPDATE_STATUS = 'idle';
const AVAILABLE_UPDATE_STATUSES = new Set(['available', 'downloading', 'prepared']);
const DEFAULT_MANIFEST_TIMEOUT_MS = 12_000;
const UPDATE_CHECK_FAILED_CODE = 'UPDATE_CHECK_FAILED';
const UPDATE_CHECK_TIMEOUT_CODE = 'UPDATE_CHECK_TIMEOUT';
const UPDATE_INTEGRITY_FAILED_CODE = 'UPDATE_INTEGRITY_FAILED';
const UPDATE_CHECK_FAILED_MESSAGE = 'Unable to check for updates. Please try again later.';
const UPDATE_CHECK_TIMEOUT_MESSAGE = 'Update check timed out. Please try again later.';
const UPDATE_INTEGRITY_FAILED_MESSAGE = 'Update package integrity verification failed.';
const PORTABLE_APP_EXECUTABLE_NAME = 'memoQ AI Hub.exe';
const PORTABLE_STAGING_DIRECTORY_NAME = '.memoq-ai-hub-update-staging';
const PORTABLE_BACKUP_NAME_PREFIX = '.memoq-ai-hub-backup-';
const DOWNLOAD_PROGRESS_EMIT_BYTES = 1024 * 1024;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * @param {any} dirPath
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * @param {any} version
 */
function parseVersionSegments(version) {
  return String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((segment) => Number.parseInt(segment, 10))
    .map((segment) => (Number.isFinite(segment) ? segment : 0));
}

/**
 * @param {any} leftVersion
 * @param {any} rightVersion
 */
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

/**
 * @param {DefaultUpdateStateInput} dependencies
 * @returns {PersistedUpdateState}
 */
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
    downloadProgress: { receivedBytes: 0, totalBytes: 0 },
    portableApplySupport: { supported: false, reason: '' },
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

/**
 * @param {any} value
 */
function normalizePersistedByteCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

/**
 * @param {PersistedUpdateState} defaultState
 * @param {Partial<PersistedUpdateState>=} persistedState
 * @returns {PersistedUpdateState}
 */
function normalizePersistedUpdateState(defaultState, persistedState = {}) {
  const nextState = {
    ...defaultState,
    ...(persistedState && typeof persistedState === 'object' ? persistedState : {})
  };
  nextState.releaseNotesUrl = normalizePersistedExternalUrl(nextState.releaseNotesUrl, 'Release notes URL');
  nextState.portableDownloadUrl = normalizePersistedExternalUrl(nextState.portableDownloadUrl, 'Portable download URL');
  nextState.availableAssets = {
    portable: normalizePersistedAsset(nextState.availableAssets?.portable),
    installer: normalizePersistedAsset(nextState.availableAssets?.installer)
  };
  nextState.downloadProgress = {
    receivedBytes: normalizePersistedByteCount(persistedState?.downloadProgress?.receivedBytes),
    totalBytes: normalizePersistedByteCount(persistedState?.downloadProgress?.totalBytes)
  };
  nextState.portableApplySupport = defaultState.packagingMode === 'portable'
    ? {
        supported: persistedState?.portableApplySupport?.supported === true,
        reason: String(persistedState?.portableApplySupport?.reason || '').slice(0, 200)
      }
    : { supported: false, reason: '' };

  // A persisted "restarting" state means the portable apply helper took over a
  // previous session. If the same app version is running again the apply did
  // not complete; fall back to "prepared" so the user can retry.
  if (String(nextState.updateStatus || '').trim().toLowerCase() === 'restarting') {
    nextState.updateStatus = 'prepared';
  }

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

/**
 * @param {any} timeoutMs
 */
function createUpdateCheckTimeoutError(timeoutMs) {
  return Object.assign(new Error(UPDATE_CHECK_TIMEOUT_MESSAGE), {
    code: UPDATE_CHECK_TIMEOUT_CODE,
    statusCode: 408,
    timeoutMs
  });
}

/**
 * @param {any} error
 */
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

/**
 * @param {any} message
 */
function createUpdateIntegrityError(message) {
  return Object.assign(new Error(String(message || UPDATE_INTEGRITY_FAILED_MESSAGE)), {
    code: UPDATE_INTEGRITY_FAILED_CODE
  });
}

/**
 * @param {any} value
 * @param {any} dependencies2
 */
function normalizeAssetSha256(value, { allowEmpty = true } = {}) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized && allowEmpty) {
    return '';
  }
  if (!SHA256_HEX_PATTERN.test(normalized)) {
    throw createUpdateIntegrityError('Update asset SHA-256 must be a 64-character hexadecimal digest.');
  }
  return normalized;
}

/**
 * @param {any} buffer
 */
function calculateBufferSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * @param {any} actualSha256
 * @param {any} expectedSha256
 * @param {any} [message]
 */
function verifyHexSha256(actualSha256, expectedSha256, message) {
  const expected = normalizeAssetSha256(expectedSha256, { allowEmpty: false });
  const actual = normalizeAssetSha256(actualSha256, { allowEmpty: false });
  const matches = crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  if (!matches) {
    throw createUpdateIntegrityError(message || 'Downloaded update package does not match the manifest SHA-256.');
  }
  return actual;
}

/**
 * @param {any} buffer
 * @param {any} expectedSha256
 */
function verifyBufferSha256(buffer, expectedSha256) {
  return verifyHexSha256(calculateBufferSha256(buffer), expectedSha256);
}

/**
 * Streams a file through SHA-256 so large installers never load fully into
 * memory; falls back to a buffered read for injectable test file systems.
 */
async function calculateFileSha256(/** @type {UpdateFs} */ fsImpl, /** @type {string} */ filePath) {
  if (typeof fsImpl.createReadStream !== 'function') {
    return calculateBufferSha256(fsImpl.readFileSync(filePath));
  }
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsImpl.createReadStream(filePath);
    stream.on('data', (/** @type {any} */ chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * @param {UpdateAssetInput | null=} asset
 * @returns {UpdateAsset | null}
 */
function normalizeAsset(asset = {}) {
  if (!asset || typeof asset !== 'object') {
    return null;
  }

  const rawName = String(asset.name || '').trim();
  const rawUrl = String(asset.url || '').trim();
  if (!rawName || !rawUrl) {
    return null;
  }

  const name = normalizeUpdateArtifactName(rawName);
  const url = normalizeExternalHttpsUrl(rawUrl, { label: 'Update asset URL' });

  return {
    name,
    url,
    sha256: normalizeAssetSha256(asset.sha256),
    contentType: String(asset.contentType || '').trim(),
    size: Number.isFinite(Number(asset.size)) ? Number(asset.size) : null
  };
}

/**
 * @param {any} value
 * @param {any} label
 */
function normalizePersistedExternalUrl(value, label) {
  try {
    return normalizeExternalHttpsUrl(value, { label, allowEmpty: true });
  } catch {
    return '';
  }
}

/**
 * @param {UpdateAssetInput | null | undefined} asset
 * @returns {UpdateAsset | null}
 */
function normalizePersistedAsset(asset) {
  try {
    return normalizeAsset(asset);
  } catch {
    return null;
  }
}

/**
 * @param {UpdateManifestInput=} manifest
 * @returns {UpdateManifest}
 */
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
    releaseNotesUrl: normalizeExternalHttpsUrl(manifest.releaseNotesUrl, {
      label: 'Release notes URL',
      allowEmpty: true
    }),
    assets: {
      portable: normalizeAsset(manifest.assets?.portable),
      installer: normalizeAsset(manifest.assets?.installer)
    }
  };
}

/**
 * @param {{ packagingMode?: string, fsImpl?: UpdateFs, execPath?: string }=} dependencies
 */
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

/**
 * @param {string} sourcePath
 * @param {string} targetDir
 * @returns {Promise<void>}
 */
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

/**
 * Resolves whether the packaged portable app can stage and swap its own
 * folder. The parent of the app directory must be writable (rename + move
 * target) and the app directory must look like a packaged build.
 */
/**
 * @param {{ fsImpl?: UpdateFs, execPath?: string }=} dependencies
 */
function resolvePortableApplySupport({ fsImpl = fs, execPath = process.execPath } = {}) {
  const normalizedExecPath = String(execPath || '').trim();
  if (!normalizedExecPath) {
    return { supported: false, reason: 'App executable path is unavailable.', appDirectory: '' };
  }

  const appDirectory = path.dirname(normalizedExecPath);
  if (!fsImpl.existsSync(path.join(appDirectory, 'resources', 'app.asar'))) {
    return { supported: false, reason: 'The running executable is not a packaged portable build.', appDirectory };
  }

  const parentDirectory = path.dirname(appDirectory);
  const markerPath = path.join(parentDirectory, `.memoq-ai-hub-write-probe-${process.pid}`);
  try {
    fsImpl.writeFileSync(markerPath, 'probe');
    fsImpl.rmSync(markerPath, { force: true });
  } catch {
    return { supported: false, reason: 'The app folder location is not writable. Use the download page to update manually.', appDirectory };
  }

  return { supported: true, reason: '', appDirectory };
}

/**
 * Prefers a staging directory beside the app (same volume => instant rename
 * during apply); falls back to the managed prepared-updates directory when
 * that location is not writable.
 * @param {any} dependencies
 */
function resolvePortableStagingDirectory({ applySupport, preparedUpdatesDir, fsImpl = fs }) {
  if (applySupport?.supported && applySupport.appDirectory) {
    const siblingStaging = path.join(path.dirname(applySupport.appDirectory), PORTABLE_STAGING_DIRECTORY_NAME);
    try {
      if (fsImpl.existsSync(siblingStaging)) {
        fsImpl.rmSync(siblingStaging, { recursive: true, force: true });
      }
      return siblingStaging;
    } catch {
      // Fall through to the managed prepared directory.
    }
  }
  return path.join(preparedUpdatesDir, PORTABLE_STAGING_DIRECTORY_NAME);
}

/**
 * Published portable archives contain the app files at the archive root, but
 * stay defensive: if extraction produced a single folder and no root payload,
 * treat that folder as the app root.
 */
function normalizePreparedAppRoot(/** @type {UpdateFs} */ fsImpl, /** @type {string} */ destinationDir) {
  if (fsImpl.existsSync(path.join(destinationDir, PORTABLE_APP_EXECUTABLE_NAME))) {
    return destinationDir;
  }
  const entries = fsImpl.readdirSync(destinationDir);
  const directories = entries.filter((/** @type {any} */ entry) => fsImpl.statSync(path.join(destinationDir, entry)).isDirectory());
  if (directories.length === 1
    && fsImpl.existsSync(path.join(destinationDir, directories[0], PORTABLE_APP_EXECUTABLE_NAME))) {
    return path.join(destinationDir, directories[0]);
  }
  return '';
}

/**
 * @param {any} repository
 */
function getDefaultManifestUrl(repository = DEFAULT_RELEASE_REPOSITORY) {
  return `https://github.com/${repository}/releases/latest/download/${STABLE_UPDATE_MANIFEST_NAME}`;
}

/**
 * @param {UpdateServiceOptions=} options
 */
function createUpdateService(options = {}) {
  const fsImpl = options.fs || fs;
  const fetchImpl = options.fetch || globalThis.fetch;
  const logger = options.logger || createNoopLogger();
  const manifestTimeoutMs = Number.isFinite(Number(options.manifestTimeoutMs))
    ? Math.max(1, Number(options.manifestTimeoutMs))
    : DEFAULT_MANIFEST_TIMEOUT_MS;
  const nowIso = typeof options.nowIso === 'function' ? options.nowIso : () => new Date().toISOString();
  const repository = String(options.releaseRepository || DEFAULT_RELEASE_REPOSITORY).trim() || DEFAULT_RELEASE_REPOSITORY;
  const manifestUrl = normalizeExternalHttpsUrl(
    options.manifestUrl || getDefaultManifestUrl(repository),
    { label: 'Update manifest URL' }
  );
  const currentVersion = String(options.currentVersion || '').trim();
  // Captured because checkForUpdates(options) shadows the creation options.
  const creationExecPath = options.execPath;
  const packagingMode = resolvePackagingMode({
    packagingMode: options.packagingMode,
    fsImpl,
    execPath: creationExecPath
  });
  const extractArchive = options.extractArchive || expandArchiveWithPowerShell;
  const appPaths = options.paths || {};
  const updatesDir = appPaths.updatesDir || path.join(process.cwd(), 'updates');
  const updateDownloadsDir = appPaths.updateDownloadsDir || path.join(updatesDir, 'downloads');
  const preparedUpdatesDir = appPaths.preparedUpdatesDir || path.join(updatesDir, 'prepared');

  ensureDir(updatesDir);
  ensureDir(updateDownloadsDir);
  ensureDir(preparedUpdatesDir);

  const persistedStatePath = String(
    options.updateStatePath
    || appPaths.updateStatePath
    || path.join(updatesDir, 'update-state.json')
  );

  function readPersistedState() {
    try {
      const raw = fsImpl.readFileSync(persistedStatePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      // Missing or corrupt persisted state restarts the update center from defaults.
      return {};
    }
  }

  /**
   * @param {PersistedUpdateState} nextState
   */
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

  /**
   * @param {PersistedUpdateState} nextState
   */
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

  /**
   * @param {any} patch
   */
  function setState(/** @type {Partial<PersistedUpdateState>} */ patch = {}) {
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
    /** @type {RequestInit} */
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
    if (response.url) {
      normalizeExternalHttpsUrl(response.url, { label: 'Final update manifest URL' });
    }

    return normalizeManifest(await response.json());
  }

  /**
   * @param {any} kind
   */
  function getRequestedAsset(kind) {
    const asset = kind === 'installer'
      ? state.availableAssets?.installer
      : state.availableAssets?.portable;
    if (!asset?.url || !asset?.name) {
      throw new Error(`No ${kind} update is currently available.`);
    }
    return asset;
  }

  /**
   * @param {any} error
   * @param {any} artifactPaths
   */
  function markIntegrityFailure(error, artifactPaths = []) {
    const normalizedError = error?.code === UPDATE_INTEGRITY_FAILED_CODE
      ? error
      : createUpdateIntegrityError(error?.message || error);
    const pathsToClean = Array.isArray(artifactPaths) ? artifactPaths : [artifactPaths];
    for (const artifactPath of pathsToClean) {
      const normalizedArtifactPath = String(artifactPath || '').trim();
      const resolvedArtifactPath = normalizedArtifactPath ? path.resolve(normalizedArtifactPath) : '';
      const artifactIsManaged = resolvedArtifactPath
        && path.dirname(resolvedArtifactPath) === path.resolve(updateDownloadsDir);
      if (artifactIsManaged && fsImpl.existsSync(resolvedArtifactPath)) {
        try {
          fsImpl.rmSync(resolvedArtifactPath, { force: true });
        } catch (/** @type {any} */ removeError) {
          logger.warn('update-integrity-cleanup-failed', 'Unable to remove an untrusted update package.', {
            artifactPath: resolvedArtifactPath,
            errorMessage: String(removeError?.message || removeError)
          });
        }
      }
    }
    setState({
      updateStatus: 'error',
      lastError: UPDATE_INTEGRITY_FAILED_MESSAGE,
      lastErrorCode: UPDATE_INTEGRITY_FAILED_CODE,
      downloadedArtifactPath: ''
    });
    return normalizedError;
  }

  /**
   * @param {any} asset
   */
  function getRequiredAssetSha256(asset) {
    if (!asset?.sha256) {
      throw createUpdateIntegrityError('Update asset SHA-256 is required for application-managed downloads.');
    }
    return normalizeAssetSha256(asset.sha256, { allowEmpty: false });
  }

  /**
   * @param {any} kind
   */
  async function downloadAsset(kind) {
    const asset = getRequestedAsset(kind);
    const destinationPath = path.join(updateDownloadsDir, asset.name);
    const partialPath = `${destinationPath}.part`;
    let expectedSha256;

    try {
      expectedSha256 = getRequiredAssetSha256(asset);
    } catch (error) {
      throw markIntegrityFailure(error);
    }

    setState({
      updateStatus: 'downloading',
      downloadProgress: { receivedBytes: 0, totalBytes: 0 },
      lastError: '',
      lastErrorCode: ''
    });

    const response = await fetchImpl(asset.url);
    if (!response || response.ok !== true) {
      throw new Error(`Update download failed with status ${response?.status || 'unknown'}.`);
    }
    if (response.url) {
      normalizeExternalHttpsUrl(response.url, { label: 'Final update download URL' });
    }

    const declaredTotalBytes = normalizePersistedByteCount(
      typeof response.headers?.get === 'function' ? response.headers.get('content-length') : ''
    );
    const hash = crypto.createHash('sha256');
    const writeStream = fsImpl.createWriteStream(partialPath);
    let receivedBytes = 0;
    let lastEmittedBytes = 0;

    const finishWrite = () => new Promise((/** @type {(value?: void) => void} */ resolve, /** @type {(reason?: any) => void} */ reject) => {
      writeStream.end((/** @type {any} */ writeError) => {
        if (writeError) {
          reject(writeError);
        } else {
          resolve();
        }
      });
    });

    const removePartial = () => {
      try {
        if (fsImpl.existsSync(partialPath)) {
          fsImpl.rmSync(partialPath, { force: true });
        }
      } catch {
        // Best-effort cleanup; a stale .part file is overwritten on retry.
      }
    };

    try {
      const body = response.body;
      if (body && typeof body[Symbol.asyncIterator] === 'function') {
        for await (const chunk of body) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          hash.update(buffer);
          if (!writeStream.write(buffer)) {
            await new Promise((resolve) => writeStream.once('drain', resolve));
          }
          receivedBytes += buffer.length;
          if (receivedBytes - lastEmittedBytes >= DOWNLOAD_PROGRESS_EMIT_BYTES) {
            lastEmittedBytes = receivedBytes;
            setState({ downloadProgress: { receivedBytes, totalBytes: declaredTotalBytes } });
          }
        }
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        hash.update(buffer);
        writeStream.write(buffer);
        receivedBytes = buffer.length;
      }
      await finishWrite();
    } catch (error) {
      removePartial();
      throw error;
    }

    try {
      verifyHexSha256(hash.digest('hex'), expectedSha256);
    } catch (error) {
      removePartial();
      throw markIntegrityFailure(error, [destinationPath, partialPath]);
    }

    try {
      if (fsImpl.existsSync(destinationPath)) {
        fsImpl.rmSync(destinationPath, { force: true });
      }
      fsImpl.renameSync(partialPath, destinationPath);
    } catch (error) {
      removePartial();
      throw error;
    }

    return setState({
      updateStatus: 'available',
      downloadedArtifactPath: destinationPath,
      downloadProgress: { receivedBytes, totalBytes: receivedBytes },
      lastError: '',
      lastErrorCode: ''
    });
  }

  function isSquirrelFirstRun() {
    return Array.isArray(options.argv || process.argv)
      && (options.argv || process.argv).some((/** @type {any} */ value) => String(value || '').trim().toLowerCase() === '--squirrel-firstrun');
  }

  return {
    getStatus,
    async checkForUpdates(/** @type {{ manual?: boolean }} */ options = {}) {
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
        let portableApplySupport = state.portableApplySupport;
        if (packagingMode === 'portable') {
          portableApplySupport = resolvePortableApplySupport({ fsImpl, execPath: creationExecPath });
        }
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
          portableApplySupport,
          lastCheckedAt: nowIso(),
          lastError: '',
          lastErrorCode: '',
          downloadedArtifactPath: hasUpdate ? state.downloadedArtifactPath : '',
          preparedDirectory: hasUpdate ? state.preparedDirectory : '',
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
      return downloadAsset('portable');
    },
    async downloadInstallerUpdate() {
      if (packagingMode !== 'installed') {
        throw new Error('Installer update download is only available in installed mode.');
      }
      return downloadAsset('installer');
    },
    async verifyDownloadedInstallerUpdate(/** @type {any} */ installerPath) {
      if (packagingMode !== 'installed') {
        throw new Error('Installer update verification is only available in installed mode.');
      }

      const asset = state.availableAssets?.installer;
      const persistedPath = String(state.downloadedArtifactPath || '').trim();
      const requestedPath = String(installerPath || persistedPath).trim();

      try {
        const expectedSha256 = getRequiredAssetSha256(asset);
        if (!asset?.name || !persistedPath || !requestedPath) {
          throw createUpdateIntegrityError('A verified downloaded installer is required before launch.');
        }

        const expectedPath = path.resolve(updateDownloadsDir, asset.name);
        const resolvedPersistedPath = path.resolve(persistedPath);
        const resolvedRequestedPath = path.resolve(requestedPath);
        if (resolvedPersistedPath !== expectedPath || resolvedRequestedPath !== expectedPath) {
          throw createUpdateIntegrityError('Downloaded installer path does not match the current update asset.');
        }
        if (!fsImpl.existsSync(expectedPath)) {
          throw createUpdateIntegrityError(`Downloaded installer not found: ${expectedPath}`);
        }

        const actualSha256 = verifyHexSha256(
          await calculateFileSha256(fsImpl, expectedPath),
          expectedSha256,
          'Downloaded update package does not match the manifest SHA-256.'
        );
        return {
          ok: true,
          installerPath: expectedPath,
          sha256: actualSha256
        };
      } catch (error) {
        throw markIntegrityFailure(error, [persistedPath]);
      }
    },
    async preparePortableUpdate(/** @type {any} */ downloadedFile, /** @type {any} */ targetDir) {
      const sourcePath = String(downloadedFile || state.downloadedArtifactPath || '').trim();
      if (!sourcePath) {
        throw new Error('A downloaded portable archive is required before preparing an update.');
      }
      if (!fsImpl.existsSync(sourcePath)) {
        throw new Error(`Downloaded update archive not found: ${sourcePath}`);
      }

      // Fail closed: re-verify the persisted archive against the manifest
      // digest before extraction so a swapped file cannot be expanded.
      const portableAsset = state.availableAssets?.portable;
      if (!portableAsset) {
        throw createUpdateIntegrityError('Prepared archive is missing its manifest asset.');
      }
      try {
        const expectedSha256 = getRequiredAssetSha256(portableAsset);
        const expectedPath = path.resolve(updateDownloadsDir, portableAsset.name);
        if (path.resolve(sourcePath) !== expectedPath) {
          throw createUpdateIntegrityError('Prepared archive path does not match the current update asset.');
        }
        verifyHexSha256(
          await calculateFileSha256(fsImpl, sourcePath),
          expectedSha256,
          'Downloaded update package does not match the manifest SHA-256.'
        );
      } catch (error) {
        throw markIntegrityFailure(error, [sourcePath]);
      }

      const stagingDir = String(targetDir || '').trim()
        || resolvePortableStagingDirectory({
          applySupport: packagingMode === 'portable'
            ? resolvePortableApplySupport({ fsImpl, execPath: creationExecPath })
            : { supported: false, appDirectory: '' },
          preparedUpdatesDir,
          fsImpl
        });
      if (!stagingDir) {
        throw new Error('A target directory is required to prepare the portable update.');
      }

      if (fsImpl.existsSync(stagingDir)) {
        fsImpl.rmSync(stagingDir, { recursive: true, force: true });
      }
      ensureDir(stagingDir);

      await extractArchive(sourcePath, stagingDir);

      const preparedAppRoot = normalizePreparedAppRoot(fsImpl, stagingDir);
      if (!preparedAppRoot) {
        try {
          fsImpl.rmSync(stagingDir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup of an unusable staging directory.
        }
        throw createUpdateIntegrityError(`Prepared update does not contain ${PORTABLE_APP_EXECUTABLE_NAME}.`);
      }

      return setState({
        updateStatus: 'prepared',
        preparedDirectory: preparedAppRoot,
        downloadedArtifactPath: sourcePath,
        lastError: '',
        lastErrorCode: ''
      });
    },
    markPortableUpdateRestarting() {
      if (packagingMode !== 'portable') {
        throw new Error('Portable update restart marking is only available in portable mode.');
      }
      if (String(state.updateStatus || '').trim().toLowerCase() !== 'prepared') {
        throw new Error('A prepared portable update is required before restarting to update.');
      }
      return setState({ updateStatus: 'restarting' });
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
  UPDATE_INTEGRITY_FAILED_CODE,
  UPDATE_CHECK_FAILED_MESSAGE,
  UPDATE_CHECK_TIMEOUT_MESSAGE,
  UPDATE_INTEGRITY_FAILED_MESSAGE,
  PORTABLE_APP_EXECUTABLE_NAME,
  PORTABLE_STAGING_DIRECTORY_NAME,
  PORTABLE_BACKUP_NAME_PREFIX,
  compareVersions,
  createUpdateService,
  getDefaultManifestUrl,
  normalizeManifest,
  resolvePackagingMode,
  resolvePortableApplySupport
};
