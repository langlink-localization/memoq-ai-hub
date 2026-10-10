export interface UpdateAsset {
  name: string;
  url: string;
  sha256: string;
  contentType: string;
  size: number | null;
}

export interface UpdateAssetInput {
  name?: string;
  url?: string;
  sha256?: string;
  contentType?: string;
  size?: number | null;
  [key: string]: any;
}

export interface UpdateManifest {
  version: string;
  tag: string;
  channel: string;
  publishedAt: string;
  releaseNotes: string;
  releaseNotesUrl: string;
  assets: {
    portable: UpdateAsset | null;
    installer: UpdateAsset | null;
  };
}

export interface UpdateManifestInput {
  version?: string;
  latestVersion?: string;
  tag?: string;
  channel?: string;
  publishedAt?: string;
  releaseNotes?: string;
  releaseNotesUrl?: string;
  assets?: {
    portable?: UpdateAssetInput | null;
    installer?: UpdateAssetInput | null;
    portableCompact?: UpdateAssetInput | null;
  };
  [key: string]: any;
}

export interface UpdateDownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

export interface PortableApplySupport {
  supported: boolean;
  reason: string;
  appDirectory?: string;
}

export interface PersistedUpdateState {
  currentVersion: string;
  releaseChannel: string;
  packagingMode: string;
  updateStatus: string;
  latestVersion: string;
  publishedAt: string;
  releaseNotes: string;
  releaseNotesUrl: string;
  portableDownloadUrl: string;
  downloadedArtifactPath: string;
  preparedDirectory: string;
  downloadProgress: UpdateDownloadProgress;
  portableApplySupport: PortableApplySupport;
  lastCheckedAt: string;
  lastError: string;
  lastErrorCode: string;
  manualCheckRequestedAt: string;
  manifestUrl: string;
  pluginReinstallRecommended: boolean;
  availableAssets: {
    portable: UpdateAsset | null;
    installer: UpdateAsset | null;
  };
}

export interface DefaultUpdateStateInput {
  currentVersion?: string;
  packagingMode?: string;
  manifestUrl?: string;
}

export type UpdateFs = typeof import('fs');

export type UpdateFetch = typeof globalThis.fetch;

export interface UpdateLogger {
  info(event: string, message?: string, details?: any): unknown;
  warn(event: string, message?: string, details?: any): unknown;
  error(event: string, message?: string, details?: any): unknown;
}

export interface UpdatePaths {
  updatesDir?: string;
  updateDownloadsDir?: string;
  preparedUpdatesDir?: string;
  updateStatePath?: string;
  [key: string]: any;
}

export type UpdateArchiveExtract = (sourcePath: string, targetDir: string) => Promise<unknown>;

export interface UpdateServiceOptions {
  fs?: UpdateFs;
  fetch?: UpdateFetch;
  networkMode?: string;
  downloadIdleTimeoutMs?: number;
  downloadTimeoutMs?: number;
  logger?: UpdateLogger;
  manifestTimeoutMs?: number;
  nowIso?: () => string;
  releaseRepository?: string;
  manifestUrl?: string;
  currentVersion?: string;
  execPath?: string;
  packagingMode?: string;
  extractArchive?: UpdateArchiveExtract;
  paths?: UpdatePaths;
  updateStatePath?: string;
  argv?: string[];
}
