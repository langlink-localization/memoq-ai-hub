const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  compareVersions,
  createUpdateService,
  resolvePackagingMode
} = require('../src/update/updateService');
const { createAppPaths } = require('../src/shared/paths');

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-ai-hub-update-'));
}

function createMockFetch(responses = new Map()) {
  return async function fetch(url) {
    const key = String(url || '');
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

test('update service checks, downloads, and prepares portable updates', async () => {
  const tempRoot = createTempRoot();
  try {
    const paths = createAppPaths({ appDataRoot: tempRoot });
    const manifestUrl = 'https://example.com/latest.json';
    const portableUrl = 'https://example.com/memoq-ai-hub-win32-x64.zip';
    const extractCalls = [];
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
            releaseNotesUrl: 'https://example.com/release',
            assets: {
              portable: {
                name: 'memoq-ai-hub-win32-x64.zip',
                url: portableUrl
              }
            }
          }
        }],
        [portableUrl, {
          buffer: 'portable zip bytes'
        }]
      ])),
      extractArchive: async (sourcePath, targetDir) => {
        extractCalls.push({ sourcePath, targetDir });
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, 'MemoQ AI Hub.exe'), 'binary');
      }
    });

    const available = await service.checkForUpdates({ manual: true });
    assert.equal(available.updateStatus, 'available');
    assert.equal(available.latestVersion, '1.0.1');

    const downloaded = await service.downloadPortableUpdate();
    assert.equal(fs.existsSync(downloaded.downloadedArtifactPath), true);

    const prepared = await service.preparePortableUpdate(downloaded.downloadedArtifactPath);
    assert.equal(prepared.updateStatus, 'prepared');
    assert.equal(fs.existsSync(path.join(prepared.preparedDirectory, 'MemoQ AI Hub.exe')), true);
    assert.equal(extractCalls.length, 1);
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
