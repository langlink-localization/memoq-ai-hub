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

  function persist() {
    fs.writeFileSync(paths.dbPath, Buffer.from(db.export()));
  }

  function exec(sql) {
    db.exec(sql);
    persist();
  }

  function run(sql, params = {}) {
    const stmt = db.prepare(sql);
    stmt.run(params);
    stmt.free();
    persist();
    return db.getRowsModified();
  }

  function all(sql, params = {}) {
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
    db.exec('BEGIN');
    try {
      callback();
      db.exec('COMMIT');
      persist();
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    db,
    exec,
    run,
    all,
    get,
    persist,
    transaction
  };
}

module.exports = {
  createDatabase
};
