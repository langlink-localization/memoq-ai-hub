const HISTORY_LIMIT = 500;
const TRANSLATION_CACHE_LIMIT = 2000;
const PROMPT_RESPONSE_CACHE_LIMIT = 500;
const DOCUMENT_SUMMARY_CACHE_LIMIT = 300;
const GLOBAL_STATE_ID = 'global';
const QA_RETENTION_DAYS = 30;

// Bump SCHEMA_VERSION and append a matching entry to SCHEMA_MIGRATIONS for every
// change to existing tables. Fresh databases run createSchema() (always the full
// current shape) and then replay pending migrations harmlessly; databases created
// before user_version tracking start at 0 and receive every migration in order.
const SCHEMA_VERSION = 1;

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
    CREATE TABLE IF NOT EXISTS translation_history (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      project_id TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      provider_id TEXT DEFAULT '',
      provider_name TEXT DEFAULT '',
      model_name TEXT DEFAULT '',
      status TEXT DEFAULT '',
      submitted_at TEXT DEFAULT '',
      completed_at TEXT DEFAULT '',
      entry_json TEXT DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS translation_history_segments (
      id TEXT PRIMARY KEY,
      history_id TEXT NOT NULL,
      segment_index INTEGER DEFAULT 0,
      source_text TEXT DEFAULT '',
      target_text TEXT DEFAULT '',
      segment_json TEXT DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS translation_cache (cache_key TEXT PRIMARY KEY, text_value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS prompt_response_cache (cache_key TEXT PRIMARY KEY, text_value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS document_summary_cache (cache_key TEXT PRIMARY KEY, text_value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS qa_results (
      request_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS qa_results_document_idx ON qa_results (document_id, updated_at);
    CREATE TABLE IF NOT EXISTS qa_feedback (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      finding_id TEXT NOT NULL,
      feedback_state TEXT NOT NULL,
      feedback_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

const SCHEMA_MIGRATIONS = [
  {
    version: 1,
    name: 'baseline-history-and-segment-columns',
    up(db) {
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
  }
];

function readUserVersion(db) {
  const row = db.get('PRAGMA user_version');
  const version = Number(row?.user_version ?? row?.value ?? 0);
  return Number.isInteger(version) && version > 0 ? version : 0;
}

function writeUserVersion(db, version) {
  db.exec(`PRAGMA user_version = ${Number(version)}`);
}

function applySchemaMigrations(db) {
  const tableRow = db.get(
    "SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  const isFreshDatabase = Number(tableRow?.table_count || 0) === 0;

  createSchema(db);
  const currentVersion = readUserVersion(db);

  if (currentVersion > SCHEMA_VERSION) {
    const error = new Error(
      `Desktop database schema version ${currentVersion} is newer than this app supports (${SCHEMA_VERSION}).`
    );
    error.code = 'SCHEMA_VERSION_TOO_NEW';
    throw error;
  }

  if (isFreshDatabase) {
    writeUserVersion(db, SCHEMA_VERSION);
    return { migrated: false, fromVersion: 0, toVersion: SCHEMA_VERSION };
  }

  const pendingMigrations = SCHEMA_MIGRATIONS.filter(
    (migration) => migration.version > currentVersion && migration.version <= SCHEMA_VERSION
  );

  if (!pendingMigrations.length) {
    if (currentVersion !== SCHEMA_VERSION) {
      writeUserVersion(db, SCHEMA_VERSION);
    }
    return { migrated: false, fromVersion: currentVersion, toVersion: SCHEMA_VERSION };
  }

  db.transaction(() => {
    for (const migration of pendingMigrations) {
      migration.up(db);
      writeUserVersion(db, migration.version);
    }
  });

  return { migrated: true, fromVersion: currentVersion, toVersion: SCHEMA_VERSION };
}

function createInitialState() {
  return {
    profiles: [],
    defaultProfileId: '',
    assets: [],
    mappingRules: [],
    providers: [],
    promptPresets: [],
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
    promptPresets: normalized.promptPresets,
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

function getHistoryEntry(db, entryId) {
  const normalizedId = String(entryId || '').trim();
  if (!normalizedId) {
    return null;
  }
  const row = db.get(`
    SELECT entry_json
    FROM translation_history
    WHERE id = $id
  `, {
    $id: normalizedId
  });
  return parseJson(row?.entry_json, null);
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

function clearCacheTable(db, tableName) {
  const clearedCount = getTableCount(db, tableName);
  db.run(`DELETE FROM ${tableName}`);
  return { clearedCount };
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

function buildQaHistoryItem(row, result) {
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const severityCounts = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const finding of findings) {
    if (Object.prototype.hasOwnProperty.call(severityCounts, finding?.severity)) {
      severityCounts[finding.severity] += 1;
    }
  }
  const execution = result.execution || {};
  const segment = result.segment || {};
  const languages = result.languages || {};
  return {
    requestId: String(result.requestId || row.request_id || ''),
    documentId: String(result.document?.id || row.document_id || ''),
    documentName: String(result.document?.name || ''),
    trigger: String(result.trigger || 'manual'),
    status: String(result.status || row.status || 'complete'),
    contentHash: String(result.contentHash || row.content_hash || ''),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    expiresAt: String(row.expires_at || ''),
    segment: {
      previewPartId: String(segment.previewPartId || ''),
      source: String(segment.source || '').slice(0, 120),
      target: String(segment.target || '').slice(0, 120),
      languages: {
        source: String(languages.source || ''),
        target: String(languages.target || '')
      }
    },
    findingCounts: { ...severityCounts, total: findings.length },
    execution: {
      deterministicStatus: String(execution.deterministic?.status || ''),
      deterministicDurationMs: Number(execution.deterministic?.durationMs ?? 0),
      aiStatus: String(execution.ai?.status || ''),
      aiModel: String(execution.ai?.model || ''),
      aiProviderName: String(execution.ai?.providerName || ''),
      aiDurationMs: Number(execution.ai?.durationMs ?? 0)
    }
  };
}

function createRuntimePersistence(db, { nowIso, normalizeState }) {
  function pruneQaData(referenceTime = new Date()) {
    const referenceIso = referenceTime instanceof Date ? referenceTime.toISOString() : String(referenceTime || nowIso());
    db.run('DELETE FROM qa_results WHERE expires_at <= $referenceIso', { $referenceIso: referenceIso });
    db.run(`
      DELETE FROM qa_feedback
      WHERE request_id NOT IN (SELECT request_id FROM qa_results)
    `);
  }

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
    getHistoryEntry(entryId) {
      return getHistoryEntry(db, entryId);
    },
    deleteHistoryEntries(entryIds = []) {
      const normalizedIds = Array.from(new Set(
        (Array.isArray(entryIds) ? entryIds : [])
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      ));

      if (!normalizedIds.length) {
        return { deletedCount: 0 };
      }

      db.transaction(() => {
        normalizedIds.forEach((entryId) => {
          db.run('DELETE FROM translation_history_segments WHERE history_id = $historyId', {
            $historyId: entryId
          });
          db.run('DELETE FROM translation_history WHERE id = $id', {
            $id: entryId
          });
        });
      });

      return { deletedCount: normalizedIds.length };
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
    clearTranslationCache() {
      return clearCacheTable(db, 'translation_cache');
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
    },
    saveQaResult(result, retentionDays = QA_RETENTION_DAYS) {
      const requestId = String(result?.requestId || '').trim();
      const documentId = String(result?.document?.id || result?.documentId || '').trim();
      const contentHash = String(result?.contentHash || '').trim();
      if (!requestId || !documentId || !contentHash) {
        throw new Error('QA result requires requestId, documentId, and contentHash.');
      }
      const timestamp = nowIso();
      const expiresAt = new Date(Date.parse(timestamp) + Math.max(1, Number(retentionDays) || QA_RETENTION_DAYS) * 86400000).toISOString();
      db.run(`
        INSERT OR REPLACE INTO qa_results (
          request_id, document_id, content_hash, status, result_json, created_at, updated_at, expires_at
        ) VALUES (
          $requestId, $documentId, $contentHash, $status, $resultJson,
          COALESCE((SELECT created_at FROM qa_results WHERE request_id = $requestId), $timestamp),
          $timestamp, $expiresAt
        )
      `, {
        $requestId: requestId,
        $documentId: documentId,
        $contentHash: contentHash,
        $status: String(result?.status || 'complete'),
        $resultJson: JSON.stringify(result),
        $timestamp: timestamp,
        $expiresAt: expiresAt
      });
      pruneQaData(new Date(timestamp));
      return result;
    },
    listQaResults(documentId) {
      pruneQaData();
      const normalizedDocumentId = String(documentId || '').trim();
      if (!normalizedDocumentId) return [];
      return db.all(`
        SELECT result_json FROM qa_results
        WHERE document_id = $documentId
        ORDER BY updated_at DESC, request_id DESC
      `, { $documentId: normalizedDocumentId })
        .map((row) => parseJson(row?.result_json, null))
        .filter(Boolean);
    },
    listQaResultsAll(filters = {}) {
      pruneQaData();
      const documentId = String(filters.documentId || '').trim();
      const trigger = String(filters.trigger || '').trim();
      const status = String(filters.status || '').trim();
      const dateFrom = String(filters.dateFrom || '').trim();
      const dateTo = String(filters.dateTo || '').trim();
      const limit = Math.max(1, Math.min(500, Number(filters.limit) || 200));

      const rows = documentId
        ? db.all(`
            SELECT * FROM qa_results WHERE document_id = $documentId
            ORDER BY updated_at DESC LIMIT 500
          `, { $documentId: documentId })
        : db.all('SELECT * FROM qa_results ORDER BY updated_at DESC LIMIT 500');

      const items = [];
      for (const row of rows) {
        const result = parseJson(row?.result_json, null);
        if (!result) {
          continue;
        }
        if (trigger && String(result.trigger || 'manual') !== trigger) {
          continue;
        }
        if (status && String(row.status || 'complete') !== status) {
          continue;
        }
        if (dateFrom && String(row.updated_at || '') < dateFrom) {
          continue;
        }
        if (dateTo && String(row.updated_at || '') > dateTo) {
          continue;
        }
        items.push(buildQaHistoryItem(row, result));
        if (items.length >= limit) {
          break;
        }
      }
      return items;
    },
    readQaResult(requestId) {
      const normalizedRequestId = String(requestId || '').trim();
      if (!normalizedRequestId) return null;
      const row = db.get('SELECT result_json FROM qa_results WHERE request_id = $requestId', {
        $requestId: normalizedRequestId
      });
      return parseJson(row?.result_json, null);
    },
    listQaFeedback(requestId) {
      const normalizedRequestId = String(requestId || '').trim();
      if (!normalizedRequestId) return [];
      return db.all(
        'SELECT feedback_json FROM qa_feedback WHERE request_id = $requestId ORDER BY created_at ASC',
        { $requestId: normalizedRequestId }
      )
        .map((row) => parseJson(row?.feedback_json, null))
        .filter(Boolean);
    },
    deleteQaResults(requestIds = []) {
      const ids = [...new Set((Array.isArray(requestIds) ? requestIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean))];
      if (!ids.length) {
        return { deletedCount: 0 };
      }
      let deletedCount = 0;
      db.transaction(() => {
        for (const id of ids) {
          deletedCount += db.run('DELETE FROM qa_results WHERE request_id = $requestId', { $requestId: id });
          db.run('DELETE FROM qa_feedback WHERE request_id = $requestId', { $requestId: id });
        }
      });
      return { deletedCount };
    },
    saveQaFeedback(feedback) {
      const id = String(feedback?.id || '').trim();
      const requestId = String(feedback?.requestId || '').trim();
      const findingId = String(feedback?.findingId || '').trim();
      const feedbackState = String(feedback?.state || '').trim();
      if (!id || !requestId || !findingId || !feedbackState) {
        throw new Error('QA feedback requires id, requestId, findingId, and state.');
      }
      db.run(`
        INSERT OR REPLACE INTO qa_feedback (
          id, request_id, finding_id, feedback_state, feedback_json, created_at
        ) VALUES ($id, $requestId, $findingId, $feedbackState, $feedbackJson, $createdAt)
      `, {
        $id: id,
        $requestId: requestId,
        $findingId: findingId,
        $feedbackState: feedbackState,
        $feedbackJson: JSON.stringify(feedback),
        $createdAt: nowIso()
      });
      return feedback;
    },
    pruneQaData
  };
}

module.exports = {
  applySchemaMigrations,
  createSchema,
  createInitialState,
  createRuntimePersistence,
  SCHEMA_VERSION,
  QA_RETENTION_DAYS
};
