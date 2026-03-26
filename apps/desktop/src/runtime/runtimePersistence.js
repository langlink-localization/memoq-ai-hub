const HISTORY_LIMIT = 500;
const TRANSLATION_CACHE_LIMIT = 2000;
const PROMPT_RESPONSE_CACHE_LIMIT = 500;
const DOCUMENT_SUMMARY_CACHE_LIMIT = 300;
const GLOBAL_STATE_ID = 'global';

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_prompt_blocks (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, block_type TEXT NOT NULL, content TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_assets (profile_id TEXT NOT NULL, asset_id TEXT NOT NULL, purpose TEXT NOT NULL, PRIMARY KEY (profile_id, asset_id));
    CREATE TABLE IF NOT EXISTS mapping_rules (id TEXT PRIMARY KEY, rule_name TEXT NOT NULL, profile_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS provider_models (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS translation_history (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, project_id TEXT DEFAULT '', subject TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS translation_history_segments (id TEXT PRIMARY KEY, history_id TEXT NOT NULL, segment_index INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS translation_cache (cache_key TEXT PRIMARY KEY, text_value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS prompt_response_cache (cache_key TEXT PRIMARY KEY, text_value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS document_summary_cache (cache_key TEXT PRIMARY KEY, text_value TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);

  ensureColumn(db, 'translation_history', 'provider_id TEXT DEFAULT \'\'');
  ensureColumn(db, 'translation_history', 'provider_name TEXT DEFAULT \'\'');
  ensureColumn(db, 'translation_history', 'model_name TEXT DEFAULT \'\'');
  ensureColumn(db, 'translation_history', 'status TEXT DEFAULT \'\'');
  ensureColumn(db, 'translation_history', 'submitted_at TEXT DEFAULT \'\'');
  ensureColumn(db, 'translation_history', 'completed_at TEXT DEFAULT \'\'');
  ensureColumn(db, 'translation_history', 'entry_json TEXT DEFAULT \'{}\'');
  ensureColumn(db, 'translation_history_segments', 'source_text TEXT DEFAULT \'\'');
  ensureColumn(db, 'translation_history_segments', 'target_text TEXT DEFAULT \'\'');
  ensureColumn(db, 'translation_history_segments', 'segment_json TEXT DEFAULT \'{}\'');
}

function createInitialState() {
  return {
    profiles: [],
    defaultProfileId: '',
    assets: [],
    mappingRules: [],
    providers: [],
    history: [],
    translationCache: [],
    promptResponseCache: [],
    documentSummaryCache: [],
    integrationPreferences: {
      memoqVersion: '11',
      customInstallDir: '',
      selectedInstallDir: ''
    }
  };
}

function ensureColumn(db, tableName, definition) {
  if (typeof db.all !== 'function') {
    return;
  }

  const columnName = String(definition || '').trim().split(/\s+/)[0];
  if (!columnName) {
    return;
  }

  const columns = db.all(`PRAGMA table_info(${tableName})`);
  if (columns.some((column) => String(column?.name || '').trim() === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

function parseJson(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeConfigState(state, normalizeState) {
  const normalized = normalizeState(state);
  return {
    profiles: normalized.profiles,
    defaultProfileId: normalized.defaultProfileId,
    assets: normalized.assets,
    mappingRules: normalized.mappingRules,
    providers: normalized.providers,
    integrationPreferences: normalized.integrationPreferences
  };
}

function upsertAppState(db, payload, updatedAt) {
  const existing = db.get('SELECT id FROM app_state WHERE id = $id', { $id: GLOBAL_STATE_ID });
  const params = {
    $id: GLOBAL_STATE_ID,
    $data: payload,
    $updatedAt: updatedAt
  };

  if (existing) {
    db.run('UPDATE app_state SET data_json = $data, updated_at = $updatedAt WHERE id = $id', params);
    return;
  }

  db.run('INSERT INTO app_state (id, data_json, updated_at) VALUES ($id, $data, $updatedAt)', params);
}

function getTableCount(db, tableName) {
  const row = db.get(`SELECT COUNT(*) AS row_count FROM ${tableName}`);
  return Number(row?.row_count || 0);
}

function normalizeHistoryEntry(entry = {}) {
  return {
    id: String(entry.id || '').trim(),
    requestId: String(entry.requestId || '').trim(),
    projectId: String(entry.projectId || '').trim(),
    subject: String(entry.subject || '').trim(),
    providerId: String(entry.providerId || '').trim(),
    providerName: String(entry.providerName || '').trim(),
    model: String(entry.model || '').trim(),
    status: String(entry.status || '').trim(),
    submittedAt: String(entry.submittedAt || '').trim(),
    completedAt: String(entry.completedAt || '').trim(),
    payload: entry
  };
}

function insertHistoryEntry(db, entry) {
  const normalized = normalizeHistoryEntry(entry);
  if (!normalized.id) {
    return;
  }

  db.run(`
    INSERT OR REPLACE INTO translation_history (
      id, request_id, project_id, subject, provider_id, provider_name, model_name, status, submitted_at, completed_at, entry_json
    ) VALUES (
      $id, $requestId, $projectId, $subject, $providerId, $providerName, $modelName, $status, $submittedAt, $completedAt, $entryJson
    )
  `, {
    $id: normalized.id,
    $requestId: normalized.requestId,
    $projectId: normalized.projectId,
    $subject: normalized.subject,
    $providerId: normalized.providerId,
    $providerName: normalized.providerName,
    $modelName: normalized.model,
    $status: normalized.status,
    $submittedAt: normalized.submittedAt,
    $completedAt: normalized.completedAt,
    $entryJson: JSON.stringify(normalized.payload)
  });

  db.run('DELETE FROM translation_history_segments WHERE history_id = $historyId', {
    $historyId: normalized.id
  });

  const segments = Array.isArray(normalized.payload?.segments) ? normalized.payload.segments : [];
  segments.forEach((segment, index) => {
    db.run(`
      INSERT OR REPLACE INTO translation_history_segments (
        id, history_id, segment_index, source_text, target_text, segment_json
      ) VALUES (
        $id, $historyId, $segmentIndex, $sourceText, $targetText, $segmentJson
      )
    `, {
      $id: String(segment?.id || `${normalized.id}:${index}`),
      $historyId: normalized.id,
      $segmentIndex: Number.isFinite(Number(segment?.index)) ? Number(segment.index) : index,
      $sourceText: String(segment?.sourceText || ''),
      $targetText: String(segment?.targetText || ''),
      $segmentJson: JSON.stringify(segment || {})
    });
  });
}

function trimHistory(db, limit = HISTORY_LIMIT) {
  const rows = db.all(`
    SELECT id
    FROM translation_history
    ORDER BY submitted_at DESC, completed_at DESC, id DESC
  `);
  const staleRows = rows.slice(limit);

  staleRows.forEach((row) => {
    db.run('DELETE FROM translation_history_segments WHERE history_id = $historyId', {
      $historyId: row.id
    });
    db.run('DELETE FROM translation_history WHERE id = $id', {
      $id: row.id
    });
  });
}

function listHistoryEntries(db) {
  return db.all(`
    SELECT entry_json
    FROM translation_history
    ORDER BY submitted_at DESC, completed_at DESC, id DESC
  `)
    .map((row) => parseJson(row?.entry_json, null))
    .filter(Boolean);
}

function readCacheEntry(db, tableName, key) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return '';
  }
  const row = db.get(`SELECT text_value FROM ${tableName} WHERE cache_key = $key`, { $key: normalizedKey });
  return row ? String(row.text_value || '') : '';
}

function writeCacheEntry(db, tableName, key, text, updatedAt, limit) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return null;
  }

  const nextEntry = {
    key: normalizedKey,
    text: String(text || ''),
    updatedAt: String(updatedAt || '')
  };

  db.transaction(() => {
    db.run(`
      INSERT OR REPLACE INTO ${tableName} (cache_key, text_value, updated_at)
      VALUES ($key, $text, $updatedAt)
    `, {
      $key: nextEntry.key,
      $text: nextEntry.text,
      $updatedAt: nextEntry.updatedAt
    });

    const staleRows = db.all(`
      SELECT cache_key
      FROM ${tableName}
      ORDER BY updated_at DESC, cache_key DESC
    `).slice(limit);

    staleRows.forEach((row) => {
      db.run(`DELETE FROM ${tableName} WHERE cache_key = $key`, {
        $key: row.cache_key
      });
    });
  });

  return nextEntry;
}

function normalizeLegacyHistoryEntries(entries = []) {
  const seen = new Set();
  const nextEntries = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    const id = String(entry?.id || '').trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    nextEntries.push(entry);
    if (nextEntries.length >= HISTORY_LIMIT) {
      break;
    }
  }

  return nextEntries;
}

function normalizeLegacyCacheEntries(entries = [], limit = 0) {
  const seen = new Set();
  const nextEntries = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = String(entry?.key || '').trim();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    nextEntries.push({
      key,
      text: String(entry?.text || ''),
      updatedAt: String(entry?.updatedAt || '')
    });

    if (limit > 0 && nextEntries.length >= limit) {
      break;
    }
  }

  return nextEntries;
}

function createRuntimePersistence(db, { nowIso, normalizeState }) {
  function saveConfigState(state) {
    const normalized = normalizeConfigState(state, normalizeState);
    const payload = JSON.stringify(normalized);
    upsertAppState(db, payload, nowIso());
    return normalized;
  }

  function loadConfigState() {
    const row = db.get('SELECT data_json FROM app_state WHERE id = $id', { $id: GLOBAL_STATE_ID });
    if (!row) {
      return saveConfigState(createInitialState());
    }

    return normalizeConfigState(parseJson(row.data_json, createInitialState()), normalizeState);
  }

  function migrateLegacyState() {
    const row = db.get('SELECT data_json FROM app_state WHERE id = $id', { $id: GLOBAL_STATE_ID });
    if (!row) {
      saveConfigState(createInitialState());
      return;
    }

    const normalized = normalizeState(parseJson(row.data_json, createInitialState()));
    const configState = normalizeConfigState(normalized, normalizeState);
    const legacyHistory = normalizeLegacyHistoryEntries(normalized.history);
    const legacyTranslationCache = normalizeLegacyCacheEntries(normalized.translationCache, TRANSLATION_CACHE_LIMIT);
    const legacyPromptResponseCache = normalizeLegacyCacheEntries(normalized.promptResponseCache, PROMPT_RESPONSE_CACHE_LIMIT);
    const legacyDocumentSummaryCache = normalizeLegacyCacheEntries(normalized.documentSummaryCache, DOCUMENT_SUMMARY_CACHE_LIMIT);
    const historyTableEmpty = getTableCount(db, 'translation_history') === 0;
    const translationCacheTableEmpty = getTableCount(db, 'translation_cache') === 0;
    const promptResponseCacheTableEmpty = getTableCount(db, 'prompt_response_cache') === 0;
    const documentSummaryCacheTableEmpty = getTableCount(db, 'document_summary_cache') === 0;
    const normalizedPayload = JSON.stringify(configState);
    const needsConfigRewrite = normalizedPayload !== row.data_json;
    const needsImport = (
      (historyTableEmpty && legacyHistory.length)
      || (translationCacheTableEmpty && legacyTranslationCache.length)
      || (promptResponseCacheTableEmpty && legacyPromptResponseCache.length)
      || (documentSummaryCacheTableEmpty && legacyDocumentSummaryCache.length)
    );

    if (!needsImport && !needsConfigRewrite) {
      return;
    }

    db.transaction(() => {
      if (historyTableEmpty) {
        legacyHistory.forEach((entry) => insertHistoryEntry(db, entry));
        trimHistory(db, HISTORY_LIMIT);
      }

      if (translationCacheTableEmpty) {
        legacyTranslationCache.forEach((entry) => {
          db.run(`
            INSERT OR REPLACE INTO translation_cache (cache_key, text_value, updated_at)
            VALUES ($key, $text, $updatedAt)
          `, {
            $key: entry.key,
            $text: entry.text,
            $updatedAt: entry.updatedAt || nowIso()
          });
        });
      }

      if (promptResponseCacheTableEmpty) {
        legacyPromptResponseCache.forEach((entry) => {
          db.run(`
            INSERT OR REPLACE INTO prompt_response_cache (cache_key, text_value, updated_at)
            VALUES ($key, $text, $updatedAt)
          `, {
            $key: entry.key,
            $text: entry.text,
            $updatedAt: entry.updatedAt || nowIso()
          });
        });
      }

      if (documentSummaryCacheTableEmpty) {
        legacyDocumentSummaryCache.forEach((entry) => {
          db.run(`
            INSERT OR REPLACE INTO document_summary_cache (cache_key, text_value, updated_at)
            VALUES ($key, $text, $updatedAt)
          `, {
            $key: entry.key,
            $text: entry.text,
            $updatedAt: entry.updatedAt || nowIso()
          });
        });
      }

      upsertAppState(db, normalizedPayload, nowIso());
    });
  }

  return {
    loadConfigState,
    saveConfigState,
    migrateLegacyState,
    listHistory() {
      return listHistoryEntries(db);
    },
    appendHistoryEntry(entry) {
      db.transaction(() => {
        insertHistoryEntry(db, entry);
        trimHistory(db, HISTORY_LIMIT);
      });
      return entry;
    },
    readTranslationCache(key) {
      return readCacheEntry(db, 'translation_cache', key);
    },
    writeTranslationCache(key, text, updatedAt = nowIso()) {
      return writeCacheEntry(db, 'translation_cache', key, text, updatedAt, TRANSLATION_CACHE_LIMIT);
    },
    readPromptResponseCache(key) {
      return readCacheEntry(db, 'prompt_response_cache', key);
    },
    writePromptResponseCache(key, text, updatedAt = nowIso()) {
      return writeCacheEntry(db, 'prompt_response_cache', key, text, updatedAt, PROMPT_RESPONSE_CACHE_LIMIT);
    },
    readDocumentSummaryCache(key) {
      return readCacheEntry(db, 'document_summary_cache', key);
    },
    writeDocumentSummaryCache(key, text, updatedAt = nowIso()) {
      return writeCacheEntry(db, 'document_summary_cache', key, text, updatedAt, DOCUMENT_SUMMARY_CACHE_LIMIT);
    }
  };
}

module.exports = {
  createSchema,
  createInitialState,
  createRuntimePersistence
};
