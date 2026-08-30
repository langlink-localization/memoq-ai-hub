// Single source for placeholder app-state slices consumed by both processes:
// the main-process startup placeholder (before the worker reports ready) and
// the renderer fallback (when an app-state payload is missing or partial).
// Keep these shapes aligned with runtime state builders — the renderer
// normalizes whatever arrives on top of them.

function createPreviewStatusPlaceholder(overrides = {}) {
  return {
    status: 'disconnected',
    statusMessage: '',
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
    sourceDocumentGuid: '',
    ...overrides
  };
}

function createUpdateCenterPlaceholder(currentVersion = '') {
  return {
    currentVersion,
    releaseChannel: 'stable',
    packagingMode: 'portable',
    updateStatus: 'idle',
    latestVersion: '',
    releaseNotes: '',
    releaseNotesUrl: '',
    portableDownloadUrl: '',
    publishedAt: '',
    downloadedArtifactPath: '',
    preparedDirectory: '',
    lastCheckedAt: '',
    lastError: '',
    lastErrorCode: '',
    manifestUrl: '',
    pluginReinstallRecommended: true,
    availableAssets: {
      portable: null,
      installer: null
    }
  };
}

module.exports = {
  createPreviewStatusPlaceholder,
  createUpdateCenterPlaceholder
};
