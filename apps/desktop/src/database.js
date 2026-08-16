const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DEFAULT_PERSIST_DEBOUNCE_MS = 500;
const DEFAULT_PERSIST_MAX_DIRTY_MS = 3000;

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

async function createDatabase(paths, options = {}) {
  const SQL = await initSqlJs({
    locateFile() {
      return resolveSqlWasmPath();
    }
  });

  const db = fs.existsSync(paths.dbPath)
    ? new SQL.Database(fs.readFileSync(paths.dbPath))
    : new SQL.Database();
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
  let persistDebounceTimer = null;
  let persistMaxTimer = null;

  function assertOpen() {
    if (closed) {
      throw new Error('Database is already closed.');
    }
  }

  function writeDatabaseNow() {
    fs.writeFileSync(paths.dbPath, Buffer.from(db.export()));
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

  function exec(sql) {
    assertOpen();
    db.exec(sql);
    persistIfNeeded();
  }

  function run(sql, params = {}) {
    assertOpen();
    const stmt = db.prepare(sql);
    stmt.run(params);
    stmt.free();
    persistIfNeeded();
    return db.getRowsModified();
  }

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

  function get(sql, params = {}) {
    return all(sql, params)[0] || null;
  }

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
  buildSqlWasmCandidates,
  createDatabase
};
