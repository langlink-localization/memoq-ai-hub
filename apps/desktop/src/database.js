const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

function resolveSqlWasmPath() {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.resolve(__dirname, '..', '..', '..', 'sql-wasm.wasm'),
    path.join(process.resourcesPath || '', 'sql-wasm.wasm')
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('sql-wasm.wasm not found');
  }
  return found;
}

async function createDatabase(paths) {
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

  function assertOpen() {
    if (closed) {
      throw new Error('Database is already closed.');
    }
  }

  function persist() {
    assertOpen();
    fs.writeFileSync(paths.dbPath, Buffer.from(db.export()));
  }

  function persistIfNeeded() {
    if (transactionDepth === 0) {
      persist();
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
      persist();
      return result;
    } catch (error) {
      transactionDepth = Math.max(0, transactionDepth - 1);
      db.exec('ROLLBACK');
      persist();
      throw error;
    }
  }

  function close() {
    if (closed) {
      return;
    }
    persist();
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
    close
  };
}

module.exports = {
  createDatabase
};
