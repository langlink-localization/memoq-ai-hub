const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  APPLY_SCRIPT_NAME,
  buildApplyScript,
  createPortableUpdateApplier
} = require('../src/update/portableUpdateApplier');
const {
  PORTABLE_APP_EXECUTABLE_NAME,
  PORTABLE_BACKUP_NAME_PREFIX,
  PORTABLE_STAGING_DIRECTORY_NAME
} = require('../src/update/updateService');

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-ai-hub-apply-'));
}

function createPackagedAppTree(tempRoot) {
  const appDir = path.join(tempRoot, 'install', 'memoQ AI Hub-win32-x64');
  const preparedDir = path.join(tempRoot, 'install', PORTABLE_STAGING_DIRECTORY_NAME);
  fs.mkdirSync(path.join(appDir, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(appDir, PORTABLE_APP_EXECUTABLE_NAME), 'current exe');
  fs.mkdirSync(preparedDir, { recursive: true });
  fs.writeFileSync(path.join(preparedDir, PORTABLE_APP_EXECUTABLE_NAME), 'new exe');
  const updatesDir = path.join(tempRoot, 'data', 'updates');
  fs.mkdirSync(updatesDir, { recursive: true });
  return { appDir, preparedDir, updatesDir };
}

test('apply script waits for exit, retries the rename, rolls back, and relaunches', () => {
  const script = buildApplyScript({
    backupName: `${PORTABLE_BACKUP_NAME_PREFIX}2026-09-18T00-00-00-000Z`,
    backupPath: `D:\\Apps\\${PORTABLE_BACKUP_NAME_PREFIX}2026-09-18T00-00-00-000Z`,
    logPath: 'D:\\Data\\updates\\apply-portable-update.log',
    preparedDirectory: 'D:\\Apps\\stage dir',
    targetAppDir: 'D:\\Apps\\memoQ AI Hub-win32-x64',
    waitPid: 4242
  });

  assert.match(script, /Wait-Process -Id 4242 -Timeout 60/);
  assert.match(script, /for \(\$attempt = 1; \$attempt -le 15; \$attempt\+\+\)/);
  assert.match(script, /Rename-Item -LiteralPath 'D:\\Apps\\memoQ AI Hub-win32-x64' -NewName '\.memoq-ai-hub-backup-2026-09-18T00-00-00-000Z'/);
  assert.match(script, /Move-Item -LiteralPath 'D:\\Apps\\stage dir' -Destination 'D:\\Apps\\memoQ AI Hub-win32-x64'/);
  assert.match(script, /Start-Process -FilePath 'D:\\Apps\\memoQ AI Hub-win32-x64\\memoQ AI Hub\.exe' -WorkingDirectory 'D:\\Apps\\memoQ AI Hub-win32-x64'/);
  assert.match(script, /move-failed-rolling-back/);
  assert.match(script, /Rename-Item -LiteralPath 'D:\\Apps\\\.memoq-ai-hub-backup-2026-09-18T00-00-00-000Z' -NewName 'memoQ AI Hub-win32-x64' -ErrorAction SilentlyContinue/);
  assert.match(script, /\$ErrorActionPreference = 'Stop'/);
});

test('apply script escapes embedded single quotes in paths', () => {
  const script = buildApplyScript({
    backupName: `${PORTABLE_BACKUP_NAME_PREFIX}tag`,
    backupPath: "C:\\dir's\\backup",
    logPath: "C:\\log's\\apply.log",
    preparedDirectory: "C:\\prep's dir",
    targetAppDir: "C:\\app's dir",
    waitPid: 1
  });

  assert.match(script, /'C:\\dir''s\\backup'/);
  assert.match(script, /'C:\\prep''s dir'/);
  assert.match(script, /'C:\\app''s dir'/);
});

test('applier writes the script and spawns a detached hidden PowerShell helper', () => {
  const tempRoot = createTempRoot();
  try {
    const { appDir, preparedDir, updatesDir } = createPackagedAppTree(tempRoot);
    const spawnCalls = [];
    const applier = createPortableUpdateApplier({
      updatesDir,
      spawn: (command, args, options) => {
        spawnCalls.push({ command, args, options });
        return { unref() {} };
      },
      buildBackupTag: () => 'fixed-tag'
    });

    const result = applier.apply({
      preparedDirectory: preparedDir,
      targetAppDir: appDir,
      waitPid: 777
    });

    assert.equal(result.ok, true);
    assert.equal(result.backupPath, path.join(path.dirname(appDir), `${PORTABLE_BACKUP_NAME_PREFIX}fixed-tag`));
    assert.equal(result.scriptPath, path.join(updatesDir, APPLY_SCRIPT_NAME));
    const writtenScript = fs.readFileSync(result.scriptPath, 'utf8');
    assert.match(writtenScript, /Wait-Process -Id 777/);

    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].command, 'powershell.exe');
    assert.deepEqual(
      spawnCalls[0].args.slice(0, -1),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']
    );
    assert.equal(spawnCalls[0].args[spawnCalls[0].args.length - 1], result.scriptPath);
    assert.equal(spawnCalls[0].options.detached, true);
    assert.equal(spawnCalls[0].options.windowsHide, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('applier refuses to apply when the prepared or target executable is missing', () => {
  const tempRoot = createTempRoot();
  try {
    const { appDir, preparedDir, updatesDir } = createPackagedAppTree(tempRoot);
    fs.rmSync(path.join(preparedDir, PORTABLE_APP_EXECUTABLE_NAME));
    const applier = createPortableUpdateApplier({ updatesDir, spawn: () => ({ unref() {} }) });

    assert.throws(
      () => applier.apply({ preparedDirectory: preparedDir, targetAppDir: appDir }),
      /Prepared update is missing/
    );

    fs.writeFileSync(path.join(preparedDir, PORTABLE_APP_EXECUTABLE_NAME), 'new exe');
    fs.rmSync(path.join(appDir, PORTABLE_APP_EXECUTABLE_NAME));
    assert.throws(
      () => applier.apply({ preparedDirectory: preparedDir, targetAppDir: appDir }),
      /Target app directory does not contain/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('startup cleanup removes stale backups but preserves staging directories', () => {
  const tempRoot = createTempRoot();
  try {
    const { appDir, updatesDir } = createPackagedAppTree(tempRoot);
    const installDir = path.dirname(appDir);
    const staleBackup = path.join(installDir, `${PORTABLE_BACKUP_NAME_PREFIX}old`);
    const staleNestedBackup = path.join(installDir, `${PORTABLE_BACKUP_NAME_PREFIX}older`);
    fs.mkdirSync(staleBackup);
    fs.mkdirSync(staleNestedBackup);
    fs.writeFileSync(path.join(staleBackup, 'leftover.txt'), 'x');

    const applier = createPortableUpdateApplier({ updatesDir, spawn: () => ({ unref() {} }) });
    const removed = applier.cleanupStaleArtifacts({ targetAppDir: appDir });

    assert.deepEqual(removed.sort(), [staleBackup, staleNestedBackup].sort());
    assert.equal(fs.existsSync(staleBackup), false);
    // The staging sibling must survive so an interrupted session can still apply.
    assert.equal(fs.existsSync(path.join(installDir, PORTABLE_STAGING_DIRECTORY_NAME)), true);
    assert.equal(fs.existsSync(appDir), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
