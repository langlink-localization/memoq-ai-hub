const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const integrationServiceModulePath = require.resolve('../src/integration/integrationService');

function loadIntegrationService({ childProcess } = {}) {
  const originalLoad = Module._load;
  delete require.cache[integrationServiceModulePath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'child_process' && childProcess) {
      return childProcess;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(integrationServiceModulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[integrationServiceModulePath];
  }
}

const {
  buildMemoQRootCandidates,
  buildDefaultMemoQInstallOptions,
  getIntegrationStatus,
  findMemoQDesktopInstallations,
  resolveIntegrationAssets,
  installIntegration,
  resolveClientDevConfigTarget,
  IntegrationError
} = loadIntegrationService();

test('buildMemoQRootCandidates prefers custom directory and requested version', () => {
  const candidates = buildMemoQRootCandidates({
    memoqVersion: '12',
    customInstallDir: 'D:\\memoQ\\memoQ-12'
  });

  assert.equal(candidates[0], 'D:\\memoQ\\memoQ-12');
  assert.match(candidates[1], /memoQ-12$/);
});

test('buildDefaultMemoQInstallOptions includes memoQ 10 through 12', () => {
  const options = buildDefaultMemoQInstallOptions('11');

  assert.deepEqual(
    options.map((item) => item.version),
    ['11', '12', '10']
  );
  assert.ok(options.every((item) => /memoQ-\d+$/.test(item.rootDir)));
  assert.ok(options.every((item) => item.label === `memoQ ${item.version}`));
});

test('findMemoQDesktopInstallations detects Addins folders', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-desktop-install-'));
  const installRoot = path.join(tempDir, 'memoQ-11');
  fs.mkdirSync(path.join(installRoot, 'Addins'), { recursive: true });

  const originalProgramFiles = process.env.ProgramFiles;
  try {
    process.env.ProgramFiles = tempDir;
    const found = findMemoQDesktopInstallations({
      customInstallDir: installRoot,
      memoqVersion: '11'
    });

    assert.ok(found.some((item) => item.rootDir === installRoot));
  } finally {
    process.env.ProgramFiles = originalProgramFiles;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resolveIntegrationAssets prefers packaged resources when available', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-packaged-resources-'));
  const originalResourcesPath = process.resourcesPath;

  try {
    fs.writeFileSync(path.join(tempDir, 'MemoQ.AI.Hub.Plugin.dll'), 'dll');
    fs.writeFileSync(path.join(tempDir, 'ClientDevConfig.xml'), '<xml />');
    process.resourcesPath = tempDir;

    const assets = resolveIntegrationAssets({
      repoRoot: path.join(tempDir, 'repo')
    });

    assert.equal(assets.pluginDll, path.join(tempDir, 'MemoQ.AI.Hub.Plugin.dll'));
    assert.equal(assets.clientDevConfig, path.join(tempDir, 'ClientDevConfig.xml'));
    assert.equal(assets.pluginDllExists, true);
    assert.equal(assets.clientDevConfigExists, true);
  } finally {
    process.resourcesPath = originalResourcesPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resolveClientDevConfigTarget installs into ProgramData MemoQ directory', () => {
  const target = resolveClientDevConfigTarget({
    programDataDir: 'C:\\ProgramData'
  });

  assert.equal(target, 'C:\\ProgramData\\MemoQ\\ClientDevConfig.xml');
});

test('installIntegration removes stale legacy dll and installs the new dll name', () => {
  const tempRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-integration-repo-'));
  const tempResourcesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-integration-resources-'));
  const tempProgramData = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-integration-programdata-'));
  const tempInstallRoot = path.join(tempRepoRoot, 'memoQ-12');
  const addinsDir = path.join(tempInstallRoot, 'Addins');
  const originalResourcesPath = process.resourcesPath;
  const originalProgramData = process.env.ProgramData;
  const originalCopyFileSync = fs.copyFileSync;
  const originalRmSync = fs.rmSync;

  try {
    fs.mkdirSync(addinsDir, { recursive: true });
    fs.writeFileSync(path.join(addinsDir, 'MemoQ.AI.Desktop.Plugin.dll'), 'legacy');
    fs.writeFileSync(path.join(tempResourcesRoot, 'MemoQ.AI.Hub.Plugin.dll'), 'new-dll');
    fs.writeFileSync(path.join(tempResourcesRoot, 'ClientDevConfig.xml'), '<xml />');
    process.resourcesPath = tempResourcesRoot;
    process.env.ProgramData = tempProgramData;
    fs.copyFileSync = (source, target) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, fs.readFileSync(source));
    };
    fs.rmSync = (target) => {
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    };

    const result = installIntegration(
      { repoRoot: tempRepoRoot },
      { selectedInstallDir: tempInstallRoot, memoqVersion: '12' }
    );

    assert.equal(fs.existsSync(path.join(addinsDir, 'MemoQ.AI.Desktop.Plugin.dll')), false);
    assert.equal(fs.existsSync(path.join(addinsDir, 'MemoQ.AI.Hub.Plugin.dll')), true);
    assert.equal(fs.readFileSync(path.join(addinsDir, 'MemoQ.AI.Hub.Plugin.dll'), 'utf8'), 'new-dll');
    assert.equal(
      fs.existsSync(path.join(tempProgramData, 'MemoQ', 'ClientDevConfig.xml')),
      true
    );
    assert.equal(result.installations[0].pluginInstalled, true);
    assert.equal(result.installations[0].legacyPluginInstalled, false);
    assert.equal(result.installations[0].clientDevConfigTarget, path.join(tempProgramData, 'MemoQ', 'ClientDevConfig.xml'));
  } finally {
    process.resourcesPath = originalResourcesPath;
    process.env.ProgramData = originalProgramData;
    fs.copyFileSync = originalCopyFileSync;
    fs.rmSync = originalRmSync;
    fs.rmSync(tempRepoRoot, { recursive: true, force: true });
    fs.rmSync(tempResourcesRoot, { recursive: true, force: true });
    fs.rmSync(tempProgramData, { recursive: true, force: true });
  }
});

test('getIntegrationStatus preserves selected install dir', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-install-status-'));

  try {
    const selectedInstallDir = path.join(tempDir, 'memoQ-12');
    fs.mkdirSync(path.join(selectedInstallDir, 'Addins'), { recursive: true });

    const status = getIntegrationStatus(
      { repoRoot: tempDir },
      { memoqVersion: '12', selectedInstallDir, customInstallDir: '' }
    );

    assert.equal(status.selectedInstallDir, selectedInstallDir);
    assert.deepEqual(
      status.defaultInstallOptions.map((item) => item.version).sort(),
      ['10', '11', '12']
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('installIntegration surfaces stdout and stderr details when elevated install fails', () => {
  const service = loadIntegrationService({
    childProcess: {
      spawnSync: () => ({
        status: 5,
        stdout: Buffer.from('install log line'),
        stderr: Buffer.from('access denied')
      })
    }
  });
  const tempRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-integration-fail-repo-'));
  const tempResourcesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-integration-fail-resources-'));
  const tempProgramData = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-integration-fail-programdata-'));
  const tempInstallRoot = path.join(tempRepoRoot, 'memoQ-12');
  const addinsDir = path.join(tempInstallRoot, 'Addins');
  const originalResourcesPath = process.resourcesPath;
  const originalProgramData = process.env.ProgramData;
  const originalCopyFileSync = fs.copyFileSync;

  try {
    fs.mkdirSync(addinsDir, { recursive: true });
    fs.writeFileSync(path.join(tempResourcesRoot, 'MemoQ.AI.Hub.Plugin.dll'), 'new-dll');
    fs.writeFileSync(path.join(tempResourcesRoot, 'ClientDevConfig.xml'), '<xml />');
    process.resourcesPath = tempResourcesRoot;
    process.env.ProgramData = tempProgramData;
    fs.copyFileSync = () => {
      const error = new Error('denied');
      error.code = 'EACCES';
      throw error;
    };

    assert.throws(
      () => service.installIntegration(
        { repoRoot: tempRepoRoot },
        { selectedInstallDir: tempInstallRoot, memoqVersion: '12' }
      ),
      (error) => {
        assert.ok(error instanceof service.IntegrationError);
        assert.match(error.message, /exit code 5/i);
        assert.match(error.message, /install log line/i);
        assert.match(error.message, /access denied/i);
        return true;
      }
    );
  } finally {
    process.resourcesPath = originalResourcesPath;
    process.env.ProgramData = originalProgramData;
    fs.copyFileSync = originalCopyFileSync;
    fs.rmSync(tempRepoRoot, { recursive: true, force: true });
    fs.rmSync(tempResourcesRoot, { recursive: true, force: true });
    fs.rmSync(tempProgramData, { recursive: true, force: true });
  }
});

test('installIntegration keeps the cancellation message when administrator approval is canceled', () => {
  const service = loadIntegrationService({
    childProcess: {
      spawnSync: () => ({
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('User cancelled')
      })
    }
  });
  const tempRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-integration-cancel-repo-'));
  const tempResourcesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-integration-cancel-resources-'));
  const tempProgramData = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-integration-cancel-programdata-'));
  const tempInstallRoot = path.join(tempRepoRoot, 'memoQ-12');
  const addinsDir = path.join(tempInstallRoot, 'Addins');
  const originalResourcesPath = process.resourcesPath;
  const originalProgramData = process.env.ProgramData;
  const originalCopyFileSync = fs.copyFileSync;

  try {
    fs.mkdirSync(addinsDir, { recursive: true });
    fs.writeFileSync(path.join(tempResourcesRoot, 'MemoQ.AI.Hub.Plugin.dll'), 'new-dll');
    fs.writeFileSync(path.join(tempResourcesRoot, 'ClientDevConfig.xml'), '<xml />');
    process.resourcesPath = tempResourcesRoot;
    process.env.ProgramData = tempProgramData;
    fs.copyFileSync = () => {
      const error = new Error('denied');
      error.code = 'EACCES';
      throw error;
    };

    assert.throws(
      () => service.installIntegration(
        { repoRoot: tempRepoRoot },
        { selectedInstallDir: tempInstallRoot, memoqVersion: '12' }
      ),
      (error) => {
        assert.ok(error instanceof service.IntegrationError);
        assert.match(error.message, /approval was canceled/i);
        return true;
      }
    );
  } finally {
    process.resourcesPath = originalResourcesPath;
    process.env.ProgramData = originalProgramData;
    fs.copyFileSync = originalCopyFileSync;
    fs.rmSync(tempRepoRoot, { recursive: true, force: true });
    fs.rmSync(tempResourcesRoot, { recursive: true, force: true });
    fs.rmSync(tempProgramData, { recursive: true, force: true });
  }
});
