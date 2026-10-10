const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  compareVersions,
  createUpdateService,
  normalizeManifest,
  PORTABLE_APP_EXECUTABLE_NAME,
  PORTABLE_STAGING_DIRECTORY_NAME,
  UPDATE_CHECK_FAILED_CODE,
  UPDATE_CHECK_TIMEOUT_CODE,
  UPDATE_CHECK_TIMEOUT_MESSAGE,
  UPDATE_INTEGRITY_FAILED_CODE,
  UPDATE_INTEGRITY_FAILED_MESSAGE,
  resolvePackagingMode
} = require('../src/update/updateService');
const { createAppPaths } = require('../src/shared/paths');

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-ai-hub-update-'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createMockFetch(responses = new Map(), calls = []) {
  return async function fetch(url, options = {}) {
    const key = String(url || '');
    calls.push({ url: key, options });
    if (!responses.has(key)) {
      return {
        ok: false,
        status: 404,
        async json() {
          return {};
        },
        async arrayBuffer() {
          return new ArrayBuffer(0);
        }
      };
    }

    const response = responses.get(key);
    if (Number(response.delayMs || 0) > 0) {
      await new Promise((resolve) => setTimeout(resolve, Number(response.delayMs)));
    }
    return {
      ok: response.ok !== false,
      status: response.status || 200,
      url: response.url || key,
      async json() {
        return response.json || {};
      },
      async arrayBuffer() {
        return Buffer.from(response.buffer || '');
      }
    };
  };
}

function createMockLogger() {
  const entries = [];
  return {
    entries,
    info(event, message, data) {
      entries.push({ level: 'info', event, message, data });
    },
    warn(event, message, data) {
      entries.push({ level: 'warn', event, message, data });
    },
    error(event, message, data) {
      entries.push({ level: 'error', event, message, data });
    }
  };
}

test('update service compares semantic versions numerically', () => {
  assert.equal(compareVersions('1.0.10', '1.0.2'), 1);
  assert.equal(compareVersions('1.0.2', '1.0.10'), -1);
  assert.equal(compareVersions('1.0.3', '1.0.3'), 0);
});

test('update service rejects unsafe manifest navigation and artifact fields', () => {
  assert.throws(() => createUpdateService({
    manifestUrl: 'http://example.com/latest.json'
  }), /Update manifest URL must use HTTPS/);

  assert.throws(() => normalizeManifest({
    version: '1.0.1',
    releaseNotesUrl: 'file:///C:/Windows/System32/calc.exe'
  }), /Release notes URL must use HTTPS/);

  assert.throws(() => normalizeManifest({
    version: '1.0.1',
    assets: {
      installer: {
        name: '../memoQ-AI-Hub-Setup.exe',
        url: 'https://example.com/memoQ-AI-Hub-Setup.exe'
      }
    }
  }), /plain file name/);

  assert.throws(() => normalizeManifest({
    version: '1.0.1',
    assets: {
      installer: {
        name: 'memoQ-AI-Hub-Setup.exe',
        url: 'http://example.com/memoQ-AI-Hub-Setup.exe'
      }
    }
  }), /Update asset URL must use HTTPS/);

  assert.throws(() => normalizeManifest({
    version: '1.0.1',
    assets: {
      installer: {
        name: 'memoQ-AI-Hub-Setup.exe',
        url: 'https://example.com/memoQ-AI-Hub-Setup.exe',
        sha256: 'not-a-digest'
      }
    }
  }), /Update asset SHA-256 must be a 64-character hexadecimal digest/);
});

test('update service rejects an HTTPS manifest request redirected to an unsafe final URL', async () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    const service = createUpdateService({
      paths,
      currentVersion: '1.0.0',
      manifestUrl,
      packagingMode: 'portable',
      fetch: createMockFetch(new Map([
        [manifestUrl, {
          url: 'http://example.com/latest.json',
          json: { version: '1.0.1' }
        }]
      ]))
    });

    const status = await service.checkForUpdates({ manual: true });

    assert.equal(status.updateStatus, 'error');
    assert.equal(status.lastErrorCode, UPDATE_CHECK_FAILED_CODE);
    assert.equal(status.availableAssets.portable, null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service clears unsafe URLs from persisted state', () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    fs.writeFileSync(paths.updateStatePath, JSON.stringify({
      currentVersion: '1.0.0',
      packagingMode: 'portable',
      manifestUrl,
      updateStatus: 'available',
      latestVersion: '1.0.1',
      releaseNotesUrl: 'file:///C:/Windows/System32/calc.exe',
      portableDownloadUrl: 'http://example.com/release',
      availableAssets: {
        portable: {
          name: '../memoq-ai-hub-win32-x64.zip',
          url: 'https://example.com/memoq-ai-hub-win32-x64.zip'
        }
      }
    }), 'utf8');

    const service = createUpdateService({
      paths,
      currentVersion: '1.0.0',
      manifestUrl,
      packagingMode: 'portable',
      fetch: createMockFetch()
    });
    const status = service.getStatus();

    assert.equal(status.releaseNotesUrl, '');
    assert.equal(status.portableDownloadUrl, '');
    assert.equal(status.availableAssets.portable, null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service preserves valid persisted digests and drops malformed persisted assets', () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    const installerPath = path.join(paths.updateDownloadsDir, 'memoQ-AI-Hub-Setup.exe');
    const installerSha256 = sha256('installer binary');
    const persistedState = {
      currentVersion: '1.0.0',
      packagingMode: 'installed',
      manifestUrl,
      updateStatus: 'available',
      latestVersion: '1.0.2',
      downloadedArtifactPath: installerPath,
      availableAssets: {
        installer: {
          name: 'memoQ-AI-Hub-Setup.exe',
          url: 'https://example.com/memoQ-AI-Hub-Setup.exe',
          sha256: installerSha256
        }
      }
    };
    fs.writeFileSync(paths.updateStatePath, JSON.stringify(persistedState), 'utf8');

    const restored = createUpdateService({
      paths,
      currentVersion: '1.0.0',
      manifestUrl,
      packagingMode: 'installed',
      fetch: createMockFetch()
    }).getStatus();
    assert.equal(restored.availableAssets.installer.sha256, installerSha256);

    fs.writeFileSync(paths.updateStatePath, JSON.stringify({
      ...persistedState,
      availableAssets: {
        installer: {
          ...persistedState.availableAssets.installer,
          sha256: 'malformed'
        }
      }
    }), 'utf8');

    const sanitized = createUpdateService({
      paths,
      currentVersion: '1.0.0',
      manifestUrl,
      packagingMode: 'installed',
      fetch: createMockFetch()
    }).getStatus();
    assert.equal(sanitized.availableAssets.installer, null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service resolves installed packaging when Update.exe is present', () => {
  const tempRoot = createTempRoot();
  try {
    const appDir = path.join(tempRoot, 'app-1.0.0');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'Update.exe'), '');
    const execPath = path.join(appDir, 'memoQ AI Hub.exe');

    assert.equal(resolvePackagingMode({ execPath }), 'installed');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service downloads, prepares, and stages an in-app portable update', async () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    const portableUrl = 'https://example.com/memoq-ai-hub-win32-x64.zip';
    const portableBytes = Buffer.from('portable zip payload');
    const appDir = path.join(tempRoot, 'apps', 'memoQ AI Hub-win32-x64');
    fs.mkdirSync(path.join(appDir, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(appDir, 'resources', 'app.asar'), 'asar');
    const execPath = path.join(appDir, PORTABLE_APP_EXECUTABLE_NAME);
    fs.writeFileSync(execPath, 'exe');
    const extractArchiveCalls = [];
    const service = createUpdateService({
      paths,
      currentVersion: '1.0.0',
      manifestUrl,
      packagingMode: 'portable',
      execPath,
      extractArchive: async (sourcePath, targetDir) => {
        extractArchiveCalls.push({ sourcePath, targetDir });
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, PORTABLE_APP_EXECUTABLE_NAME), 'exe');
        fs.mkdirSync(path.join(targetDir, 'resources'), { recursive: true });
      },
      fetch: createMockFetch(new Map([
        [manifestUrl, {
          json: {
            version: '1.0.1',
            tag: 'v1.0.1',
            publishedAt: '2026-03-26T00:00:00.000Z',
            releaseNotesUrl: 'https://example.com/release',
            assets: {
              portable: {
                name: 'memoq-ai-hub-win32-x64.zip',
                url: portableUrl,
                sha256: sha256(portableBytes)
              }
            }
          }
        }],
        [portableUrl, { buffer: portableBytes }]
      ]))
    });

    const available = await service.checkForUpdates({ manual: true });
    assert.equal(available.updateStatus, 'available');
    assert.equal(available.portableApplySupport.supported, true);
    assert.equal(available.portableApplySupport.appDirectory, appDir);

    const downloaded = await service.downloadPortableUpdate();
    assert.equal(downloaded.updateStatus, 'available');
    assert.equal(path.basename(downloaded.downloadedArtifactPath), 'memoq-ai-hub-win32-x64.zip');
    assert.equal(fs.existsSync(downloaded.downloadedArtifactPath), true);

    const prepared = await service.preparePortableUpdate(downloaded.downloadedArtifactPath, '');
    assert.equal(prepared.updateStatus, 'prepared');
    assert.equal(
      prepared.preparedDirectory,
      path.join(path.dirname(appDir), PORTABLE_STAGING_DIRECTORY_NAME)
    );
    assert.equal(fs.existsSync(path.join(prepared.preparedDirectory, PORTABLE_APP_EXECUTABLE_NAME)), true);
    assert.equal(extractArchiveCalls.length, 1);

    const restarting = service.markPortableUpdateRestarting();
    assert.equal(restarting.updateStatus, 'restarting');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service rejects preparing a portable update from a swapped archive', async () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    const portableUrl = 'https://example.com/memoq-ai-hub-win32-x64.zip';
    const goodBytes = Buffer.from('expected archive');
    const service = createUpdateService({
      paths,
      currentVersion: '1.0.0',
      manifestUrl,
      packagingMode: 'portable',
      extractArchive: async () => {
        throw new Error('extraction must not run for a tampered archive');
      },
      fetch: createMockFetch(new Map([
        [manifestUrl, {
          json: {
            version: '1.0.1',
            assets: {
              portable: {
                name: 'memoq-ai-hub-win32-x64.zip',
                url: portableUrl,
                sha256: sha256(goodBytes)
              }
            }
          }
        }],
        [portableUrl, { buffer: goodBytes }]
      ]))
    });

    await service.checkForUpdates({ manual: true });

    // Bytes swapped after a successful download must fail the prepare-time
    // re-verification instead of being extracted.
    const downloaded = await service.downloadPortableUpdate();
    fs.writeFileSync(downloaded.downloadedArtifactPath, 'tampered archive');
    await assert.rejects(
      () => service.preparePortableUpdate(downloaded.downloadedArtifactPath, ''),
      /does not match the manifest SHA-256/
    );
    assert.equal(service.getStatus().updateStatus, 'error');
    assert.equal(service.getStatus().lastErrorCode, UPDATE_INTEGRITY_FAILED_CODE);
    assert.equal(fs.existsSync(downloaded.downloadedArtifactPath), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service renormalizes a persisted restarting state back to prepared', () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    fs.writeFileSync(paths.updateStatePath, JSON.stringify({
      currentVersion: '1.0.0',
      packagingMode: 'portable',
      manifestUrl,
      updateStatus: 'restarting',
      latestVersion: '1.0.1',
      preparedDirectory: path.join(tempRoot, 'staging'),
      availableAssets: {
        portable: {
          name: 'memoq-ai-hub-win32-x64.zip',
          url: 'https://example.com/memoq-ai-hub-win32-x64.zip'
        }
      }
    }), 'utf8');

    const status = createUpdateService({
      paths,
      currentVersion: '1.0.0',
      manifestUrl,
      packagingMode: 'portable',
      fetch: createMockFetch()
    }).getStatus();

    assert.equal(status.updateStatus, 'prepared');
    assert.equal(status.preparedDirectory, path.join(tempRoot, 'staging'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service streams installer downloads with incremental progress', async () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    const installerUrl = 'https://example.com/memoq-ai-hub-setup.exe';
    const firstChunk = Buffer.alloc(1024 * 1024 + 11, 7);
    const secondChunk = Buffer.alloc(512 * 1024, 9);
    const installerBytes = Buffer.concat([firstChunk, secondChunk]);
    const installerSha256 = sha256(installerBytes);
    const midwayProgress = [];
    let service;
    service = createUpdateService({
      paths,
      currentVersion: '1.0.0',
      manifestUrl,
      packagingMode: 'installed',
      fetch: async (url) => {
        if (url === manifestUrl) {
          return {
            ok: true,
            status: 200,
            url,
            async json() {
              return {
                version: '1.0.2',
                assets: {
                  installer: {
                    name: 'memoq-ai-hub-setup.exe',
                    url: installerUrl,
                    sha256: installerSha256
                  }
                }
              };
            }
          };
        }
        return {
          ok: true,
          status: 200,
          url,
          headers: new Map([['content-length', String(installerBytes.length)]]),
          body: (async function* generateBody() {
            yield firstChunk;
            midwayProgress.push(service.getStatus().downloadProgress);
            yield secondChunk;
          })()
        };
      }
    });

    await service.checkForUpdates({ manual: true });
    const downloaded = await service.downloadInstallerUpdate();

    assert.equal(path.basename(downloaded.downloadedArtifactPath), 'memoq-ai-hub-setup.exe');
    assert.equal(fs.existsSync(downloaded.downloadedArtifactPath), true);
    assert.equal(fs.existsSync(`${path.join(paths.updateDownloadsDir, 'memoq-ai-hub-setup.exe')}.part`), false);
    assert.deepEqual(downloaded.downloadProgress, {
      receivedBytes: installerBytes.length,
      totalBytes: installerBytes.length,
      bytesPerSecond: 0
    });
    const midway = midwayProgress.find((progress) => progress.receivedBytes === firstChunk.length);
    assert.equal(midway.totalBytes, installerBytes.length);
    assert.ok(midway.bytesPerSecond > 0);

    const verified = await service.verifyDownloadedInstallerUpdate(downloaded.downloadedArtifactPath);
    assert.equal(verified.ok, true);
    assert.equal(verified.sha256, installerSha256);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service normalizes stale persisted available updates for the current app version', () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    fs.writeFileSync(paths.updateStatePath, JSON.stringify({
      currentVersion: '1.0.14',
      packagingMode: 'portable',
      manifestUrl,
      updateStatus: 'available',
      latestVersion: '1.0.10',
      publishedAt: '2026-03-27T09:24:41.000Z',
      releaseNotesUrl: 'https://github.com/langlink-localization/memoq-ai-hub/releases/tag/v1.0.10',
      portableDownloadUrl: 'https://github.com/langlink-localization/memoq-ai-hub/releases/tag/v1.0.10',
      downloadedArtifactPath: path.join(tempRoot, 'old-update.zip'),
      preparedDirectory: path.join(tempRoot, 'prepared-old-update'),
      availableAssets: {
        portable: {
          name: 'memoq-ai-hub-win32-x64.zip',
          url: 'https://example.com/v1.0.10/memoq-ai-hub-win32-x64.zip'
        },
        installer: null
      }
    }, null, 2));

    const service = createUpdateService({
      paths,
      currentVersion: '1.0.16',
      manifestUrl,
      packagingMode: 'portable',
      fetch: createMockFetch()
    });
    const status = service.getStatus();

    assert.equal(status.currentVersion, '1.0.16');
    assert.equal(status.updateStatus, 'up-to-date');
    assert.equal(status.latestVersion, '');
    assert.equal(status.releaseNotesUrl, '');
    assert.equal(status.portableDownloadUrl, '');
    assert.equal(status.downloadedArtifactPath, '');
    assert.equal(status.preparedDirectory, '');
    assert.equal(status.availableAssets.portable, null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service requests the manifest without cache and treats equal remote versions as up to date', async () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    const calls = [];
    const logger = createMockLogger();
    const service = createUpdateService({
      paths,
      currentVersion: '1.0.16',
      manifestUrl,
      packagingMode: 'portable',
      logger,
      fetch: createMockFetch(new Map([
        [manifestUrl, {
          json: {
            version: '1.0.16',
            tag: 'v1.0.16',
            releaseNotesUrl: 'https://github.com/langlink-localization/memoq-ai-hub/releases/tag/v1.0.16',
            assets: {
              portable: {
                name: 'memoq-ai-hub-win32-x64.zip',
                url: 'https://example.com/v1.0.16/memoq-ai-hub-win32-x64.zip'
              }
            }
          }
        }]
      ]), calls)
    });

    const status = await service.checkForUpdates({ manual: true });

    assert.equal(calls[0].url, manifestUrl);
    assert.equal(calls[0].options.cache, 'no-store');
    assert.equal(calls[0].options.headers['cache-control'], 'no-cache');
    assert.equal(calls[0].options.headers.pragma, 'no-cache');
    assert.equal(status.updateStatus, 'up-to-date');
    assert.equal(status.latestVersion, '1.0.16');
    assert.equal(status.lastErrorCode, '');
    assert.equal(status.portableDownloadUrl, '');
    assert.equal(status.downloadedArtifactPath, '');
    assert.equal(status.preparedDirectory, '');
    assert.equal(status.availableAssets.portable, null);
    assert.equal(logger.entries.some((entry) => entry.event === 'update-check-start'), true);
    assert.equal(logger.entries.some((entry) => entry.event === 'update-check-complete' && entry.data.latestVersion === '1.0.16'), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service times out manifest requests that never settle', async () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    const calls = [];
    const logger = createMockLogger();
    const service = createUpdateService({
      paths,
      currentVersion: '1.0.16',
      manifestUrl,
      packagingMode: 'portable',
      manifestTimeoutMs: 20,
      logger,
      fetch: (url, options = {}) => {
        calls.push({ url: String(url || ''), options });
        return new Promise(() => {});
      }
    });

    const status = await service.checkForUpdates({ manual: true });

    assert.equal(status.updateStatus, 'error');
    assert.equal(status.lastErrorCode, UPDATE_CHECK_TIMEOUT_CODE);
    assert.equal(status.lastError, UPDATE_CHECK_TIMEOUT_MESSAGE);
    assert.equal(calls[0].url, manifestUrl);
    assert.equal(calls[0].options.signal.aborted, true);
    assert.equal(logger.entries.some((entry) => entry.event === 'update-check-start'), true);
    assert.equal(
      logger.entries.some((entry) => entry.event === 'update-check-failed' && entry.data.errorCode === UPDATE_CHECK_TIMEOUT_CODE),
      true
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service accepts a slow manifest response within the timeout', async () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    const logger = createMockLogger();
    const service = createUpdateService({
      paths,
      currentVersion: '1.0.16',
      manifestUrl,
      packagingMode: 'portable',
      manifestTimeoutMs: 80,
      logger,
      fetch: createMockFetch(new Map([
        [manifestUrl, {
          delayMs: 20,
          json: {
            version: '1.0.16',
            publishedAt: '2026-04-30T08:41:20.402Z',
            releaseNotesUrl: 'https://github.com/langlink-localization/memoq-ai-hub/releases/tag/v1.0.16'
          }
        }]
      ]))
    });

    const status = await service.checkForUpdates({ manual: true });

    assert.equal(status.updateStatus, 'up-to-date');
    assert.equal(status.latestVersion, '1.0.16');
    assert.equal(status.publishedAt, '2026-04-30T08:41:20.402Z');
    assert.equal(status.releaseNotesUrl, 'https://github.com/langlink-localization/memoq-ai-hub/releases/tag/v1.0.16');
    assert.equal(logger.entries.some((entry) => entry.event === 'update-check-complete' && entry.data.elapsedMs >= 0), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service downloads matching installer bytes and re-verifies them before launch', async () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    const installerUrl = 'https://example.com/memoQ-AI-Hub-Setup.exe';
    const installerBytes = Buffer.from('installer binary');
    const installerSha256 = sha256(installerBytes);
    const service = createUpdateService({
      paths,
      currentVersion: '1.0.0',
      manifestUrl,
      packagingMode: 'installed',
      fetch: createMockFetch(new Map([
        [manifestUrl, {
          json: {
            version: '1.0.2',
            assets: {
              installer: {
                name: 'memoQ-AI-Hub-Setup.exe',
                url: installerUrl,
                sha256: installerSha256
              }
            }
          }
        }],
        [installerUrl, {
          buffer: installerBytes
        }]
      ]))
    });

    await service.checkForUpdates({ manual: true });
    const downloaded = await service.downloadInstallerUpdate();

    assert.equal(downloaded.packagingMode, 'installed');
    assert.equal(path.basename(downloaded.downloadedArtifactPath), 'memoQ-AI-Hub-Setup.exe');
    assert.equal(fs.existsSync(downloaded.downloadedArtifactPath), true);
    assert.equal(downloaded.availableAssets.installer.sha256, installerSha256);

    const verified = await service.verifyDownloadedInstallerUpdate(downloaded.downloadedArtifactPath);
    assert.deepEqual(verified, {
      ok: true,
      installerPath: downloaded.downloadedArtifactPath,
      sha256: installerSha256
    });

    fs.writeFileSync(downloaded.downloadedArtifactPath, 'tampered installer');
    await assert.rejects(
      () => service.verifyDownloadedInstallerUpdate(downloaded.downloadedArtifactPath),
      /does not match the manifest SHA-256/
    );
    const failed = service.getStatus();
    assert.equal(failed.updateStatus, 'error');
    assert.equal(failed.lastErrorCode, UPDATE_INTEGRITY_FAILED_CODE);
    assert.equal(failed.lastError, UPDATE_INTEGRITY_FAILED_MESSAGE);
    assert.equal(failed.downloadedArtifactPath, '');
    assert.equal(fs.existsSync(downloaded.downloadedArtifactPath), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service rejects application-managed downloads without a manifest digest', async () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    const installerUrl = 'https://example.com/memoQ-AI-Hub-Setup.exe';
    const service = createUpdateService({
      paths,
      currentVersion: '1.0.0',
      manifestUrl,
      packagingMode: 'installed',
      fetch: createMockFetch(new Map([
        [manifestUrl, {
          json: {
            version: '1.0.2',
            assets: {
              installer: {
                name: 'memoQ-AI-Hub-Setup.exe',
                url: installerUrl
              }
            }
          }
        }],
        [installerUrl, { buffer: 'installer binary' }]
      ]))
    });

    await service.checkForUpdates({ manual: true });
    await assert.rejects(
      () => service.downloadInstallerUpdate(),
      /SHA-256 is required for application-managed downloads/
    );

    const status = service.getStatus();
    assert.equal(status.updateStatus, 'error');
    assert.equal(status.lastErrorCode, UPDATE_INTEGRITY_FAILED_CODE);
    assert.equal(status.downloadedArtifactPath, '');
    assert.equal(fs.existsSync(path.join(paths.updateDownloadsDir, 'memoQ-AI-Hub-Setup.exe')), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service rejects mismatched installer bytes without persisting them', async () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    const installerUrl = 'https://example.com/memoQ-AI-Hub-Setup.exe';
    const service = createUpdateService({
      paths,
      currentVersion: '1.0.0',
      manifestUrl,
      packagingMode: 'installed',
      fetch: createMockFetch(new Map([
        [manifestUrl, {
          json: {
            version: '1.0.2',
            assets: {
              installer: {
                name: 'memoQ-AI-Hub-Setup.exe',
                url: installerUrl,
                sha256: sha256('expected installer')
              }
            }
          }
        }],
        [installerUrl, { buffer: 'tampered installer' }]
      ]))
    });

    await service.checkForUpdates({ manual: true });
    await assert.rejects(
      () => service.downloadInstallerUpdate(),
      /does not match the manifest SHA-256/
    );

    const status = service.getStatus();
    assert.equal(status.updateStatus, 'error');
    assert.equal(status.lastErrorCode, UPDATE_INTEGRITY_FAILED_CODE);
    assert.equal(status.lastError, UPDATE_INTEGRITY_FAILED_MESSAGE);
    assert.equal(fs.existsSync(path.join(paths.updateDownloadsDir, 'memoQ-AI-Hub-Setup.exe')), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service rejects an asset download redirected to an unsafe final URL', async () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    const installerUrl = 'https://example.com/memoQ-AI-Hub-Setup.exe';
    const service = createUpdateService({
      paths,
      currentVersion: '1.0.0',
      manifestUrl,
      packagingMode: 'installed',
      fetch: createMockFetch(new Map([
        [manifestUrl, {
          json: {
            version: '1.0.2',
            assets: {
              installer: {
                name: 'memoQ-AI-Hub-Setup.exe',
                url: installerUrl,
                sha256: sha256('installer binary')
              }
            }
          }
        }],
        [installerUrl, {
          url: 'http://example.com/memoQ-AI-Hub-Setup.exe',
          buffer: 'installer binary'
        }]
      ]))
    });

    await service.checkForUpdates({ manual: true });
    await assert.rejects(
      () => service.downloadInstallerUpdate(),
      /Final update download URL must use HTTPS/
    );
    assert.equal(
      fs.existsSync(path.join(paths.updateDownloadsDir, 'memoQ-AI-Hub-Setup.exe')),
      false
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('downloads can be cancelled and retried, and concurrent checks cannot replace active state', async () => {
  const root = createTempRoot();
  const bytes = Buffer.from('verified update');
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  let attempt = 0;
  const paths = createAppPaths({ appDataRoot: root });
  const service = createUpdateService({ paths, currentVersion: '1.0.0', packagingMode: 'installed', manifestUrl: 'https://example.com/manifest',
    fetch: async (url, options) => {
      if (url.endsWith('/manifest')) return new Response(JSON.stringify({ version: '1.0.2', assets: { installer: { name: 'setup.exe', url: 'https://example.com/setup.exe', sha256: sha256(bytes) } } }));
      attempt += 1;
      if (attempt === 1) {
        started();
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
      }
      return new Response(bytes);
    }
  });
  try {
    await service.checkForUpdates();
    const pending = service.downloadInstallerUpdate();
    await ready;
    await assert.rejects(service.downloadInstallerUpdate(), /already running/);
    assert.equal((await service.checkForUpdates()).updateStatus, 'downloading');
    service.cancelUpdateDownload();
    assert.equal((await pending).lastErrorCode, 'UPDATE_DOWNLOAD_CANCELLED');
    assert.equal(service.getStatus().updateStatus, 'available');
    const retry = await service.downloadInstallerUpdate();
    assert.equal(fs.readFileSync(retry.downloadedArtifactPath).toString(), bytes.toString());
    assert.equal(fs.existsSync(retry.downloadedArtifactPath + '.part'), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stalled download times out, cleans partial data and publishes a retryable error', async () => {
  const root = createTempRoot();
  const service = createUpdateService({ paths: createAppPaths({ appDataRoot: root }), currentVersion: '1.0.0', packagingMode: 'installed', manifestUrl: 'https://example.com/manifest', downloadIdleTimeoutMs: 20,
    fetch: async (url, options) => {
      if (url.endsWith('/manifest')) return new Response(JSON.stringify({ version: '1.0.2', assets: { installer: { name: 'setup.exe', url: 'https://example.com/setup.exe', sha256: sha256('x') } } }));
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(Buffer.from('partial'));
        options.signal.addEventListener('abort', () => controller.error(options.signal.reason));
      } }));
    }
  });
  try {
    await service.checkForUpdates();
    await assert.rejects(service.downloadInstallerUpdate(), (error) => error.code === 'UPDATE_DOWNLOAD_TIMEOUT');
    assert.equal(service.getStatus().updateStatus, 'error');
    assert.equal(service.getStatus().lastErrorCode, 'UPDATE_DOWNLOAD_TIMEOUT');
    assert.equal(service.getStatus().downloadedArtifactPath, '');
    assert.equal(fs.readdirSync(path.join(root, 'updates', 'downloads')).some((name) => name.endsWith('.part')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('manifest deadline includes a stalled response body, not only headers', async () => {
  const root = createTempRoot();
  let aborted = false;
  const service = createUpdateService({ paths: createAppPaths({ appDataRoot: root }), currentVersion: '1.0.0', manifestTimeoutMs: 20,
    fetch: async (_url, options) => new Response(new ReadableStream({ start(controller) {
      options.signal.addEventListener('abort', () => { aborted = true; controller.error(options.signal.reason); });
    } }))
  });
  try {
    const result = await service.checkForUpdates();
    assert.equal(result.lastErrorCode, 'UPDATE_CHECK_TIMEOUT');
    assert.equal(aborted, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
