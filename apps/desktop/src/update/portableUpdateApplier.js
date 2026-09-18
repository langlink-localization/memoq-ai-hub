// Applies a prepared portable update after the Electron app exits. The main
// process stages the verified update (see updateService), then spawns a
// detached PowerShell helper that waits for the app to exit, swaps the app
// directory, relaunches the new executable, and cleans up the backup. Every
// step logs to the apply log so a failed swap can be diagnosed after restart.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  PORTABLE_APP_EXECUTABLE_NAME,
  PORTABLE_BACKUP_NAME_PREFIX,
  PORTABLE_STAGING_DIRECTORY_NAME
} = require('./updateService');

const APPLY_SCRIPT_NAME = 'apply-portable-update.ps1';
const APPLY_LOG_NAME = 'apply-portable-update.log';
const WAIT_FOR_EXIT_TIMEOUT_SECONDS = 60;
const RENAME_RETRY_COUNT = 15;
const RENAME_RETRY_DELAY_SECONDS = 2;
const POWERSHELL_ARGUMENTS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];

function escapePowerShellSingleQuoted(value) {
  return String(value || '').replace(/'/g, "''");
}

function quotePowerShellLiteral(value) {
  return `'${escapePowerShellSingleQuoted(value)}'`;
}

function createNoopLogger() {
  return {
    info() {},
    warn() {},
    error() {}
  };
}

/**
 * Builds the detached helper script. Pure so tests can assert the swap,
 * rollback, and retry logic without executing PowerShell.
 */
function buildApplyScript({
  appExecutableName = PORTABLE_APP_EXECUTABLE_NAME,
  backupName,
  backupPath,
  cleanupDirectory = '',
  logPath,
  preparedDirectory,
  renameRetryCount = RENAME_RETRY_COUNT,
  renameRetryDelaySeconds = RENAME_RETRY_DELAY_SECONDS,
  targetAppDir,
  waitPid = 0,
  waitForExitTimeoutSeconds = WAIT_FOR_EXIT_TIMEOUT_SECONDS
} = {}) {
  const targetBaseName = path.basename(String(targetAppDir || 'app'));
  const preparedExe = path.join(String(preparedDirectory || ''), appExecutableName);
  const targetExe = path.join(String(targetAppDir || ''), appExecutableName);
  const lines = [];

  lines.push('$ErrorActionPreference = \'Stop\'');
  lines.push('');
  lines.push('function Write-ApplyLog([string]$Message) {');
  lines.push(`  try { Add-Content -LiteralPath ${quotePowerShellLiteral(logPath)} -Value ("{0} {1}" -f (Get-Date -Format o), $Message) } catch { }`);
  lines.push('}');
  lines.push('');
  lines.push(`Write-ApplyLog ${quotePowerShellLiteral(`apply-start pid=${waitPid}`)}`);
  lines.push('');
  lines.push('try {');
  lines.push(`  if (${Number(waitPid) || 0} -gt 0) {`);
  lines.push(`    try { Wait-Process -Id ${Number(waitPid) || 0} -Timeout ${Number(waitForExitTimeoutSeconds) || 60} -ErrorAction SilentlyContinue } catch { }`);
  lines.push('  }');
  lines.push('  Start-Sleep -Milliseconds 800');
  lines.push('');
  lines.push(`  if (-not (Test-Path -LiteralPath ${quotePowerShellLiteral(preparedExe)})) {`);
  lines.push(`    throw ${quotePowerShellLiteral(`Prepared update is missing ${appExecutableName}.`)}`);
  lines.push('  }');
  lines.push('');
  lines.push('  $renamed = $false');
  lines.push(`  for ($attempt = 1; $attempt -le ${Number(renameRetryCount) || 15}; $attempt++) {`);
  lines.push('    try {');
  lines.push(`      if (Test-Path -LiteralPath ${quotePowerShellLiteral(backupPath)}) {`);
  lines.push(`        Remove-Item -LiteralPath ${quotePowerShellLiteral(backupPath)} -Recurse -Force -ErrorAction Stop`);
  lines.push('      }');
  lines.push(`      Rename-Item -LiteralPath ${quotePowerShellLiteral(targetAppDir)} -NewName ${quotePowerShellLiteral(backupName)} -ErrorAction Stop`);
  lines.push('      $renamed = $true');
  lines.push('      break');
  lines.push('    } catch {');
  lines.push(`      Write-ApplyLog ${quotePowerShellLiteral('rename-attempt-failed')}`);
  lines.push(`      Start-Sleep -Seconds ${Number(renameRetryDelaySeconds) || 2}`);
  lines.push('    }');
  lines.push('  }');
  lines.push('  if (-not $renamed) {');
  lines.push(`    throw ${quotePowerShellLiteral('Unable to rename the current application directory.')}`);
  lines.push('  }');
  lines.push('');
  lines.push('  try {');
  lines.push(`    Move-Item -LiteralPath ${quotePowerShellLiteral(preparedDirectory)} -Destination ${quotePowerShellLiteral(targetAppDir)} -ErrorAction Stop`);
  lines.push('  } catch {');
  lines.push(`    Write-ApplyLog ${quotePowerShellLiteral('move-failed-rolling-back')}`);
  lines.push(`    Rename-Item -LiteralPath ${quotePowerShellLiteral(backupPath)} -NewName ${quotePowerShellLiteral(targetBaseName)} -ErrorAction SilentlyContinue`);
  lines.push(`    throw ${quotePowerShellLiteral('Unable to move the prepared update into place.')}`);
  lines.push('  }');
  if (cleanupDirectory) {
    lines.push(`  if (Test-Path -LiteralPath ${quotePowerShellLiteral(cleanupDirectory)}) {`);
    lines.push(`    Remove-Item -LiteralPath ${quotePowerShellLiteral(cleanupDirectory)} -Recurse -Force -ErrorAction SilentlyContinue`);
    lines.push('  }');
  }
  lines.push(`  Write-ApplyLog ${quotePowerShellLiteral('update-moved')}`);
  lines.push('');
  lines.push(`  Start-Process -FilePath ${quotePowerShellLiteral(targetExe)} -WorkingDirectory ${quotePowerShellLiteral(targetAppDir)}`);
  lines.push(`  Write-ApplyLog ${quotePowerShellLiteral('update-relaunched')}`);
  lines.push('');
  lines.push('  Start-Sleep -Seconds 8');
  lines.push('  try {');
  lines.push(`    if (Test-Path -LiteralPath ${quotePowerShellLiteral(backupPath)}) {`);
  lines.push(`      Remove-Item -LiteralPath ${quotePowerShellLiteral(backupPath)} -Recurse -Force -ErrorAction Stop`);
  lines.push(`      Write-ApplyLog ${quotePowerShellLiteral('backup-removed')}`);
  lines.push('    }');
  lines.push('  } catch {');
  lines.push(`    Write-ApplyLog ${quotePowerShellLiteral('backup-remove-deferred')}`);
  lines.push('  }');
  lines.push('');
  lines.push(`  Write-ApplyLog ${quotePowerShellLiteral('apply-complete')}`);
  lines.push('  exit 0');
  lines.push('} catch {');
  lines.push('  Write-ApplyLog (\'apply-failed message=\' + $_.Exception.Message)');
  lines.push(`  if (Test-Path -LiteralPath ${quotePowerShellLiteral(backupPath)}) {`);
  lines.push(`    Rename-Item -LiteralPath ${quotePowerShellLiteral(backupPath)} -NewName ${quotePowerShellLiteral(targetBaseName)} -ErrorAction SilentlyContinue`);
  lines.push('  }');
  lines.push(`  if (Test-Path -LiteralPath ${quotePowerShellLiteral(targetExe)}) {`);
  lines.push(`    Start-Process -FilePath ${quotePowerShellLiteral(targetExe)} -WorkingDirectory ${quotePowerShellLiteral(targetAppDir)} -ErrorAction SilentlyContinue`);
  lines.push('  }');
  lines.push('  exit 1');
  lines.push('}');

  return `${lines.join('\r\n')}\r\n`;
}

function createPortableUpdateApplier(options = {}) {
  const fsImpl = options.fs || fs;
  const spawnImpl = options.spawn || spawn;
  const logger = options.logger || createNoopLogger();
  const updatesDir = String(options.updatesDir || path.join(process.cwd(), 'updates'));
  const buildBackupTag = options.buildBackupTag
    || (() => new Date().toISOString().replace(/[:.]/g, '-'));

  function apply({ preparedDirectory, targetAppDir, waitPid = 0 } = {}) {
    const prepared = String(preparedDirectory || '').trim();
    const target = String(targetAppDir || '').trim();
    if (!prepared || !target) {
      throw new Error('A prepared directory and a target app directory are required to apply a portable update.');
    }

    const appExecutableName = String(options.appExecutableName || PORTABLE_APP_EXECUTABLE_NAME);
    const preparedExe = path.join(prepared, appExecutableName);
    const targetExe = path.join(target, appExecutableName);
    if (!fsImpl.existsSync(preparedExe)) {
      throw new Error(`Prepared update is missing ${appExecutableName}: ${prepared}`);
    }
    if (!fsImpl.existsSync(targetExe)) {
      throw new Error(`Target app directory does not contain ${appExecutableName}: ${target}`);
    }

    if (!fsImpl.existsSync(updatesDir)) {
      fsImpl.mkdirSync(updatesDir, { recursive: true });
    }

    const backupName = `${PORTABLE_BACKUP_NAME_PREFIX}${buildBackupTag()}`;
    const backupPath = path.join(path.dirname(target), backupName);
    const scriptPath = path.join(updatesDir, APPLY_SCRIPT_NAME);
    const logPath = path.join(updatesDir, APPLY_LOG_NAME);
    // Archives that contain a single root folder leave the staging wrapper
    // behind after the move; the helper removes it once the move succeeds.
    const preparedParentName = path.basename(path.dirname(prepared));
    const cleanupDirectory = path.basename(prepared) !== PORTABLE_STAGING_DIRECTORY_NAME
      && preparedParentName === PORTABLE_STAGING_DIRECTORY_NAME
      ? path.dirname(prepared)
      : '';

    const script = buildApplyScript({
      appExecutableName,
      backupName,
      backupPath,
      cleanupDirectory,
      logPath,
      preparedDirectory: prepared,
      targetAppDir: target,
      waitPid
    });
    fsImpl.writeFileSync(scriptPath, script, 'utf8');

    logger.info('portable-update-apply-scheduled', 'Portable update apply helper scheduled.', {
      preparedDirectory: prepared,
      targetAppDir: target,
      backupPath,
      scriptPath,
      waitPid
    });

    const child = spawnImpl('powershell.exe', [...POWERSHELL_ARGUMENTS, scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();

    return {
      ok: true,
      scriptPath,
      logPath,
      backupPath,
      waitPid
    };
  }

  /**
   * Removes leftover backup directories from earlier applies. Staging
   * directories are intentionally preserved: a prepared update may still be
   * waiting to be applied after an interrupted session.
   */
  function cleanupStaleArtifacts({ targetAppDir } = {}) {
    const removed = [];
    const target = String(targetAppDir || '').trim();
    if (!target) {
      return removed;
    }
    const parent = path.dirname(target);
    if (!fsImpl.existsSync(parent)) {
      return removed;
    }
    for (const entry of fsImpl.readdirSync(parent)) {
      if (!entry.startsWith(PORTABLE_BACKUP_NAME_PREFIX)) {
        continue;
      }
      const candidate = path.join(parent, entry);
      try {
        fsImpl.rmSync(candidate, { recursive: true, force: true });
        removed.push(candidate);
      } catch (error) {
        logger.warn('portable-update-cleanup-failed', 'Unable to remove a stale update backup.', {
          path: candidate,
          errorMessage: String(error?.message || error)
        });
      }
    }
    return removed;
  }

  return {
    apply,
    cleanupStaleArtifacts
  };
}

module.exports = {
  APPLY_LOG_NAME,
  APPLY_SCRIPT_NAME,
  WAIT_FOR_EXIT_TIMEOUT_SECONDS,
  RENAME_RETRY_COUNT,
  RENAME_RETRY_DELAY_SECONDS,
  buildApplyScript,
  createPortableUpdateApplier
};
