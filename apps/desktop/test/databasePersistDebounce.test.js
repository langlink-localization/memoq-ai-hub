const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createDatabase } = require('../src/database');

function createTempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-db-debounce-')), 'memoq-ai-hub.db');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRows(db) {
  return db.all('SELECT id FROM app_state', {});
}

test('database defers disk writes until the debounce window closes', async () => {
  const dbPath = createTempDbPath();
  const db = await createDatabase({ dbPath }, { persistDebounceMs: 60, persistMaxDirtyMs: 5000 });

  try {
    db.exec('CREATE TABLE app_state (id TEXT PRIMARY KEY)');
    db.run('INSERT INTO app_state (id) VALUES ($id)', { $id: 'row-1' });

    assert.equal(db.hasPendingPersist(), true);
    assert.equal(fs.existsSync(dbPath), false, 'no eager write should happen inside the debounce window');

    await sleep(120);
    assert.equal(fs.existsSync(dbPath), true, 'debounce should flush to disk');
    assert.equal(db.hasPendingPersist(), false);

    const reopened = await createDatabase({ dbPath }, { persistDebounceMs: 60, persistMaxDirtyMs: 5000 });
    assert.deepEqual(readRows(reopened), [{ id: 'row-1' }]);
    reopened.close();
  } finally {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

test('database forces a flush after the max dirty latency even with continuous writes', async () => {
  const dbPath = createTempDbPath();
  const db = await createDatabase({ dbPath }, { persistDebounceMs: 100000, persistMaxDirtyMs: 80 });

  try {
    db.exec('CREATE TABLE app_state (id TEXT PRIMARY KEY)');
    db.run('INSERT INTO app_state (id) VALUES ($id)', { $id: 'row-1' });
    assert.equal(fs.existsSync(dbPath), false);

    // Keep rescheduling the debounce so only the max-latency timer can fire.
    const churn = setInterval(() => {
      db.run('INSERT OR REPLACE INTO app_state (id) VALUES ($id)', { $id: 'row-1' });
    }, 20);

    await sleep(160);
    clearInterval(churn);
    assert.equal(fs.existsSync(dbPath), true, 'max-latency timer must flush despite debounce churn');
  } finally {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

test('database close flushes pending writes immediately', async () => {
  const dbPath = createTempDbPath();
  const db = await createDatabase({ dbPath }, { persistDebounceMs: 100000, persistMaxDirtyMs: 100000 });

  db.exec('CREATE TABLE app_state (id TEXT PRIMARY KEY)');
  db.run('INSERT INTO app_state (id) VALUES ($id)', { $id: 'row-1' });
  assert.equal(fs.existsSync(dbPath), false);

  db.close();
  assert.equal(fs.existsSync(dbPath), true, 'close must flush the pending write');

  const reopened = await createDatabase({ dbPath }, { persistDebounceMs: 60, persistMaxDirtyMs: 5000 });
  assert.deepEqual(readRows(reopened), [{ id: 'row-1' }]);
  reopened.close();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

test('database honors the eager persist escape hatch', async () => {
  const previousValue = process.env.MEMOQ_AI_DESKTOP_EAGER_DB_PERSIST;
  process.env.MEMOQ_AI_DESKTOP_EAGER_DB_PERSIST = '1';
  const dbPath = createTempDbPath();

  try {
    const db = await createDatabase({ dbPath }, { persistDebounceMs: 100000, persistMaxDirtyMs: 100000 });
    db.exec('CREATE TABLE app_state (id TEXT PRIMARY KEY)');
    db.run('INSERT INTO app_state (id) VALUES ($id)', { $id: 'row-1' });

    assert.equal(fs.existsSync(dbPath), true, 'eager mode writes on every mutation');
    assert.equal(db.hasPendingPersist(), false);
    db.close();
  } finally {
    if (previousValue === undefined) {
      delete process.env.MEMOQ_AI_DESKTOP_EAGER_DB_PERSIST;
    } else {
      process.env.MEMOQ_AI_DESKTOP_EAGER_DB_PERSIST = previousValue;
    }
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

test('database keeps the previous committed generation as a validated backup', async () => {
  const dbPath = createTempDbPath();
  const db = await createDatabase({ dbPath }, { persistDebounceMs: 100000, persistMaxDirtyMs: 100000 });
  try {
    db.exec('CREATE TABLE app_state (id TEXT PRIMARY KEY)');
    db.run('INSERT INTO app_state (id) VALUES ($id)', { $id: 'row-1' });
    db.persist();
    assert.equal(fs.existsSync(`${dbPath}.bak`), false);

    db.run('INSERT INTO app_state (id) VALUES ($id)', { $id: 'row-2' });
    db.persist();
    assert.equal(fs.existsSync(`${dbPath}.bak`), true);

    const backupPath = `${dbPath}.bak`;
    const primaryBytes = fs.readFileSync(dbPath);
    fs.copyFileSync(backupPath, dbPath);
    const previous = await createDatabase({ dbPath }, { persistDebounceMs: 100000, persistMaxDirtyMs: 100000 });
    assert.deepEqual(readRows(previous), [{ id: 'row-1' }]);
    previous.db.close();
    fs.writeFileSync(dbPath, primaryBytes);
  } finally {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

test('database restores a corrupt primary from its last valid backup', async () => {
  const dbPath = createTempDbPath();
  const db = await createDatabase({ dbPath }, { persistDebounceMs: 100000, persistMaxDirtyMs: 100000 });
  db.exec('CREATE TABLE app_state (id TEXT PRIMARY KEY)');
  db.run('INSERT INTO app_state (id) VALUES ($id)', { $id: 'row-1' });
  db.persist();
  db.run('INSERT INTO app_state (id) VALUES ($id)', { $id: 'row-2' });
  db.persist();
  db.db.close();

  fs.writeFileSync(dbPath, 'not-a-database');
  const recovered = await createDatabase({ dbPath }, { persistDebounceMs: 100000, persistMaxDirtyMs: 100000 });
  try {
    assert.deepEqual(readRows(recovered), [{ id: 'row-1' }]);
    assert.equal(fs.existsSync(`${dbPath}.recovery`), false);
  } finally {
    recovered.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

test('database fails with a stable recovery error when primary and backup are corrupt', async () => {
  const dbPath = createTempDbPath();
  fs.writeFileSync(dbPath, 'bad-primary');
  fs.writeFileSync(`${dbPath}.bak`, 'bad-backup');
  try {
    await assert.rejects(
      () => createDatabase({ dbPath }),
      (error) => error.code === 'DATABASE_RECOVERY_FAILED'
    );
  } finally {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

test('database replacement failure preserves the committed primary and cleans temporary files', async () => {
  const dbPath = createTempDbPath();
  const db = await createDatabase({ dbPath }, { persistDebounceMs: 100000, persistMaxDirtyMs: 100000 });
  db.exec('CREATE TABLE app_state (id TEXT PRIMARY KEY)');
  db.run('INSERT INTO app_state (id) VALUES ($id)', { $id: 'row-1' });
  db.persist();
  const committedBytes = fs.readFileSync(dbPath);

  db.run('INSERT INTO app_state (id) VALUES ($id)', { $id: 'row-2' });
  const originalRename = fs.renameSync;
  fs.renameSync = (sourcePath, targetPath) => {
    if (targetPath === dbPath) {
      const error = new Error('simulated replacement failure');
      error.code = 'EPERM';
      throw error;
    }
    return originalRename(sourcePath, targetPath);
  };
  try {
    assert.throws(() => db.persist(), /simulated replacement failure/);
  } finally {
    fs.renameSync = originalRename;
  }

  try {
    assert.deepEqual(fs.readFileSync(dbPath), committedBytes);
    assert.equal(fs.existsSync(`${dbPath}.tmp`), false);
    assert.equal(fs.existsSync(`${dbPath}.bak.tmp`), false);
  } finally {
    db.db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});
