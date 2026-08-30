const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createDatabase } = require('../src/database');
const {
  applySchemaMigrations,
  createRuntimePersistence,
  SCHEMA_VERSION
} = require('../src/runtime/runtimePersistence');

function createTempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-schema-migration-')), 'memoq-ai-hub.db');
}

function listColumns(db, tableName) {
  return db.all(`PRAGMA table_info(${tableName})`, {}).map((column) => column.name);
}

test('applySchemaMigrations stamps a fresh database with the current schema version', async () => {
  const dbPath = createTempDbPath();
  const db = await createDatabase({ dbPath });

  try {
    const result = applySchemaMigrations(db);

    assert.equal(result.migrated, false);
    assert.equal(result.toVersion, SCHEMA_VERSION);
    assert.equal(db.get('PRAGMA user_version').user_version, SCHEMA_VERSION);
    for (const column of ['provider_id', 'model_name', 'status', 'entry_json']) {
      assert.ok(listColumns(db, 'translation_history').includes(column), `expected ${column} on translation_history`);
    }
  } finally {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

test('applySchemaMigrations upgrades a legacy database and preserves its rows', async () => {
  const dbPath = createTempDbPath();
  const db = await createDatabase({ dbPath });

  try {
    db.exec(`
      CREATE TABLE translation_history (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, project_id TEXT DEFAULT '', subject TEXT DEFAULT '');
      CREATE TABLE translation_history_segments (id TEXT PRIMARY KEY, history_id TEXT NOT NULL, segment_index INTEGER DEFAULT 0);
    `);
    db.run("INSERT INTO translation_history (id, request_id) VALUES ('legacy-1', 'REQ-LEGACY-1')");

    const result = applySchemaMigrations(db);

    assert.equal(result.migrated, true);
    assert.equal(result.fromVersion, 0);
    assert.equal(result.toVersion, SCHEMA_VERSION);
    assert.equal(db.get('PRAGMA user_version').user_version, SCHEMA_VERSION);

    const historyColumns = listColumns(db, 'translation_history');
    for (const column of ['provider_id', 'provider_name', 'model_name', 'status', 'submitted_at', 'completed_at', 'entry_json']) {
      assert.ok(historyColumns.includes(column), `expected migration to add ${column}`);
    }
    const segmentColumns = listColumns(db, 'translation_history_segments');
    for (const column of ['source_text', 'target_text', 'segment_json']) {
      assert.ok(segmentColumns.includes(column), `expected migration to add ${column}`);
    }
    const legacyRow = db.get("SELECT request_id FROM translation_history WHERE id = 'legacy-1'");
    assert.equal(legacyRow?.request_id, 'REQ-LEGACY-1');
  } finally {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

test('applySchemaMigrations is idempotent on an already migrated database', async () => {
  const dbPath = createTempDbPath();
  const db = await createDatabase({ dbPath });

  try {
    applySchemaMigrations(db);
    const second = applySchemaMigrations(db);

    assert.equal(second.migrated, false);
    assert.equal(second.fromVersion, SCHEMA_VERSION);
    assert.equal(db.get('PRAGMA user_version').user_version, SCHEMA_VERSION);
  } finally {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

test('applySchemaMigrations keeps the stamped version across close and reopen', async () => {
  const dbPath = createTempDbPath();
  const db = await createDatabase({ dbPath });

  try {
    applySchemaMigrations(db);
  } finally {
    db.close();
  }

  const reopened = await createDatabase({ dbPath });
  try {
    assert.equal(reopened.get('PRAGMA user_version').user_version, SCHEMA_VERSION);
    const result = applySchemaMigrations(reopened);
    assert.equal(result.migrated, false);
  } finally {
    reopened.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

test('applySchemaMigrations rejects databases from a newer schema version', async () => {
  const dbPath = createTempDbPath();
  const db = await createDatabase({ dbPath });

  try {
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`);

    assert.throws(() => applySchemaMigrations(db), (error) => {
      assert.equal(error.code, 'SCHEMA_VERSION_TOO_NEW');
      return true;
    });
  } finally {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

test('runtime persistence keeps working on top of a migrated database', async () => {
  const dbPath = createTempDbPath();
  const db = await createDatabase({ dbPath });

  try {
    applySchemaMigrations(db);
    const persistence = createRuntimePersistence(db, {
      nowIso: () => '2026-08-30T00:00:00.000Z',
      normalizeState: (state) => state
    });

    persistence.appendHistoryEntry({
      id: 'history-1',
      requestId: 'REQ-1',
      providerId: 'provider-1',
      model: 'test-model',
      status: 'success',
      submittedAt: '2026-08-30T00:00:00.000Z',
      segments: [{ id: 'segment-1', index: 0, sourceText: 'alpha', targetText: 'beta' }]
    });

    const entries = persistence.listHistory();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].requestId, 'REQ-1');
    assert.equal(entries[0].segments[0].targetText, 'beta');
  } finally {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});
