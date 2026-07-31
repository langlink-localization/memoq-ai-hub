const DEFAULT_MEMOQ_VERSIONS = ['10', '11', '12'];

export function getRuntimeConnectionColor(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'connected') return 'green';
  if (normalized === 'starting' || normalized === 'connecting') return 'gold';
  if (normalized === 'error') return 'red';
  return 'default';
}

export function getRuntimeConnectionLabel(status, t) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'connected') return t('dashboard.connectionConnected');
  if (normalized === 'starting' || normalized === 'connecting') return t('dashboard.connectionStarting');
  if (normalized === 'error') return t('dashboard.connectionError');
  if (normalized === 'idle' || normalized === 'missing' || normalized === 'disconnected') {
    return t('dashboard.connectionDisconnected');
  }
  return t('dashboard.connectionUnknown');
}

export function getUpdateStatusLabel(status, t) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'checking') return t('dashboard.updateStatusChecking');
  if (normalized === 'available') return t('dashboard.updateStatusAvailable');
  if (normalized === 'downloading') return t('dashboard.updateStatusDownloading');
  if (normalized === 'prepared') return t('dashboard.updateStatusPrepared');
  if (normalized === 'up-to-date') return t('dashboard.updateStatusUpToDate');
  if (normalized === 'error') return t('dashboard.updateStatusError');
  return t('dashboard.updateStatusIdle');
}

function compareDisplayVersions(leftVersion, rightVersion) {
  const left = String(leftVersion || '').trim().replace(/^v/i, '').split('.').map((segment) => Number.parseInt(segment, 10) || 0);
  const right = String(rightVersion || '').trim().replace(/^v/i, '').split('.').map((segment) => Number.parseInt(segment, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] || 0;
    const rightValue = right[index] || 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

export function getSafeUpdateStatus(updateCenter = {}) {
  const status = String(updateCenter.updateStatus || '').trim().toLowerCase();
  if (
    ['available', 'downloading', 'prepared'].includes(status)
    && compareDisplayVersions(updateCenter.latestVersion, updateCenter.currentVersion) <= 0
  ) {
    return 'up-to-date';
  }
  return status || 'idle';
}

export function getUpdateErrorDisplay(updateCenter = {}, t) {
  const errorCode = String(updateCenter.lastErrorCode || '').trim();
  if (errorCode === 'UPDATE_CHECK_TIMEOUT') return t('dashboard.updateCheckTimeoutError');
  if (errorCode === 'UPDATE_CHECK_FAILED') return t('dashboard.updateCheckFailedError');
  return String(updateCenter.lastError || '').trim();
}

export function getPackagingModeLabel(mode, t) {
  return String(mode || '').trim().toLowerCase() === 'installed'
    ? t('dashboard.packagingInstalled')
    : t('dashboard.packagingPortable');
}

export function getPresetInstallDir(version) {
  return `C:\\Program Files\\memoQ\\memoQ-${version}`;
}

function normalizeInstallOption(option = {}) {
  const versionCandidate = String(option.memoqVersion || option.version || '').trim();
  const versionMatch = versionCandidate.match(/\d+/)?.[0] || '';
  const selectedInstallDir = String(option.selectedInstallDir || option.installDir || option.rootDir || option.path || '').trim();
  const version = DEFAULT_MEMOQ_VERSIONS.includes(versionCandidate)
    ? versionCandidate
    : (DEFAULT_MEMOQ_VERSIONS.includes(versionMatch) ? versionMatch : versionCandidate);

  return {
    version,
    selectedInstallDir: selectedInstallDir || (version ? getPresetInstallDir(version) : ''),
    label: option.label || (version ? `memoQ ${version}` : selectedInstallDir || '')
  };
}

export function buildInstallOptions(integration = {}) {
  const remoteOptions = Array.isArray(integration.defaultInstallOptions)
    ? integration.defaultInstallOptions.map(normalizeInstallOption).filter((option) => option.version || option.selectedInstallDir)
    : [];

  if (remoteOptions.length) return remoteOptions;

  return DEFAULT_MEMOQ_VERSIONS.map((version) => ({
    version,
    selectedInstallDir: getPresetInstallDir(version),
    label: `memoQ ${version}`
  }));
}

export function buildInstallDraft(integration = {}) {
  const installOptions = buildInstallOptions(integration);
  const selectedInstallDir = String(integration.selectedInstallDir || '').trim();
  const customInstallDir = String(integration.customInstallDir || '').trim();
  const versionCandidate = String(integration.memoqVersion || '').trim();
  const matchedOption = installOptions.find((option) => option.selectedInstallDir === selectedInstallDir || option.version === versionCandidate);
  const version = matchedOption?.version || (DEFAULT_MEMOQ_VERSIONS.includes(versionCandidate) ? versionCandidate : '11');
  const presetInstallDir = getPresetInstallDir(version);
  const isCustom = Boolean(customInstallDir) || (selectedInstallDir && selectedInstallDir !== presetInstallDir);
  const finalSelectedInstallDir = isCustom ? (selectedInstallDir || customInstallDir || '') : presetInstallDir;

  return {
    mode: isCustom ? 'custom' : 'preset',
    memoqVersion: version,
    selectedInstallDir: finalSelectedInstallDir,
    customInstallDir: isCustom ? (customInstallDir || selectedInstallDir || finalSelectedInstallDir) : ''
  };
}
