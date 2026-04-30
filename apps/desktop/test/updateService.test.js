const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  compareVersions,
  createUpdateService,
  PORTABLE_IN_APP_UPDATE_DISABLED_MESSAGE,
  resolvePackagingMode
} = require('../src/update/updateService');
const { createAppPaths } = require('../src/shared/paths');

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-ai-hub-update-'));
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
    return {
      ok: response.ok !== false,
      status: response.status || 200,
      async json() {
        return response.json || {};
      },
      async arrayBuffer() {
        return Buffer.from(response.buffer || '');
      }
    };
  };
}

test('update service compares semantic versions numerically', () => {
  assert.equal(compareVersions('1.0.10', '1.0.2'), 1);
  assert.equal(compareVersions('1.0.2', '1.0.10'), -1);
  assert.equal(compareVersions('1.0.3', '1.0.3'), 0);
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

test('update service exposes portable download page and disables in-app portable update flow', async () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    const releaseNotesUrl = 'https://example.com/release';
    const portableUrl = 'https://example.com/memoq-ai-hub-win32-x64.zip';
    const service = createUpdateService({
      paths,
      currentVersion: '1.0.0',
      manifestUrl,
      packagingMode: 'portable',
      fetch: createMockFetch(new Map([
        [manifestUrl, {
          json: {
            version: '1.0.1',
            tag: 'v1.0.1',
            publishedAt: '2026-03-26T00:00:00.000Z',
            releaseNotesUrl,
            assets: {
              portable: {
                name: 'memoq-ai-hub-win32-x64.zip',
                url: portableUrl
              }
            }
          }
        }]
      ]))
    });

    const available = await service.checkForUpdates({ manual: true });
    assert.equal(available.updateStatus, 'available');
    assert.equal(available.latestVersion, '1.0.1');
    assert.equal(available.portableDownloadUrl, releaseNotesUrl);
    await assert.rejects(() => service.downloadPortableUpdate(), new RegExp(PORTABLE_IN_APP_UPDATE_DISABLED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await assert.rejects(() => service.preparePortableUpdate(path.join(tempRoot, 'memoq-ai-hub-win32-x64.zip')), new RegExp(PORTABLE_IN_APP_UPDATE_DISABLED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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
      currentVersion: '1.0.15',
      manifestUrl,
      packagingMode: 'portable',
      fetch: createMockFetch()
    });
    const status = service.getStatus();

    assert.equal(status.currentVersion, '1.0.15');
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
    const service = createUpdateService({
      paths,
      currentVersion: '1.0.15',
      manifestUrl,
      packagingMode: 'portable',
      fetch: createMockFetch(new Map([
        [manifestUrl, {
          json: {
            version: '1.0.15',
            tag: 'v1.0.15',
            releaseNotesUrl: 'https://github.com/langlink-localization/memoq-ai-hub/releases/tag/v1.0.15',
            assets: {
              portable: {
                name: 'memoq-ai-hub-win32-x64.zip',
                url: 'https://example.com/v1.0.15/memoq-ai-hub-win32-x64.zip'
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
    assert.equal(status.latestVersion, '1.0.15');
    assert.equal(status.portableDownloadUrl, '');
    assert.equal(status.downloadedArtifactPath, '');
    assert.equal(status.preparedDirectory, '');
    assert.equal(status.availableAssets.portable, null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('update service downloads installer assets only in installed mode', async () => {
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
        [installerUrl, {
          buffer: 'installer binary'
        }]
      ]))
    });

    await service.checkForUpdates({ manual: true });
    const downloaded = await service.downloadInstallerUpdate();

    assert.equal(downloaded.packagingMode, 'installed');
    assert.equal(path.basename(downloaded.downloadedArtifactPath), 'memoQ-AI-Hub-Setup.exe');
    assert.equal(fs.existsSync(downloaded.downloadedArtifactPath), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
