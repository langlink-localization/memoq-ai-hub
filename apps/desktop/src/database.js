const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

/** @typedef {Awaited<ReturnType<typeof import('sql.js')>>} SqlJsStatic */
/** @typedef {import('./types/desktopDatabase').DesktopDatabase} DesktopDatabase */

const DEFAULT_PERSIST_DEBOUNCE_MS = 500;
const DEFAULT_PERSIST_MAX_DIRTY_MS = 3000;

/**
 * @param {string} dbPath
 */
function databaseBackupPath(dbPath) {
  return `${dbPath}.bak`;
}

/**
 * @param {string} dbPath
 * @param {string=} suffix
 */
function databaseTemporaryPath(dbPath, suffix = 'tmp') {
  return `${dbPath}.${suffix}`;
}

/**
 * @param {string} filePath
 * @param {Buffer | Uint8Array} bytes
 */
function syncWriteFile(filePath, bytes) {
  const handle = fs.openSync(filePath, 'w');
  try {
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * @param {string} sourcePath
 * @param {string} targetPath
 */
function replaceFile(sourcePath, targetPath) {
  fs.renameSync(sourcePath, targetPath);
}

/**
 * @param {SqlJsStatic} SQL
 * @param {Buffer | Uint8Array} bytes
 * @param {string} sourcePath
 */
function openValidatedDatabase(SQL, bytes, sourcePath) {
  let candidate;
  try {
    candidate = new SQL.Database(bytes);
    const check = candidate.exec('PRAGMA quick_check');
    const value = check?.[0]?.values?.[0]?.[0];
    if (String(value || '').toLowerCase() !== 'ok') {
      throw new Error(`SQLite quick_check failed for ${sourcePath}.`);
    }
    return candidate;
  } catch (error) {
    candidate?.close?.();
    throw Object.assign(new Error(`Could not open a valid desktop database at ${sourcePath}.`), {
      code: 'DATABASE_CORRUPT',
      cause: error
    });
  }
}

/**
 * @param {SqlJsStatic} SQL
 * @param {string} dbPath
 * @param {string} backupPath
 */
function restoreDatabaseFromBackup(SQL, dbPath, backupPath) {
  const backupBytes = fs.readFileSync(backupPath);
  const verified = openValidatedDatabase(SQL, backupBytes, backupPath);
  verified.close();

  const recoveryPath = databaseTemporaryPath(dbPath, 'recovery');
  fs.rmSync(recoveryPath, { force: true });
  try {
    syncWriteFile(recoveryPath, backupBytes);
    replaceFile(recoveryPath, dbPath);
  } finally {
    fs.rmSync(recoveryPath, { force: true });
  }
  return openValidatedDatabase(SQL, fs.readFileSync(dbPath), dbPath);
}

/**
 * @param {SqlJsStatic} SQL
 * @param {string} dbPath
 */
function openDatabaseWithRecovery(SQL, dbPath) {
  if (!fs.existsSync(dbPath)) {
    return new SQL.Database();
  }
  try {
    return openValidatedDatabase(SQL, fs.readFileSync(dbPath), dbPath);
  } catch (primaryError) {
    const backupPath = databaseBackupPath(dbPath);
    if (!fs.existsSync(backupPath)) {
      throw primaryError;
    }
    try {
      return restoreDatabaseFromBackup(SQL, dbPath, backupPath);
    } catch (backupError) {
      throw Object.assign(new Error('The desktop database and its recovery backup are both invalid.'), {
        code: 'DATABASE_RECOVERY_FAILED',
        cause: backupError
      });
    }
  }
}

/**
 * @param {SqlJsStatic} SQL
 * @param {string} dbPath
 * @param {Buffer | Uint8Array} bytes
 */
function atomicWriteDatabase(SQL, dbPath, bytes) {
  const tempPath = databaseTemporaryPath(dbPath);
  const backupPath = databaseBackupPath(dbPath);
  const backupTempPath = databaseTemporaryPath(backupPath);
  fs.rmSync(tempPath, { force: true });
  fs.rmSync(backupTempPath, { force: true });

  const exported = Buffer.from(bytes);
  const verifiedExport = openValidatedDatabase(SQL, exported, 'in-memory export');
  verifiedExport.close();

  try {
    syncWriteFile(tempPath, exported);
    if (fs.existsSync(dbPath)) {
      const currentBytes = fs.readFileSync(dbPath);
      const current = openValidatedDatabase(SQL, currentBytes, dbPath);
      current.close();
      syncWriteFile(backupTempPath, currentBytes);
      replaceFile(backupTempPath, backupPath);
    }
    replaceFile(tempPath, dbPath);
  } finally {
    fs.rmSync(tempPath, { force: true });
    fs.rmSync(backupTempPath, { force: true });
  }
}

/**
 * @param {any} baseDir
 * @param {any} resourcesPath
 */
function buildSqlWasmCandidates(baseDir = __dirname, resourcesPath = process.resourcesPath || '') {
  return [
    path.join(baseDir, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(baseDir, '..', '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(baseDir, '..', '..', '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.resolve(baseDir, '..', '..', '..', 'sql-wasm.wasm'),
    path.join(resourcesPath, 'sql-wasm.wasm')
  ];
}

function resolveSqlWasmPath() {
  const candidates = buildSqlWasmCandidates();
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('sql-wasm.wasm not found');
  }
  return found;
}

/**
 * @param {{ dbPath: string }} paths
 * @param {{ persistDebounceMs?: number, persistMaxDirtyMs?: number }=} options
 * @returns {Promise<DesktopDatabase>}
 */
async function createDatabase(paths, options = {}) {
  const SQL = await initSqlJs({
    locateFile() {
      return resolveSqlWasmPath();
    }
  });

  const db = openDatabaseWithRecovery(SQL, paths.dbPath);
  let closed = false;
  let transactionDepth = 0;

  const eagerPersist = String(process.env.MEMOQ_AI_DESKTOP_EAGER_DB_PERSIST || '') === '1';
  const persistDebounceMs = Number.isFinite(Number(options.persistDebounceMs))
    ? Math.max(0, Number(options.persistDebounceMs))
    : DEFAULT_PERSIST_DEBOUNCE_MS;
  const persistMaxDirtyMs = Math.max(
    Number.isFinite(Number(options.persistMaxDirtyMs)) ? Number(options.persistMaxDirtyMs) : DEFAULT_PERSIST_MAX_DIRTY_MS,
    1
  );

  let persistScheduled = false;
  let persistFirstDirtyAtMs = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let persistDebounceTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let persistMaxTimer = null;

  function assertOpen() {
    if (closed) {
      throw new Error('Database is already closed.');
    }
  }

  function writeDatabaseNow() {
    atomicWriteDatabase(SQL, paths.dbPath, db.export());
  }

  function clearPersistTimers() {
    if (persistDebounceTimer) {
      clearTimeout(persistDebounceTimer);
      persistDebounceTimer = null;
    }
    if (persistMaxTimer) {
      clearTimeout(persistMaxTimer);
      persistMaxTimer = null;
    }
  }

  function flushPersist() {
    if (!persistScheduled) {
      return;
    }

    try {
      writeDatabaseNow();
      persistScheduled = false;
      persistFirstDirtyAtMs = 0;
      clearPersistTimers();
    } catch (error) {
      console.error('[database] deferred persist failed; a retry is scheduled.', error);
      if (!persistMaxTimer) {
        persistMaxTimer = setTimeout(() => {
          persistMaxTimer = null;
          flushPersist();
        }, persistMaxDirtyMs);
        persistMaxTimer.unref?.();
      }
    }
  }

  function schedulePersist() {
    if (closed) {
      return;
    }
    if (eagerPersist) {
      clearPersistTimers();
      persistScheduled = false;
      persistFirstDirtyAtMs = 0;
      writeDatabaseNow();
      return;
    }

    persistScheduled = true;
    const now = Date.now();
    if (!persistFirstDirtyAtMs) {
      persistFirstDirtyAtMs = now;
    }

    if (!persistDebounceTimer) {
      persistDebounceTimer = setTimeout(() => {
        persistDebounceTimer = null;
        flushPersist();
      }, persistDebounceMs);
      persistDebounceTimer.unref?.();
    }
    if (!persistMaxTimer) {
      const remainingMs = Math.max(0, persistMaxDirtyMs - (now - persistFirstDirtyAtMs));
      persistMaxTimer = setTimeout(() => {
        persistMaxTimer = null;
        flushPersist();
      }, remainingMs);
      persistMaxTimer.unref?.();
    }
  }

  function persist() {
    assertOpen();
    persistScheduled = false;
    persistFirstDirtyAtMs = 0;
    clearPersistTimers();
    writeDatabaseNow();
  }

  function persistIfNeeded() {
    if (transactionDepth === 0) {
      schedulePersist();
    }
  }

  /**
   * @param {string} sql
   */
  function exec(sql) {
    assertOpen();
    db.exec(sql);
    persistIfNeeded();
  }

  /**
   * @param {string} sql
   * @param {Record<string, unknown>=} params
   */
  function run(sql, params = {}) {
    assertOpen();
    const stmt = db.prepare(sql);
    stmt.run(params);
    stmt.free();
    persistIfNeeded();
    return db.getRowsModified();
  }

  /**
   * @param {string} sql
   * @param {Record<string, unknown>=} params
   * @returns {Array<Record<string, any>>}
   */
  function all(sql, params = {}) {
    assertOpen();
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  /**
   * @param {string} sql
   * @param {Record<string, unknown>=} params
   * @returns {Record<string, any> | null}
   */
  function get(sql, params = {}) {
    return all(sql, params)[0] || null;
  }

  /**
   * @param {any} callback
   */
  function transaction(callback) {
    assertOpen();
    if (transactionDepth > 0) {
      return callback();
    }

    db.exec('BEGIN');
    transactionDepth += 1;
    try {
      const result = callback();
      transactionDepth -= 1;
      db.exec('COMMIT');
      schedulePersist();
      return result;
    } catch (error) {
      transactionDepth = Math.max(0, transactionDepth - 1);
      db.exec('ROLLBACK');
      schedulePersist();
      throw error;
    }
  }

  function close() {
    if (closed) {
      return;
    }
    clearPersistTimers();
    persistScheduled = false;
    persistFirstDirtyAtMs = 0;
    writeDatabaseNow();
    db.close();
    closed = true;
  }

  return {
    db,
    exec,
    run,
    all,
    get,
    persist,
    transaction,
    close,
    flush: flushPersist,
    hasPendingPersist() {
      return persistScheduled;
    }
  };
}

module.exports = {
  atomicWriteDatabase,
  buildSqlWasmCandidates,
  createDatabase,
  databaseBackupPath,
  openDatabaseWithRecovery
};
