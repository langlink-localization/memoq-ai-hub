const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const { formatTimestampForLocalDisplay } = require('../src/shared/timeFormatting');

const runtimeModulePath = require.resolve('../src/runtime/runtime');

class DefaultOpenAI {
  constructor() {
    this.responses = { create: async () => ({ output_text: 'OK' }) };
    this.chat = {
      completions: {
        create: async () => ({ choices: [{ message: { content: 'OK' } }] })
      }
    };
    this.models = { list: async () => ({ data: [] }) };
  }
}

DefaultOpenAI.OpenAI = DefaultOpenAI;
DefaultOpenAI.default = DefaultOpenAI;

class MockXmlParser {
  parse(xml) {
    const entryMatch = xml.match(/<termEntry[^>]*id="([^"]+)"[\s\S]*?<langSet[^>]*xml:lang="([^"]+)"[\s\S]*?<term>([^<]+)<\/term>[\s\S]*?<langSet[^>]*xml:lang="([^"]+)"[\s\S]*?<term>([^<]+)<\/term>/i);
    if (!entryMatch) {
      return { tbx: { text: { body: { termEntry: [] } } } };
    }
    return {
      tbx: {
        text: {
          body: {
            termEntry: {
              '@_id': entryMatch[1],
              langSet: [
                { '@_lang': entryMatch[2], tig: { term: entryMatch[3] } },
                { '@_lang': entryMatch[4], tig: { term: entryMatch[5] } }
              ]
            }
          }
        }
      }
    };
  }
}

function formatLocalDateFilter(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function createMockDatabaseModule(options = {}) {
  function buildCacheMap(rows = []) {
    return new Map((Array.isArray(rows) ? rows : []).map((row) => [
      String(row?.cache_key || row?.key || ''),
      {
        cache_key: String(row?.cache_key || row?.key || ''),
        text_value: String(row?.text_value || row?.text || ''),
        updated_at: String(row?.updated_at || row?.updatedAt || '')
      }
    ]).filter(([key]) => key));
  }

  const store = {
    appStateRow: options.appState
      ? {
        id: 'global',
        data_json: typeof options.appState === 'string' ? options.appState : JSON.stringify(options.appState),
        updated_at: String(options.updatedAt || '2026-03-26T00:00:00.000Z')
      }
      : null,
    historyRows: new Map((Array.isArray(options.historyRows) ? options.historyRows : []).map((row) => [
      String(row?.id || ''),
      {
        id: String(row?.id || ''),
        request_id: String(row?.request_id || row?.requestId || ''),
        project_id: String(row?.project_id || row?.projectId || ''),
        subject: String(row?.subject || ''),
        provider_id: String(row?.provider_id || row?.providerId || ''),
        provider_name: String(row?.provider_name || row?.providerName || ''),
        model_name: String(row?.model_name || row?.model || ''),
        status: String(row?.status || ''),
        submitted_at: String(row?.submitted_at || row?.submittedAt || ''),
        completed_at: String(row?.completed_at || row?.completedAt || ''),
        entry_json: typeof row?.entry_json === 'string' ? row.entry_json : JSON.stringify(row?.entry_json || row?.payload || {})
      }
    ]).filter(([id]) => id)),
    historySegmentRows: new Map((Array.isArray(options.historySegmentRows) ? options.historySegmentRows : []).map((row) => [
      String(row?.id || ''),
      {
        id: String(row?.id || ''),
        history_id: String(row?.history_id || row?.historyId || ''),
        segment_index: Number.isFinite(Number(row?.segment_index ?? row?.segmentIndex)) ? Number(row.segment_index ?? row.segmentIndex) : 0,
        source_text: String(row?.source_text || row?.sourceText || ''),
        target_text: String(row?.target_text || row?.targetText || ''),
        segment_json: typeof row?.segment_json === 'string' ? row.segment_json : JSON.stringify(row?.segment_json || row?.payload || {})
      }
    ]).filter(([id]) => id)),
    translationCacheRows: buildCacheMap(options.translationCacheRows),
    promptResponseCacheRows: buildCacheMap(options.promptResponseCacheRows),
    documentSummaryCacheRows: buildCacheMap(options.documentSummaryCacheRows),
    closeCalls: 0,
    runCalls: [],
    execCalls: []
  };

  function sortHistoryRows() {
    return Array.from(store.historyRows.values()).sort((left, right) => (
      String(right.submitted_at || '').localeCompare(String(left.submitted_at || ''))
      || String(right.completed_at || '').localeCompare(String(left.completed_at || ''))
      || String(right.id || '').localeCompare(String(left.id || ''))
    ));
  }

  function getCacheRows(tableName) {
    if (tableName === 'translation_cache') {
      return store.translationCacheRows;
    }
    if (tableName === 'prompt_response_cache') {
      return store.promptResponseCacheRows;
    }
    if (tableName === 'document_summary_cache') {
      return store.documentSummaryCacheRows;
    }
    return new Map();
  }

  function sortCacheRows(tableName) {
    return Array.from(getCacheRows(tableName).values()).sort((left, right) => (
      String(right.updated_at || '').localeCompare(String(left.updated_at || ''))
      || String(right.cache_key || '').localeCompare(String(left.cache_key || ''))
    ));
  }

  const database = {
    exec(sql) {
      store.execCalls.push(String(sql || ''));
    },
    all(sql) {
      const text = String(sql || '');
      if (text.includes('PRAGMA table_info(')) {
        return [];
      }
      if (text.includes('SELECT entry_json') && text.includes('FROM translation_history')) {
        return sortHistoryRows().map((row) => ({ entry_json: row.entry_json }));
      }
      if (text.includes('SELECT id') && text.includes('FROM translation_history')) {
        return sortHistoryRows().map((row) => ({ id: row.id }));
      }
      if (text.includes('SELECT cache_key') && text.includes('FROM translation_cache')) {
        return sortCacheRows('translation_cache').map((row) => ({ cache_key: row.cache_key }));
      }
      if (text.includes('SELECT cache_key') && text.includes('FROM prompt_response_cache')) {
        return sortCacheRows('prompt_response_cache').map((row) => ({ cache_key: row.cache_key }));
      }
      if (text.includes('SELECT cache_key') && text.includes('FROM document_summary_cache')) {
        return sortCacheRows('document_summary_cache').map((row) => ({ cache_key: row.cache_key }));
      }
      return [];
    },
    get(sql, params = {}) {
      const text = String(sql || '');
      if (text.includes('SELECT data_json FROM app_state')) {
        return store.appStateRow ? { data_json: store.appStateRow.data_json } : null;
      }
      if (text.includes('SELECT id FROM app_state')) {
        return store.appStateRow && store.appStateRow.id === params.$id ? { id: store.appStateRow.id } : null;
      }
      if (text.includes('SELECT COUNT(*) AS row_count FROM translation_history')) {
        return { row_count: store.historyRows.size };
      }
      if (text.includes('SELECT COUNT(*) AS row_count FROM translation_cache')) {
        return { row_count: store.translationCacheRows.size };
      }
      if (text.includes('SELECT COUNT(*) AS row_count FROM prompt_response_cache')) {
        return { row_count: store.promptResponseCacheRows.size };
      }
      if (text.includes('SELECT COUNT(*) AS row_count FROM document_summary_cache')) {
        return { row_count: store.documentSummaryCacheRows.size };
      }
      if (text.includes('SELECT text_value FROM translation_cache')) {
        const row = store.translationCacheRows.get(params.$key);
        return row ? { text_value: row.text_value } : null;
      }
      if (text.includes('SELECT text_value FROM prompt_response_cache')) {
        const row = store.promptResponseCacheRows.get(params.$key);
        return row ? { text_value: row.text_value } : null;
      }
      if (text.includes('SELECT text_value FROM document_summary_cache')) {
        const row = store.documentSummaryCacheRows.get(params.$key);
        return row ? { text_value: row.text_value } : null;
      }
      return null;
    },
    run(sql, params = {}) {
      const text = String(sql || '');
      store.runCalls.push({ sql: text, params });
      if (text.includes('INSERT INTO app_state') || text.includes('UPDATE app_state SET data_json')) {
        store.appStateRow = {
          id: params.$id,
          data_json: params.$data,
          updated_at: params.$updatedAt
        };
        return 1;
      }
      if (text.includes('DELETE FROM translation_history_segments WHERE history_id = $historyId')) {
        for (const [id, row] of Array.from(store.historySegmentRows.entries())) {
          if (row.history_id === params.$historyId) {
            store.historySegmentRows.delete(id);
          }
        }
        return 1;
      }
      if (text.includes('INSERT OR REPLACE INTO translation_history_segments')) {
        store.historySegmentRows.set(params.$id, {
          id: params.$id,
          history_id: params.$historyId,
          segment_index: params.$segmentIndex,
          source_text: params.$sourceText,
          target_text: params.$targetText,
          segment_json: params.$segmentJson
        });
        return 1;
      }
      if (text.includes('INSERT OR REPLACE INTO translation_history')) {
        store.historyRows.set(params.$id, {
          id: params.$id,
          request_id: params.$requestId,
          project_id: params.$projectId,
          subject: params.$subject,
          provider_id: params.$providerId,
          provider_name: params.$providerName,
          model_name: params.$modelName,
          status: params.$status,
          submitted_at: params.$submittedAt,
          completed_at: params.$completedAt,
          entry_json: params.$entryJson
        });
        return 1;
      }
      if (text.includes('DELETE FROM translation_history WHERE id = $id')) {
        store.historyRows.delete(params.$id);
        return 1;
      }
      if (text.includes('INSERT OR REPLACE INTO translation_cache')) {
        store.translationCacheRows.set(params.$key, {
          cache_key: params.$key,
          text_value: params.$text,
          updated_at: params.$updatedAt
        });
        return 1;
      }
      if (text.includes('INSERT OR REPLACE INTO prompt_response_cache')) {
        store.promptResponseCacheRows.set(params.$key, {
          cache_key: params.$key,
          text_value: params.$text,
          updated_at: params.$updatedAt
        });
        return 1;
      }
      if (text.includes('INSERT OR REPLACE INTO document_summary_cache')) {
        store.documentSummaryCacheRows.set(params.$key, {
          cache_key: params.$key,
          text_value: params.$text,
          updated_at: params.$updatedAt
        });
        return 1;
      }
      if (text.includes('DELETE FROM translation_cache WHERE cache_key = $key')) {
        store.translationCacheRows.delete(params.$key);
        return 1;
      }
      if (text.includes('DELETE FROM translation_cache')) {
        store.translationCacheRows.clear();
        return 1;
      }
      if (text.includes('DELETE FROM prompt_response_cache WHERE cache_key = $key')) {
        store.promptResponseCacheRows.delete(params.$key);
        return 1;
      }
      if (text.includes('DELETE FROM document_summary_cache WHERE cache_key = $key')) {
        store.documentSummaryCacheRows.delete(params.$key);
        return 1;
      }
      return 1;
    },
    transaction(callback) {
      return callback();
    },
    close() {
      store.closeCalls += 1;
    }
  };

  return {
    __store: store,
    createDatabase: async () => database
  };
}

function createRuntime(options = {}) {
  const originalLoad = Module._load;
  const databaseModule = createMockDatabaseModule(options.__databaseState || {});
  if (options.__databaseCapture && typeof options.__databaseCapture === 'object') {
    options.__databaseCapture.store = databaseModule.__store;
  }
  delete require.cache[runtimeModulePath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'openai') {
      return DefaultOpenAI;
    }
    if (request === './database' || request === '../database') {
      return databaseModule;
    }
    if (request === './secretStore' || request === '../secretStore') {
      return {
        createSecretStore: () => {
          const values = new Map();
          return {
            has(id) {
              return values.has(id);
            },
            get(id) {
              return values.get(id) || '';
            },
            set(id, value) {
              values.set(id, String(value || ''));
            },
            delete(id) {
              values.delete(id);
            }
          };
        }
      };
    }
    if (request === 'xlsx') {
      return {
        readFile: () => ({ SheetNames: [], Sheets: {} }),
        utils: {
          sheet_to_json: () => [],
          json_to_sheet: (rows) => ({ rows: Array.isArray(rows) ? rows : [] }),
          sheet_to_csv: (sheet) => {
            const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
            if (!rows.length) {
              return '';
            }
            const headers = Object.keys(rows[0]);
            const lines = [
              headers.join(','),
              ...rows.map((row) => headers.map((header) => String(row[header] ?? '')).join(','))
            ];
            return lines.join('\n');
          },
          book_new: () => ({ sheets: [] }),
          book_append_sheet: (workbook, sheet, name) => {
            workbook.sheets.push({ name, sheet });
          }
        },
        writeFile: (workbook, outputPath) => {
          fs.writeFileSync(outputPath, JSON.stringify(workbook), 'utf8');
        }
      };
    }
    if (request === 'fast-xml-parser') {
      return { XMLParser: MockXmlParser };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(runtimeModulePath).createRuntime(options);
  } finally {
    Module._load = originalLoad;
    delete require.cache[runtimeModulePath];
  }
}

function loadRuntimeModule(options = {}) {
  const originalLoad = Module._load;
  const databaseModule = createMockDatabaseModule(options.__databaseState || {});
  if (options.__databaseCapture && typeof options.__databaseCapture === 'object') {
    options.__databaseCapture.store = databaseModule.__store;
  }
  delete require.cache[runtimeModulePath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'openai') {
      return DefaultOpenAI;
    }
    if (request === './database' || request === '../database') {
      return databaseModule;
    }
    if (request === './secretStore' || request === '../secretStore') {
      return {
        createSecretStore: () => {
          const values = new Map();
          return {
            has(id) {
              return values.has(id);
            },
            get(id) {
              return values.get(id) || '';
            },
            set(id, value) {
              values.set(id, String(value || ''));
            },
            delete(id) {
              values.delete(id);
            }
          };
        }
      };
    }
    if (request === 'xlsx') {
      return {
        readFile: () => ({ SheetNames: [], Sheets: {} }),
        utils: {
          sheet_to_json: () => [],
          json_to_sheet: (rows) => ({ rows: Array.isArray(rows) ? rows : [] }),
          sheet_to_csv: (sheet) => {
            const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
            if (!rows.length) {
              return '';
            }
            const headers = Object.keys(rows[0]);
            const lines = [
              headers.join(','),
              ...rows.map((row) => headers.map((header) => String(row[header] ?? '')).join(','))
            ];
            return lines.join('\n');
          },
          book_new: () => ({ sheets: [] }),
          book_append_sheet: (workbook, sheet, name) => {
            workbook.sheets.push({ name, sheet });
          }
        },
        writeFile: (workbook, outputPath) => {
          fs.writeFileSync(outputPath, JSON.stringify(workbook), 'utf8');
        }
      };
    }
    if (request === 'fast-xml-parser') {
      return { XMLParser: MockXmlParser };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(runtimeModulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[runtimeModulePath];
  }
}
function createTempAppRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-ai-hub-runtime-'));
}

test('runtime starts from empty real state', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async () => ({ text: 'translated', latencyMs: 20 })
      }
    });

    const state = runtime.getAppState();
    assert.equal(state.contextBuilder.profiles.length, 0);
    assert.equal(state.providerHub.providers.length, 0);
    assert.equal(state.historyExplorer.items.length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime migrates legacy blob history and caches into repo-backed tables on startup', async () => {
  const tempRoot = createTempAppRoot();
  const databaseCapture = {};
  const legacyHistoryEntry = {
    id: 'hist_legacy',
    requestId: 'req-legacy',
    providerId: 'provider-1',
    providerName: 'OpenAI',
    model: 'gpt-4.1-mini',
    status: 'success',
    submittedAt: '2026-03-20T00:00:00.000Z',
    completedAt: '2026-03-20T00:00:01.000Z',
    latencyMs: 100,
    attempts: [],
    segments: [
      {
        index: 0,
        sourceText: 'Hello',
        targetText: 'Bonjour',
        tmSource: '',
        tmTarget: ''
      }
    ]
  };

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      __databaseState: {
        appState: {
          profiles: [],
          defaultProfileId: '',
          assets: [],
          mappingRules: [],
          providers: [],
          history: [legacyHistoryEntry],
          translationCache: [{ key: 'translation-key', text: 'Bonjour', updatedAt: '2026-03-20T00:00:02.000Z' }],
          promptResponseCache: [{ key: 'prompt-key', text: 'cached prompt', updatedAt: '2026-03-20T00:00:03.000Z' }],
          documentSummaryCache: [{ key: 'summary-key', text: 'cached summary', updatedAt: '2026-03-20T00:00:04.000Z' }],
          integrationPreferences: {
            memoqVersion: '11',
            customInstallDir: '',
            selectedInstallDir: ''
          }
        }
      },
      __databaseCapture: databaseCapture
    });

    const state = runtime.getAppState();
    const persistedState = JSON.parse(databaseCapture.store.appStateRow.data_json);

    assert.equal(state.historyExplorer.items.length, 1);
    assert.equal(state.historyExplorer.items[0].requestId, 'req-legacy');
    assert.equal(databaseCapture.store.historyRows.size, 1);
    assert.equal(databaseCapture.store.translationCacheRows.size, 1);
    assert.equal(databaseCapture.store.promptResponseCacheRows.size, 1);
    assert.equal(databaseCapture.store.documentSummaryCacheRows.size, 1);
    assert.equal('history' in persistedState, false);
    assert.equal('translationCache' in persistedState, false);
    assert.equal('promptResponseCache' in persistedState, false);
    assert.equal('documentSummaryCache' in persistedState, false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime startup migration is idempotent when history and caches already exist in repo-backed tables', async () => {
  const tempRoot = createTempAppRoot();
  const databaseCapture = {};
  const legacyHistoryEntry = {
    id: 'hist_existing',
    requestId: 'req-existing',
    providerId: 'provider-1',
    providerName: 'OpenAI',
    model: 'gpt-4.1-mini',
    status: 'success',
    submittedAt: '2026-03-21T00:00:00.000Z',
    completedAt: '2026-03-21T00:00:01.000Z',
    latencyMs: 50,
    attempts: [],
    segments: [
      {
        index: 0,
        sourceText: 'World',
        targetText: 'Monde',
        tmSource: '',
        tmTarget: ''
      }
    ]
  };

  try {
    await createRuntime({
      appDataRoot: tempRoot,
      __databaseState: {
        appState: {
          profiles: [],
          defaultProfileId: '',
          assets: [],
          mappingRules: [],
          providers: [],
          history: [legacyHistoryEntry],
          translationCache: [{ key: 'translation-key', text: 'Monde', updatedAt: '2026-03-21T00:00:02.000Z' }],
          promptResponseCache: [{ key: 'prompt-key', text: 'cached prompt', updatedAt: '2026-03-21T00:00:03.000Z' }],
          documentSummaryCache: [{ key: 'summary-key', text: 'cached summary', updatedAt: '2026-03-21T00:00:04.000Z' }],
          integrationPreferences: {
            memoqVersion: '11',
            customInstallDir: '',
            selectedInstallDir: ''
          }
        },
        historyRows: [{
          id: legacyHistoryEntry.id,
          requestId: legacyHistoryEntry.requestId,
          providerId: legacyHistoryEntry.providerId,
          providerName: legacyHistoryEntry.providerName,
          model: legacyHistoryEntry.model,
          status: legacyHistoryEntry.status,
          submittedAt: legacyHistoryEntry.submittedAt,
          completedAt: legacyHistoryEntry.completedAt,
          payload: legacyHistoryEntry
        }],
        translationCacheRows: [{ key: 'translation-key', text: 'Monde', updatedAt: '2026-03-21T00:00:02.000Z' }],
        promptResponseCacheRows: [{ key: 'prompt-key', text: 'cached prompt', updatedAt: '2026-03-21T00:00:03.000Z' }],
        documentSummaryCacheRows: [{ key: 'summary-key', text: 'cached summary', updatedAt: '2026-03-21T00:00:04.000Z' }]
      },
      __databaseCapture: databaseCapture
    });

    const persistedState = JSON.parse(databaseCapture.store.appStateRow.data_json);

    assert.equal(databaseCapture.store.historyRows.size, 1);
    assert.equal(databaseCapture.store.translationCacheRows.size, 1);
    assert.equal(databaseCapture.store.promptResponseCacheRows.size, 1);
    assert.equal(databaseCapture.store.documentSummaryCacheRows.size, 1);
    assert.equal('history' in persistedState, false);
    assert.equal('translationCache' in persistedState, false);
    assert.equal('promptResponseCache' in persistedState, false);
    assert.equal('documentSummaryCache' in persistedState, false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime dispose closes the underlying database handle', async () => {
  const tempRoot = createTempAppRoot();
  const databaseCapture = {};

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      __databaseCapture: databaseCapture
    });

    runtime.dispose();
    assert.equal(databaseCapture.store.closeCalls, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime exposes supported placeholders in app state', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot
    });

    const state = runtime.getAppState();
    assert.ok(Array.isArray(state.contextBuilder.supportedPlaceholders));
    assert.equal(state.contextBuilder.defaultProfileId, '');
    assert.ok(state.contextBuilder.supportedPlaceholders.some((item) => item.token === 'source-text'));
    assert.ok(state.contextBuilder.supportedPlaceholders.some((item) => item.token === 'glossary-text'));
    assert.ok(state.contextBuilder.supportedPlaceholders.some((item) => item.token === 'above-source-text'));
    assert.ok(state.contextBuilder.supportedPlaceholders.some((item) => item.token === 'above-target-text'));
    assert.ok(state.contextBuilder.supportedPlaceholders.some((item) => item.token === 'below-source-text'));
    assert.ok(state.contextBuilder.supportedPlaceholders.some((item) => item.token === 'below-target-text'));
    assert.deepEqual(state.contextBuilder.assetImportRules.brief.extensions, ['.txt', '.md']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime rejects unsupported placeholders when saving a profile', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot
    });

    assert.throws(() => runtime.saveProfile({
      name: 'Invalid Profile',
      userPrompt: '{{unsupported-token}}'
    }), /unsupported placeholder/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime rejects first-release placeholders that are hidden from saved profiles', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot
    });

    assert.throws(() => runtime.saveProfile({
      name: 'Asset Profile',
      userPrompt: '[Glossary:\n]{{glossary-text}}[\nEnd][Brief:\n]{{brief-text}}[\nEnd]\n{{custom-tm-target-text}}'
    }), /first-release profiles cannot use these placeholders/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime strips prompt template fields from saved profiles and keeps translation style as the main prompt control', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot
    });

    const profile = runtime.saveProfile({
      name: 'Template Profile',
      translationStyle: 'Use concise UI wording.',
      promptTemplates: {
        single: {
          systemPrompt: 'Single system {{target-language}}',
          userPrompt: 'Single user {{source-text}}\n{{above-source-text}}\n{{below-target-text}}'
        },
        batch: {
          systemPrompt: 'Batch system {{target-language}}',
          userPrompt: 'Batch user {{source-text}}'
        }
      }
    });

    assert.equal(profile.translationStyle, 'Use concise UI wording.');
    assert.equal('systemPrompt' in profile, false);
    assert.equal('userPrompt' in profile, false);
    assert.equal('promptTemplates' in profile, false);

    const state = runtime.getAppState();
    assert.equal(state.contextBuilder.profiles[0].translationStyle, 'Use concise UI wording.');
    assert.equal('promptTemplates' in state.contextBuilder.profiles[0], false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime applies source-first preview defaults when saving a minimal profile', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot
    });

    const profile = runtime.saveProfile({
      name: 'Preview Defaults',
      translationStyle: 'Use concise UI wording.'
    });

    assert.equal(profile.translationStyle, 'Use concise UI wording.');
    assert.equal(profile.usePreviewFullText, false);
    assert.equal(profile.previewAboveIncludeSource, true);
    assert.equal(profile.previewAboveIncludeTarget, false);
    assert.equal(profile.previewBelowIncludeSource, true);
    assert.equal(profile.previewBelowIncludeTarget, false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime tracks and clears default profile selection', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot
    });

    const first = runtime.saveProfile({ name: 'First Profile' });
    const second = runtime.saveProfile({ name: 'Second Profile' });
    runtime.setDefaultProfile(second.id);

    let state = runtime.getAppState();
    assert.equal(state.contextBuilder.defaultProfileId, second.id);

    runtime.deleteProfile(second.id);

    state = runtime.getAppState();
    assert.equal(state.contextBuilder.defaultProfileId, '');
    assert.deepEqual(state.contextBuilder.profiles.map((item) => item.id), [first.id]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime maps role-based asset selections into legacy asset bindings', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot
    });

    const profile = runtime.saveProfile({
      name: 'Asset Selection Profile',
      assetSelections: {
        glossaryAssetId: 'asset-glossary',
        customTmAssetId: 'asset-custom-tm',
        briefAssetId: 'asset-brief'
      }
    });

    assert.deepEqual(profile.assetSelections, {
      glossaryAssetId: 'asset-glossary'
    });
    assert.deepEqual(profile.assetBindings, [
      { assetId: 'asset-glossary', purpose: 'glossary' }
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime derives role-based asset selections from legacy asset bindings', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot
    });

    const profile = runtime.saveProfile({
      name: 'Legacy Asset Binding Profile',
      assetBindings: [
        { assetId: 'asset-glossary', purpose: 'glossary' },
        { assetId: 'asset-custom-tm', purpose: 'custom_tm' },
        { assetId: 'asset-brief', purpose: 'brief' }
      ]
    });

    assert.deepEqual(profile.assetSelections, {
      glossaryAssetId: 'asset-glossary'
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime writes real translation history using configured provider route', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Default',
      providerId: provider.id,
      interactiveProviderId: provider.id,
      interactiveModelId: provider.models[0].id,
      fallbackProviderId: provider.id,
      fallbackModelId: provider.models[0].id
    });

    const result = await runtime.translate({
      requestId: 'REQ-1',
      traceId: 'TRACE-1',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: { client: 'ABC', subject: 'Test' },
      segments: [{ index: 0, text: 'Restart service', plainText: 'Restart service', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.translations[0].text, 'Restart service -> ZH');

    const state = runtime.getAppState();
    assert.equal(state.historyExplorer.items.length, 1);
    assert.equal(state.historyExplorer.items[0].providerName, 'OpenAI');
    assert.equal(state.historyExplorer.items[0].segmentCount, 1);
    assert.equal(state.historyExplorer.items[0].runtime.desktopVersion, '1.0.9');
    assert.equal(state.historyExplorer.items[0].runtime.processId, process.pid);
    assert.equal(state.historyExplorer.items[0].runtime.execPath, process.execPath);
    assert.ok(state.historyExplorer.items[0].runtime.runtimeStartedAt);
    assert.ok(state.historyExplorer.items[0].runtime.execLastModifiedAt);
    assert.equal(state.contextBuilder.profiles[0].providerId, provider.id);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime retries transient provider failures and records retry metadata', async () => {
  const tempRoot = createTempAppRoot();
  try {
    let calls = 0;
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => {
          calls += 1;
          if (calls < 3) {
            throw new Error('request timed out');
          }
          return { text: `${sourceText} -> ZH`, latencyMs: 25, retryCount: 2, queuedMs: 0, promptCache: { key: 'prompt-1', layer: 'none', hit: false } };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true, retryAttempts: 2 }]
    });

    const profile = await runtime.saveProfile({
      name: 'Default',
      providerId: provider.id,
      interactiveProviderId: provider.id,
      interactiveModelId: provider.models[0].id
    });

    const result = await runtime.translate({
      requestId: 'REQ-RETRY-1',
      traceId: 'TRACE-RETRY-1',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Retry me', plainText: 'Retry me', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(calls, 3);
    const attempt = runtime.getAppState().historyExplorer.items[0].attempts[0];
    assert.equal(attempt.retryCount, 2);
    assert.equal(attempt.retryAfterSeconds, null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime applies sliding-window rate limiting before provider execution', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 5 })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true, rateLimitHint: '2 rps', concurrencyLimit: 1 }]
    });

    const profile = await runtime.saveProfile({
      name: 'Rate Limited Throughput',
      providerId: provider.id,
      cacheEnabled: false
    });

    const startedAt = Date.now();
    const result = await runtime.translate({
      requestId: 'REQ-RATE-LIMIT-WINDOW-1',
      traceId: 'TRACE-RATE-LIMIT-WINDOW-1',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'batch' },
      metadata: {},
      segments: [
        { index: 0, text: 'One', plainText: 'One', tmSource: '', tmTarget: '' },
        { index: 1, text: 'Two', plainText: 'Two', tmSource: '', tmTarget: '' }
      ]
    });

    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.statusCode, 200);
    assert.ok(elapsedMs >= 400);

    const attempts = runtime.getAppState().historyExplorer.items[0].attempts;
    assert.ok(attempts.some((attempt) => Number(attempt.rateLimitedWaitMs || 0) > 0));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime retries rate-limited provider failures and records retry metadata', async () => {
  const tempRoot = createTempAppRoot();
  try {
    let calls = 0;
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => {
          calls += 1;
          if (calls < 3) {
            throw new Error('429 too many requests; retry after 0.01');
          }
          return { text: `${sourceText} -> ZH`, latencyMs: 25, retryCount: 2, queuedMs: 0 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true, retryAttempts: 2 }]
    });

    const profile = await runtime.saveProfile({
      name: 'Rate Limit Retry',
      providerId: provider.id,
      interactiveProviderId: provider.id,
      interactiveModelId: provider.models[0].id
    });

    const result = await runtime.translate({
      requestId: 'REQ-RATE-LIMIT-1',
      traceId: 'TRACE-RATE-LIMIT-1',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Retry me', plainText: 'Retry me', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(calls, 3);
    const attempt = runtime.getAppState().historyExplorer.items[0].attempts[0];
    assert.equal(attempt.retryCount, 2);
    assert.equal(attempt.retryAfterSeconds, 0.01);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime records prompt cache telemetry from provider results', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText, requestOptions }) => {
          const key = 'prompt-cache-key';
          const cached = requestOptions.readPromptCache(key);
          if (cached) {
            return { text: cached, latencyMs: 0, promptCache: { key, layer: 'local', hit: true } };
          }
          requestOptions.writePromptCache(key, `${sourceText} -> ZH`);
          return { text: `${sourceText} -> ZH`, latencyMs: 25, promptCache: { key, layer: 'none', hit: false } };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Prompt Cache',
      cacheEnabled: false,
      providerId: provider.id,
      interactiveProviderId: provider.id,
      interactiveModelId: provider.models[0].id
    });

    await runtime.translate({
      requestId: 'REQ-PC-1',
      traceId: 'TRACE-PC-1',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Hello', plainText: 'Hello', tmSource: '', tmTarget: '' }]
    });

    await runtime.translate({
      requestId: 'REQ-PC-2',
      traceId: 'TRACE-PC-2',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'World', plainText: 'World', tmSource: '', tmTarget: '' }]
    });

    const history = runtime.getAppState().historyExplorer.items;
    assert.equal(history[0].attempts[0].promptCacheLayer, 'local');
    assert.equal(history[0].attempts[0].promptCacheHit, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime ignores stripped prompt template overrides at translation time', async () => {
  const tempRoot = createTempAppRoot();
  try {
    let sdkCalled = false;
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async () => {
          sdkCalled = true;
          return { text: 'translated', latencyMs: 10 };
        },
        translateBatch: async () => {
          sdkCalled = true;
          return { translations: [], latencyMs: 10 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Preview Required',
      providerId: provider.id,
      systemPrompt: 'You are a precise translation assistant.',
      userPrompt: '{{summary-text!}}'
    });

    const result = await runtime.translate({
      requestId: 'REQ-TEMPLATE-FAIL',
      traceId: 'TRACE-TEMPLATE-FAIL',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Hello', plainText: 'Hello', tmSource: '', tmTarget: '' }]
    });

    assert.equal('systemPrompt' in profile, false);
    assert.equal('userPrompt' in profile, false);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.translations[0].text, 'translated');
    assert.equal(sdkCalled, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime ignores stripped glossary prompt overrides at translation time', async () => {
  const tempRoot = createTempAppRoot();
  try {
    let sdkCalled = false;
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async () => {
          sdkCalled = true;
          return { text: 'translated', latencyMs: 10 };
        },
        translateBatch: async () => {
          sdkCalled = true;
          return { translations: [], latencyMs: 10 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Glossary Required',
      providerId: provider.id,
      userPrompt: '{{glossary-text!}}'
    });

    const result = await runtime.translate({
      requestId: 'REQ-GLOSSARY-FAIL',
      traceId: 'TRACE-GLOSSARY-FAIL',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Hello', plainText: 'Hello', tmSource: '', tmTarget: '' }]
    });

    assert.equal('userPrompt' in profile, false);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.translations[0].text, 'translated');
    assert.equal(sdkCalled, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime stores confirmed translations and reuses them through adaptive cache writeback', async () => {
  const tempRoot = createTempAppRoot();
  let providerCalls = 0;

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => {
          providerCalls += 1;
          return { text: `${sourceText} -> FR`, latencyMs: 25 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Adaptive Cache Profile',
      providerId: provider.id,
      interactiveProviderId: provider.id,
      interactiveModelId: provider.models[0].id,
      cacheEnabled: true
    });

    const storeResult = await runtime.storeTranslations({
      requestId: 'STORE-1',
      traceId: 'TRACE-STORE-1',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      requestType: 'Plaintext',
      translations: [
        { index: 0, sourceText: 'Restart service', targetText: 'Redemarrez le service' }
      ]
    });

    assert.equal(storeResult.statusCode, 200);
    assert.equal(storeResult.body.storedCount, 1);

    const result = await runtime.translate({
      requestId: 'REQ-ADAPTIVE-1',
      traceId: 'TRACE-ADAPTIVE-1',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Restart service', plainText: 'Restart service', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.translations[0].text, 'Redemarrez le service');
    assert.equal(providerCalls, 0);

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.attempts[0].routeKind, 'adaptive-cache');
    assert.equal(history.attempts[0].providerName, 'Adaptive Cache');
    assert.equal(history.attempts[0].cacheKind, 'adaptive');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime can bypass translation cache once for the next profile translation and then return to normal caching', async () => {
  const tempRoot = createTempAppRoot();
  let providerCalls = 0;

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => {
          providerCalls += 1;
          return { text: `${sourceText} -> FR fresh ${providerCalls}`, latencyMs: 25 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Bypass Cache Profile',
      providerId: provider.id,
      interactiveProviderId: provider.id,
      interactiveModelId: provider.models[0].id,
      cacheEnabled: true,
      translationStyle: 'formal'
    });

    await runtime.storeTranslations({
      requestId: 'STORE-BYPASS-1',
      traceId: 'TRACE-STORE-BYPASS-1',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      requestType: 'Plaintext',
      translations: [
        { index: 0, sourceText: 'Restart service', targetText: 'Redemarrez le service' }
      ]
    });

    const armed = runtime.bypassTranslationCacheOnce(profile.id);
    assert.equal(armed.bypassPending, true);
    assert.deepEqual(runtime.getAppState().contextBuilder.translationCacheBypassProfileIds, [profile.id]);

    const bypassed = await runtime.translate({
      requestId: 'REQ-BYPASS-1',
      traceId: 'TRACE-BYPASS-1',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Restart service', plainText: 'Restart service', tmSource: '', tmTarget: '' }]
    });

    assert.equal(bypassed.statusCode, 200);
    assert.equal(bypassed.body.translations[0].text, 'Restart service -> FR fresh 1');
    assert.equal(providerCalls, 1);
    assert.deepEqual(runtime.getAppState().contextBuilder.translationCacheBypassProfileIds, []);

    const historyAfterBypass = runtime.getAppState().historyExplorer.items[0];
    assert.equal(historyAfterBypass.attempts.at(-1).cacheKind, 'bypassed');

    const cached = await runtime.translate({
      requestId: 'REQ-BYPASS-2',
      traceId: 'TRACE-BYPASS-2',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Restart service', plainText: 'Restart service', tmSource: '', tmTarget: '' }]
    });

    assert.equal(cached.statusCode, 200);
    assert.equal(cached.body.translations[0].text, 'Restart service -> FR fresh 1');
    assert.equal(providerCalls, 1);
    assert.equal(runtime.getAppState().historyExplorer.items[0].attempts[0].cacheKind, 'exact');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime respects request-level translation cache bypass payload without changing persistent profile cache settings', async () => {
  const tempRoot = createTempAppRoot();
  let providerCalls = 0;

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => {
          providerCalls += 1;
          return { text: `${sourceText} -> DE fresh ${providerCalls}`, latencyMs: 20 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Payload Bypass Profile',
      providerId: provider.id,
      cacheEnabled: true
    });

    await runtime.storeTranslations({
      requestId: 'STORE-PAYLOAD-BYPASS',
      traceId: 'TRACE-STORE-PAYLOAD-BYPASS',
      sourceLanguage: 'EN',
      targetLanguage: 'DE',
      requestType: 'Plaintext',
      translations: [
        { index: 0, sourceText: 'Restart service', targetText: 'Dienst neu starten' }
      ]
    });

    const result = await runtime.translate({
      requestId: 'REQ-PAYLOAD-BYPASS',
      traceId: 'TRACE-PAYLOAD-BYPASS',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'DE',
      requestType: 'Plaintext',
      bypassTranslationCache: true,
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Restart service', plainText: 'Restart service', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.translations[0].text, 'Restart service -> DE fresh 1');
    assert.equal(providerCalls, 1);
    assert.equal(runtime.getAppState().contextBuilder.profiles.find((item) => item.id === profile.id)?.cacheEnabled, true);
    assert.equal(runtime.getAppState().historyExplorer.items[0].attempts.at(-1).cacheKind, 'bypassed');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime clearTranslationCache removes only translation cache entries', async () => {
  const tempRoot = createTempAppRoot();
  const databaseCapture = {};

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      __databaseCapture: databaseCapture
    });

    const now = new Date().toISOString();
    databaseCapture.store.translationCacheRows.set('translation-key', {
      cache_key: 'translation-key',
      text_value: 'Translated text',
      updated_at: now
    });
    databaseCapture.store.promptResponseCacheRows.set('prompt-key', {
      cache_key: 'prompt-key',
      text_value: 'Prompt response',
      updated_at: now
    });
    databaseCapture.store.documentSummaryCacheRows.set('summary-key', {
      cache_key: 'summary-key',
      text_value: 'Summary response',
      updated_at: now
    });

    const result = runtime.clearTranslationCache();

    assert.deepEqual(result, { clearedCount: 1 });
    assert.equal(databaseCapture.store.translationCacheRows.size, 0);
    assert.equal(databaseCapture.store.promptResponseCacheRows.size, 1);
    assert.equal(databaseCapture.store.documentSummaryCacheRows.size, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime saveProfile preserves cacheEnabled false across save and reload', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({ appDataRoot: tempRoot });

    const profile = await runtime.saveProfile({
      name: 'Cache Off Profile',
      cacheEnabled: false
    });

    assert.equal(profile.cacheEnabled, false);
    assert.equal(
      runtime.getAppState().contextBuilder.profiles.find((item) => item.id === profile.id)?.cacheEnabled,
      false
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime exposes update status and portable download-page flow through app state', async () => {
  const tempRoot = createTempAppRoot();
  const manifestUrl = 'https://example.com/latest.json';
  const portableUrl = 'https://example.com/memoq-ai-hub-win32-x64.zip';

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      manifestUrl,
      packagingMode: 'portable',
      fetch: async (url) => {
        if (url === manifestUrl) {
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                version: '1.0.10',
                publishedAt: '2026-03-26T00:00:00.000Z',
                releaseNotesUrl: 'https://example.com/release',
                assets: {
                  portable: {
                    name: 'memoq-ai-hub-win32-x64.zip',
                    url: portableUrl
                  }
                }
              };
            }
          };
        }

        return { ok: false, status: 404 };
      }
    });

    const initialState = runtime.getAppState();
    assert.equal(initialState.updateCenter.packagingMode, 'portable');
    assert.equal(initialState.dashboard.updateCenter.packagingMode, 'portable');

    const available = await runtime.checkForUpdates({ manual: true });
    const finalState = runtime.getAppState();

    assert.equal(available.latestVersion, '1.0.10');
    assert.equal(available.portableDownloadUrl, 'https://example.com/release');
    assert.equal(finalState.updateCenter.updateStatus, 'available');
    await assert.rejects(() => runtime.downloadPortableUpdate(), /browser download page/i);
    await assert.rejects(() => runtime.preparePortableUpdate(path.join(tempRoot, 'memoq-ai-hub-win32-x64.zip')), /browser download page/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime does not reject shared-only requests based on stripped prompt overrides', async () => {
  const tempRoot = createTempAppRoot();
  let providerCalls = 0;

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => {
          providerCalls += 1;
          return { text: `${sourceText} -> ZH`, latencyMs: 25 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Interactive Placeholder Profile',
      providerId: provider.id,
      usePreviewContext: true,
      usePreviewTargetText: true,
      userPrompt: 'Current target: {{target-text}}'
    });

    const result = await runtime.translate({
      requestId: 'REQ-NOT-ELIGIBLE-1',
      traceId: 'TRACE-NOT-ELIGIBLE-1',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'pretranslate' },
      metadata: {},
      segments: [{ index: 0, text: 'Hello', plainText: 'Hello', tmSource: '', tmTarget: '' }]
    });

    assert.equal('userPrompt' in profile, false);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.translations[0].text, 'Hello -> ZH');
    assert.equal(providerCalls, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime exposes runtime identity in desktop version payload', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const payload = runtime.getDesktopVersionPayload();
    assert.equal(payload.desktopVersion, '1.0.9');
    assert.equal(payload.runtime.desktopVersion, '1.0.9');
    assert.equal(payload.runtime.processId, process.pid);
    assert.equal(payload.runtime.execPath, process.execPath);
    assert.ok(payload.runtime.runtimeStartedAt);
    assert.ok(payload.runtime.execLastModifiedAt);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime writes providerId when saving a profile and routes through it', async () => {
  const tempRoot = createTempAppRoot();
  const calls = [];

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ modelName, sourceText }) => {
          calls.push({ modelName, sourceText });
          return { text: `${sourceText} -> ZH`, latencyMs: 25 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Provider Bound',
      providerId: provider.id
    });

    assert.equal(profile.providerId, provider.id);

    const result = await runtime.translate({
      requestId: 'REQ-PROVIDER-ID',
      traceId: 'TRACE-PROVIDER-ID',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Hello', plainText: 'Hello', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(calls[0].modelName, 'gpt-4.1-mini');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime internal history filter uses local date boundaries instead of lexical timestamp compare', () => {
  const { __internals } = loadRuntimeModule();
  const localBoundary = new Date(2026, 2, 19, 0, 0, 0, 0).getTime();
  const entries = [
    { id: 'entry-1', submittedAt: new Date(localBoundary - 1).toISOString(), providerName: 'OpenAI', model: 'gpt-5.4-mini', status: 'success' },
    { id: 'entry-2', submittedAt: new Date(localBoundary).toISOString(), providerName: 'OpenAI', model: 'gpt-5.4-mini', status: 'success' }
  ];

  const filtered = __internals.filterHistory(entries, { dateFrom: '2026-03-19', dateTo: '2026-03-19' });

  assert.deepEqual(filtered.map((entry) => entry.id), ['entry-2']);
});

test('runtime exportHistory formats timestamps using local presentation while keeping runtime history ISO-based', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Default',
      providerId: provider.id,
      interactiveProviderId: provider.id,
      interactiveModelId: provider.models[0].id,
      fallbackProviderId: provider.id,
      fallbackModelId: provider.models[0].id
    });

    await runtime.translate({
      requestId: 'REQ-EXPORT-1',
      traceId: 'TRACE-EXPORT-1',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: { client: 'ABC', subject: 'Export Test' },
      segments: [{ index: 0, text: 'Restart service', plainText: 'Restart service', tmSource: '', tmTarget: '' }]
    });

    const historyEntry = runtime.getAppState().historyExplorer.items[0];
    assert.match(historyEntry.submittedAt, /T/);
    const expectedSubmittedAt = formatTimestampForLocalDisplay(historyEntry.submittedAt);

    const exported = runtime.exportHistory({ format: 'csv', scope: 'filtered', filters: {} });
    const csv = fs.readFileSync(exported.path, 'utf8');
    const escapedExpectedSubmittedAt = expectedSubmittedAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    assert.match(csv, /\bsubmittedAt\b/);
    assert.match(csv, new RegExp(escapedExpectedSubmittedAt));
    assert.doesNotMatch(csv, /T\d{2}:\d{2}:\d{2}/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime aligns profile route provider fields when saving providerId only', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'Team OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Aligned Provider',
      providerId: provider.id
    });

    assert.equal(profile.providerId, provider.id);
    assert.equal(profile.interactiveProviderId, provider.id);
    assert.equal(profile.pretranslateProviderId, provider.id);
    assert.equal(profile.fallbackProviderId, provider.id);

    const state = runtime.getAppState();
    assert.equal(state.contextBuilder.profiles[0].providerId, provider.id);
    assert.equal(state.contextBuilder.profiles[0].interactiveProviderId, provider.id);
    assert.equal(state.contextBuilder.profiles[0].pretranslateProviderId, provider.id);
    assert.equal(state.contextBuilder.profiles[0].fallbackProviderId, provider.id);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime prefers providerId over legacy provider fields', async () => {
  const tempRoot = createTempAppRoot();
  const calls = [];

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ modelName, sourceText }) => {
          calls.push({ modelName, sourceText });
          return { text: `${sourceText} -> ZH`, latencyMs: 25 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [
        { modelName: 'gpt-primary', enabled: true }
      ]
    });

    const fallbackProvider = await runtime.saveProvider({
      name: 'Fallback',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key-2',
      models: [{ modelName: 'gpt-fallback', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Default',
      providerId: fallbackProvider.id,
      interactiveProviderId: provider.id,
      interactiveModelId: 'legacy-model-id-that-should-be-ignored',
      fallbackProviderId: provider.id
    });

    const result = await runtime.translate({
      requestId: 'REQ-2',
      traceId: 'TRACE-2',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Hello', plainText: 'Hello', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(calls[0].modelName, 'gpt-fallback');
    assert.equal(profile.providerId, fallbackProvider.id);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime can test unsaved provider draft without saving it first', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async ({ modelName }) => ({ ok: true, latencyMs: 12, message: `ok:${modelName}` }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const result = await runtime.testProviderDraft({
      name: 'Draft OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'draft-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'connected');
    assert.match(result.message, /ok:gpt-4.1-mini/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime preserves empty compatible model lists when a provider is created without explicit models', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI Compatible',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      requestPath: '/chat/completions',
      apiKey: 'test-key',
      models: []
    });

    assert.equal(provider.models.length, 0);
    assert.equal(provider.defaultModelId, '');

    const state = runtime.getAppState();
    assert.equal(state.providerHub.providers[0].models.length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime rejects compatible provider draft tests when no enabled model is provided', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async ({ provider, modelName }) => {
          return { ok: true, latencyMs: 12, message: `ok:${modelName}` };
        },
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const result = await runtime.testProviderDraft({
      name: 'OpenAI Compatible',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      requestPath: '/chat/completions',
      apiKey: 'draft-key',
      models: []
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'failed');
    assert.equal(result.message, 'At least one enabled model is required.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime preserves requestPath for openai-compatible providers', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI Compatible',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      requestPath: '/chat/completions',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    assert.equal(provider.requestPath, '/chat/completions');

    const state = runtime.getAppState();
    assert.equal(state.providerHub.providers[0].requestPath, '/chat/completions');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime can test only openai-family provider drafts', async () => {
  const tempRoot = createTempAppRoot();
  const seen = [];

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async ({ provider, modelName }) => {
          seen.push({ type: provider.type, modelName });
          return { ok: true, latencyMs: 12, message: `ok:${provider.type}:${modelName}` };
        },
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const drafts = [
      { type: 'openai', model: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1', requestPath: '' },
      { type: 'openai-compatible', model: 'gpt-4.1-mini', baseUrl: 'https://api.example.com/v1', requestPath: '/responses' }
    ];

    for (const draft of drafts) {
      const result = await runtime.testProviderDraft({
        name: draft.type,
        type: draft.type,
        baseUrl: draft.baseUrl,
        requestPath: draft.requestPath,
        apiKey: 'draft-key',
        models: [{ modelName: draft.model, enabled: true }]
      });

      assert.equal(result.ok, true);
      assert.equal(result.status, 'connected');
      assert.match(result.message, new RegExp(draft.type));
    }

    assert.deepEqual(seen, [
      { type: 'openai', modelName: 'gpt-4.1-mini' },
      { type: 'openai-compatible', modelName: 'gpt-4.1-mini' }
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime discovers models for openai-compatible provider drafts', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        discoverModels: async ({ provider, apiKey }) => {
          assert.equal(provider.type, 'openai-compatible');
          assert.equal(provider.requestPath, '/chat/completions');
          assert.equal(apiKey, 'draft-key');
          return {
            ok: true,
            models: [{ modelName: 'gpt-4.1-mini' }, { modelName: 'gpt-4.1' }]
          };
        }
      }
    });

    const result = await runtime.discoverProviderModels({
      name: 'OpenAI Compatible',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      requestPath: '/chat/completions',
      apiKey: 'draft-key',
      models: [{ modelName: 'existing-model', enabled: true }]
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.models.map((model) => model.modelName), ['gpt-4.1-mini', 'gpt-4.1']);
    assert.equal(result.models.every((model) => model.id && model.enabled === true), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime discovery fails cleanly when api key is missing', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        discoverModels: async () => {
          throw new Error('should not be called');
        }
      }
    });

    const result = await runtime.discoverProviderModels({
      name: 'OpenAI Compatible',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      requestPath: '/responses',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'PROVIDER_AUTH_FAILED');
    assert.match(result.message, /API key/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime discovers models for official openai provider drafts', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        discoverModels: async ({ provider, apiKey }) => {
          assert.equal(provider.type, 'openai');
          assert.equal(provider.requestPath, '');
          assert.equal(apiKey, 'draft-key');
          return {
            ok: true,
            models: [{ modelName: 'gpt-4.1-mini' }, { modelName: 'gpt-4.1' }]
          };
        }
      }
    });

    const result = await runtime.discoverProviderModels({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'draft-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.models.map((model) => model.modelName), ['gpt-4.1-mini', 'gpt-4.1']);
    assert.equal(result.models.every((model) => model.id && model.enabled === true), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime falls back to single-segment execution when compatible batch translation fails without a fallback route', async () => {
  const tempRoot = createTempAppRoot();
  const batchCalls = [];
  const segmentCalls = [];

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateBatch: async (request) => {
          batchCalls.push(request);
          throw new Error('responses endpoint unavailable');
        },
        translateSegment: async ({ provider, modelName, sourceText }) => {
          segmentCalls.push({ type: provider.type, modelName, sourceText });
          return { text: `${sourceText} -> ZH`, latencyMs: 10 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI Compatible',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      requestPath: '/responses',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Default',
      providerId: provider.id
    });

    const result = await runtime.translate({
      requestId: 'REQ-BATCH-FALLBACK',
      traceId: 'TRACE-BATCH-FALLBACK',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [
        { index: 0, text: 'Hello', plainText: 'Hello', tmSource: '', tmTarget: '' },
        { index: 1, text: 'World', plainText: 'World', tmSource: '', tmTarget: '' }
      ]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(batchCalls.length, 1);
    assert.deepEqual(batchCalls[0].segments.map((segment) => segment.index), [0, 1]);
    assert.deepEqual(segmentCalls, [
      { type: provider.type, modelName: provider.models[0].modelName, sourceText: 'Hello' },
      { type: provider.type, modelName: provider.models[0].modelName, sourceText: 'World' }
    ]);
    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.requestMode, 'batch');
    assert.equal(history.effectiveExecutionMode, 'single');
    assert.equal(history.attempts.length, 3);
    assert.equal(history.attempts[0].effectiveExecutionMode, 'batch');
    assert.equal(history.attempts[1].effectiveExecutionMode, 'single');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime filters history by provider', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const providerA = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key-a',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const providerB = await runtime.saveProvider({
      name: 'OpenAI Compatible',
      type: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'test-key-b',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    await runtime.saveProfile({
      name: 'OpenAI Profile',
      providerId: providerA.id
    });

    await runtime.saveProfile({
      name: 'Compatible Profile',
      providerId: providerB.id
    });

    await runtime.translate({
      requestId: 'REQ-1',
      traceId: 'TRACE-1',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: runtime.getAppState().contextBuilder.profiles[0].id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Hello', plainText: 'Hello', tmSource: '', tmTarget: '' }]
    });

    const filtered = runtime.getAppState({ provider: providerA.name });
    assert.equal(filtered.historyExplorer.items.length, 1);
    assert.equal(filtered.historyExplorer.items[0].providerName, providerA.name);

    const byId = runtime.getAppState({ provider: providerB.id });
    assert.equal(byId.historyExplorer.items.length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime exports history timestamps in local time and filters by local date boundaries', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Default',
      providerId: provider.id
    });

    await runtime.translate({
      requestId: 'REQ-EXPORT-1',
      traceId: 'TRACE-EXPORT-1',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Hello', plainText: 'Hello', tmSource: '', tmTarget: '' }]
    });

    const historyItem = runtime.getAppState().historyExplorer.items[0];
    const dateFilter = formatLocalDateFilter(historyItem.submittedAt);
    const exportResult = runtime.exportHistory({
      format: 'csv',
      scope: 'filtered',
      filters: {
        dateFrom: dateFilter,
        dateTo: dateFilter
      }
    });

    const csv = fs.readFileSync(exportResult.path, 'utf8');

    assert.equal(exportResult.count, 1);
    assert.match(csv, new RegExp(formatTimestampForLocalDisplay(historyItem.submittedAt).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(csv, new RegExp(formatTimestampForLocalDisplay(historyItem.completedAt).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime rejects malformed provider api keys before saving them', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    assert.throws(() => runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test-\uFFFD-bad',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    }), /U\+FFFD/);

    const state = runtime.getAppState();
    assert.equal(state.providerHub.providers.length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime omits mapping notice when no mapping rules exist', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const state = runtime.getAppState();
    assert.ok(!state.dashboard.notices.some((item) => /mapping rule/i.test(item)));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime resolves preview-context from helper cache and caches document summaries', async () => {
  const tempRoot = createTempAppRoot();
  const previewLookups = [];
  const translationUpdates = [];
  let summaryCalls = 0;
  let translateCalls = 0;

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      previewContextClient: {
        start() {},
        dispose() {},
        getStatus() {
          return { available: true, connected: true, state: 'connected', lastConnectedAt: '2026-03-18T00:00:00.000Z', lastUpdatedAt: '2026-03-18T00:00:00.000Z' };
        },
        getContext(request) {
          previewLookups.push(request);
          if (request.includeFullText) {
            return {
              available: true,
              documentId: 'DOC-1',
              documentName: 'Install Guide',
              importPath: 'C:/docs/install.docx',
              fullText: 'Install the application. Configure the service. Restart and verify.'
            };
          }

          return {
            available: true,
            documentId: 'DOC-1',
            documentName: 'Install Guide',
            targetText: '旧译文',
            aboveText: 'Install the application.',
            belowText: 'Restart and verify.',
            resolvedRange: { start: 5, end: 5 },
            targetTextSource: 'partTarget',
            neighborSource: 'partOrder'
          };
        },
        recordTranslation(update) {
          translationUpdates.push(update);
        }
      },
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        generateText: async () => {
          summaryCalls += 1;
          return { text: 'Setup instructions for a local service deployment.', latencyMs: 18 };
        },
        translateSegment: async ({ previewContext, segmentPreviewContext, sourceText }) => {
          translateCalls += 1;
          assert.equal(previewContext.documentName, 'Install Guide');
          assert.equal(previewContext.summary, 'Setup instructions for a local service deployment.');
          assert.equal(segmentPreviewContext.targetText, '旧译文');
          assert.equal(segmentPreviewContext.above, 'Install the application.');
          assert.equal(segmentPreviewContext.below, 'Restart and verify.');
          return { text: `${sourceText} -> ZH`, latencyMs: 25 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Preview Profile',
      providerId: provider.id,
      cacheEnabled: false,
      usePreviewContext: true,
      usePreviewSummary: true,
      usePreviewTargetText: true,
      usePreviewAboveBelow: true,
      usePreviewFullText: false,
      previewAboveSegments: 2,
      previewAboveCharacters: 200,
      previewBelowSegments: 2,
      previewBelowCharacters: 200
    });

    const firstResult = await runtime.translate({
      requestId: 'REQ-PREVIEW-1',
      traceId: 'TRACE-PREVIEW-1',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: { documentId: 'DOC-1' },
      segments: [{ index: 0, text: 'Configure the service.', plainText: 'Configure the service.', tmSource: '', tmTarget: '' }]
    });

    const secondResult = await runtime.translate({
      requestId: 'REQ-PREVIEW-2',
      traceId: 'TRACE-PREVIEW-2',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: { documentId: 'DOC-1' },
      segments: [{ index: 1, text: 'Restart and verify.', plainText: 'Restart and verify.', tmSource: '', tmTarget: '' }]
    });

    assert.equal(firstResult.statusCode, 200);
    assert.equal(secondResult.statusCode, 200);
    assert.equal(summaryCalls, 1);
    assert.equal(translateCalls, 2);
    assert.ok(previewLookups.length >= 4);
    assert.equal(translationUpdates.length, 2);

    const state = runtime.getAppState();
    assert.equal(state.dashboard.runtimeStatus.previewStatus.status, 'connected');
    assert.equal(state.historyExplorer.items[0].documentId, 'DOC-1');
    assert.equal(state.historyExplorer.items[0].segments[0].previewContext.targetTextSource, 'partTarget');
    assert.equal(state.historyExplorer.items[0].segments[0].previewContext.neighborSource, 'partOrder');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime blocks deleting referenced provider and model', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }, { modelName: 'gpt-4.1', enabled: true }]
    });

    await runtime.saveProfile({
      name: 'Default',
      interactiveProviderId: provider.id,
      interactiveModelId: provider.models[0].id,
      fallbackProviderId: provider.id,
      fallbackModelId: provider.models[1].id
    });

    assert.throws(() => runtime.deleteProvider(provider.id), /still referenced/);
    assert.throws(() => runtime.deleteProviderModel(provider.id, provider.models[0].id), /still referenced/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime treats stale preview helper errors as startup waiting state', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      previewContextClient: {
        start() {},
        dispose() {},
        getStatus() {
          return {
            available: true,
            connected: false,
            state: 'error',
            lastUpdatedAt: '2020-01-01T00:00:00.000Z',
            lastError: 'Old preview bridge failure'
          };
        }
      }
    });

    const state = runtime.getAppState();
    assert.equal(state.dashboard.runtimeStatus.previewStatus.status, 'starting');
    assert.equal(state.dashboard.runtimeStatus.previewStatus.lastError, '');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime treats fresh preview helper timeout retries as startup waiting state before first connection', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      previewContextClient: {
        start() {},
        dispose() {},
        getStatus() {
          return {
            available: true,
            connected: false,
            state: 'error',
            lastUpdatedAt: new Date().toISOString(),
            lastError: '操作已超时。'
          };
        }
      }
    });

    const state = runtime.getAppState();
    assert.equal(state.dashboard.runtimeStatus.previewStatus.status, 'starting');
    assert.equal(state.dashboard.runtimeStatus.previewStatus.statusMessage, 'Waiting for memoQ startup.');
    assert.equal(state.dashboard.runtimeStatus.previewStatus.lastError, '');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime keeps preview helper errors after a successful connection has already happened', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      previewContextClient: {
        start() {},
        dispose() {},
        getStatus() {
          return {
            available: true,
            connected: false,
            state: 'error',
            lastConnectedAt: '2026-03-19T00:00:00.000Z',
            lastUpdatedAt: new Date().toISOString(),
            lastError: '操作已超时。'
          };
        }
      }
    });

    const state = runtime.getAppState();
    assert.equal(state.dashboard.runtimeStatus.previewStatus.status, 'error');
    assert.equal(state.dashboard.runtimeStatus.previewStatus.lastError, '操作已超时。');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime derives preview context from ingested preview events and forwards it to providers', async () => {
  const tempRoot = createTempAppRoot();
  const calls = [];

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async (request) => {
          calls.push(request);
          return { text: `${request.sourceText} -> ZH`, latencyMs: 25 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Preview Profile',
      providerId: provider.id,
      usePreviewContext: true,
      usePreviewFullText: true,
      usePreviewSummary: true,
      usePreviewAboveBelow: true,
      usePreviewTargetText: true
    });

    runtime.ingestPreviewPartIds({
      PreviewPartIds: ['part-a', 'part-b', 'part-c']
    });
    runtime.ingestPreviewContentUpdate({
      PreviewParts: [
        {
          PreviewPartId: 'part-a',
          SourceDocument: { DocumentGuid: 'doc-1', DocumentName: 'Guide' },
          SourceLangCode: 'EN',
          TargetLangCode: 'ZH',
          SourceContent: { Content: 'First sentence.' },
          TargetContent: { Content: '第一句。' }
        },
        {
          PreviewPartId: 'part-b',
          SourceDocument: { DocumentGuid: 'doc-1', DocumentName: 'Guide' },
          SourceLangCode: 'EN',
          TargetLangCode: 'ZH',
          SourceContent: { Content: 'Second sentence.' },
          TargetContent: { Content: '第二句。' }
        },
        {
          PreviewPartId: 'part-c',
          SourceDocument: { DocumentGuid: 'doc-1', DocumentName: 'Guide' },
          SourceLangCode: 'EN',
          TargetLangCode: 'ZH',
          SourceContent: { Content: 'Third sentence.' },
          TargetContent: { Content: '第三句。' }
        }
      ]
    });
    runtime.ingestPreviewHighlight({
      ActivePreviewParts: [
        {
          PreviewPartId: 'part-b',
          SourceDocument: { DocumentGuid: 'doc-1', DocumentName: 'Guide' },
          SourceLangCode: 'EN',
          TargetLangCode: 'ZH',
          SourceContent: { Content: 'Second sentence.' },
          TargetContent: { Content: '第二句。' },
          SourceFocusedRange: { StartIndex: 0, Length: 6 },
          TargetFocusedRange: { StartIndex: 0, Length: 3 }
        }
      ]
    });

    const result = await runtime.translate({
      requestId: 'REQ-PREVIEW',
      traceId: 'TRACE-PREVIEW',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Second sentence.', plainText: 'Second sentence.', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].previewContext.activePreviewPartId, 'part-b');
    assert.equal(calls[0].previewContext.fullText, '');
    assert.equal(calls[0].segmentPreviewContext.targetText, '第二句。');
    assert.equal(calls[0].segmentPreviewContext.above, 'First sentence.');
    assert.equal(calls[0].segmentPreviewContext.below, 'Third sentence.');

    const state = runtime.getAppState();
    assert.match(state.previewBridge.status, /starting|idle|missing|disconnected/);
    assert.equal(state.previewBridge.activePreviewPartId, 'part-b');
    assert.equal(state.historyExplorer.items[0].assembly.previewContext.activePreviewPartId, 'part-b');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime waits briefly for preview cache readiness before translating', async () => {
  const tempRoot = createTempAppRoot();
  let contextCalls = 0;
  const calls = [];

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      previewContextWaitMs: 100,
      previewContextPollMs: 10,
      previewContextClient: {
        start() {},
        dispose() {},
        getStatus() {
          return { available: true, connected: true, state: 'connected', lastConnectedAt: '2026-03-18T00:00:00.000Z', lastUpdatedAt: '2026-03-18T00:00:00.000Z' };
        },
        getContext(request) {
          contextCalls += 1;
          if (contextCalls < 3) {
            return { available: false, reason: 'document_not_cached' };
          }

          if (request.includeFullText) {
            return {
              available: true,
              documentId: 'DOC-1',
              documentName: 'Guide',
              importPath: 'C:/docs/guide.docx',
              fullText: 'First sentence.\nSecond sentence.'
            };
          }

          return {
            available: true,
            documentId: 'DOC-1',
            documentName: 'Guide',
            previewPartId: 'part-b',
            targetText: '第二句。',
            aboveText: 'First sentence.',
            belowText: 'Third sentence.'
          };
        },
        recordTranslation() {}
      },
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ previewContext, segmentPreviewContext, sourceText }) => {
          calls.push({ previewContext, segmentPreviewContext, sourceText });
          return { text: `${sourceText} -> ZH`, latencyMs: 25 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Preview Wait Profile',
      providerId: provider.id,
      cacheEnabled: false,
      usePreviewContext: true,
      usePreviewSummary: true,
      usePreviewTargetText: true,
      usePreviewAboveBelow: true,
      usePreviewFullText: true
    });

    const result = await runtime.translate({
      requestId: 'REQ-PREVIEW-WAIT',
      traceId: 'TRACE-PREVIEW-WAIT',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {
        documentId: 'DOC-1'
      },
      segments: [{ index: 0, text: 'Second sentence.', plainText: 'Second sentence.', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].previewContext.documentName, 'Guide');
    assert.equal(calls[0].segmentPreviewContext.previewPartId, 'part-b');
    assert.ok(contextCalls >= 3);

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.assembly.previewWarmup.attempted, true);
    assert.equal(history.assembly.previewWarmup.timedOut, false);
    assert.ok(history.assembly.previewWarmup.pollCount >= 1);
    assert.ok(history.assembly.previewWarmup.resolvedOnPoll >= 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime waits for preview document cache warmup before resolving the first local preview request', async () => {
  const tempRoot = createTempAppRoot();
  let readDocumentCalls = 0;
  const calls = [];

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      previewContextWaitMs: 120,
      previewContextPollMs: 10,
      previewContextClient: {
        start() {},
        dispose() {},
        getStatus() {
          return { available: true, connected: true, state: 'connected' };
        },
        readDocument() {
          readDocumentCalls += 1;
          if (readDocumentCalls < 3) {
            return null;
          }

          return {
            documentId: 'DOC-WARM',
            documentName: 'Guide',
            activePreviewPartIds: ['part-15'],
            parts: [
              {
                previewPartId: 'part-15',
                sourceText: 'CERO的分级制度适用于在日本境内发行的所有电子游戏。',
                targetText: '',
                sourceFocusedRange: { startIndex: 0, length: 22, endIndex: 21 },
                targetFocusedRange: { startIndex: 0, length: 0, endIndex: 0 },
                order: 0
              }
            ],
            segments: []
          };
        },
        getContext(request) {
          if (readDocumentCalls < 3) {
            return {
              available: false,
              reason: 'document_not_cached',
              previewMatchMode: 'unmatched',
              activePreviewPartIds: []
            };
          }

          if (request.includeFullText) {
            return {
              available: true,
              documentId: 'DOC-WARM',
              documentName: 'Guide',
              fullText: 'CERO的分级制度适用于在日本境内发行的所有电子游戏。'
            };
          }

          return {
            available: true,
            documentId: 'DOC-WARM',
            documentName: 'Guide',
            previewPartId: 'part-15',
            activePreviewPartIds: ['part-15'],
            targetText: '',
            aboveText: '',
            belowText: '',
            sourceFocusedRange: { startIndex: 0, length: 22, endIndex: 21 },
            targetFocusedRange: { startIndex: 0, length: 0, endIndex: 0 },
            hasFocusedRange: true
          };
        },
        recordTranslation() {}
      },
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ previewContext, segmentPreviewContext, sourceText }) => {
          calls.push({ previewContext, segmentPreviewContext, sourceText });
          return { text: `${sourceText} -> EN`, latencyMs: 25 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Preview Warmup Profile',
      providerId: provider.id,
      cacheEnabled: false,
      usePreviewContext: true,
      usePreviewSummary: false,
      usePreviewTargetText: true,
      usePreviewAboveBelow: true,
      usePreviewFullText: true
    });

    const result = await runtime.translate({
      requestId: 'REQ-PREVIEW-WARMUP',
      traceId: 'TRACE-PREVIEW-WARMUP',
      contractVersion: '1',
      sourceLanguage: 'zho-CN',
      targetLanguage: 'eng',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: { documentId: 'DOC-WARM' },
      segments: [{ index: 0, text: 'CERO的分级制度适用于在日本境内发行的所有电子游戏。', plainText: 'CERO的分级制度适用于在日本境内发行的所有电子游戏。', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].previewContext.documentName, 'Guide');
    assert.equal(calls[0].segmentPreviewContext.previewPartId, 'part-15');
    assert.ok(readDocumentCalls >= 3);

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.assembly.previewWarmup.attempted, true);
    assert.equal(history.assembly.previewWarmup.timedOut, false);
    assert.equal(history.assembly.previewWarmup.documentCacheSeen, true);
    assert.equal(history.assembly.previewWarmup.activePreviewPartSeen, true);
    assert.equal(history.assembly.previewWarmup.focusedRangeSeen, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime ignores stale preview cache during cold start until a refreshed document arrives', async () => {
  const tempRoot = createTempAppRoot();
  let poll = 0;
  const calls = [];

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      previewContextWaitMs: 180,
      previewContextPollMs: 10,
      previewContextClient: {
        start() {},
        dispose() {},
        getStatus() {
          return poll >= 3
            ? { available: true, connected: true, state: 'connected', lastConnectedAt: '2026-03-18T00:00:00.120Z' }
            : { available: true, connected: false, state: 'disconnected' };
        },
        readDocument() {
          poll += 1;
          if (poll < 3) {
            return {
              documentId: 'DOC-COLD',
              documentName: 'Guide',
              updatedAt: '2026-03-18T00:00:00.000Z',
              activePreviewPartIds: ['part-stale'],
              parts: [
                {
                  previewPartId: 'part-stale',
                  sourceText: 'Old preview content.',
                  targetText: '',
                  sourceFocusedRange: { startIndex: 0, length: 3, endIndex: 2 },
                  targetFocusedRange: { startIndex: 0, length: 0, endIndex: 0 },
                  order: 0
                }
              ],
              segments: []
            };
          }

          return {
            documentId: 'DOC-COLD',
            documentName: 'Guide',
            updatedAt: '2026-03-18T00:00:00.150Z',
            activePreviewPartIds: ['part-fresh'],
            parts: [
              {
                previewPartId: 'part-fresh',
                sourceText: 'Fresh preview content.',
                targetText: '新鲜预览。',
                sourceFocusedRange: { startIndex: 0, length: 5, endIndex: 4 },
                targetFocusedRange: { startIndex: 0, length: 4, endIndex: 3 },
                order: 0
              }
            ],
            segments: []
          };
        },
        getContext(request) {
          if (poll < 3) {
            return {
              available: false,
              documentId: 'DOC-COLD',
              documentName: 'Guide',
              reason: 'document_not_cached',
              previewMatchMode: 'unmatched',
              activePreviewPartIds: []
            };
          }

          if (request.includeFullText) {
            return {
              available: true,
              documentId: 'DOC-COLD',
              documentName: 'Guide',
              fullText: 'Fresh preview content.'
            };
          }

          return {
            available: true,
            documentId: 'DOC-COLD',
            documentName: 'Guide',
            previewPartId: 'part-fresh',
            activePreviewPartIds: ['part-fresh'],
            targetText: '新鲜预览。',
            aboveText: '',
            belowText: '',
            sourceFocusedRange: { startIndex: 0, length: 5, endIndex: 4 },
            targetFocusedRange: { startIndex: 0, length: 4, endIndex: 3 },
            hasFocusedRange: true
          };
        },
        recordTranslation() {}
      },
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ previewContext, segmentPreviewContext, sourceText }) => {
          calls.push({ previewContext, segmentPreviewContext, sourceText });
          return { text: `${sourceText} -> EN`, latencyMs: 25 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Cold Start Preview Profile',
      providerId: provider.id,
      cacheEnabled: false,
      usePreviewContext: true,
      usePreviewFullText: true,
      usePreviewTargetText: true
    });

    const result = await runtime.translate({
      requestId: 'REQ-PREVIEW-COLD',
      traceId: 'TRACE-PREVIEW-COLD',
      contractVersion: '1',
      sourceLanguage: 'zho-CN',
      targetLanguage: 'eng',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: { documentId: 'DOC-COLD' },
      segments: [{ index: 0, text: 'Fresh preview content.', plainText: 'Fresh preview content.', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].segmentPreviewContext.previewPartId, 'part-fresh');

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.assembly.previewWarmup.coldStart, true);
    assert.equal(history.assembly.previewWarmup.timedOut, false);
    assert.equal(history.assembly.previewWarmup.documentCacheUpdatedAt, '2026-03-18T00:00:00.150Z');
    assert.ok(history.assembly.previewWarmup.resolvedOnPoll >= 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime limits batch preview to shared context and records shared-only debug info', async () => {
  const tempRoot = createTempAppRoot();
  const calls = [];

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      previewContextClient: {
        start() {},
        dispose() {},
        getStatus() {
          return { available: true, connected: true, state: 'connected' };
        },
        getContext(request) {
          if (request.includeFullText) {
            return {
              available: true,
              documentId: 'DOC-BATCH',
              documentName: 'Guide',
              fullText: 'First sentence.\nSecond sentence.',
              activePreviewPartIds: ['part-b']
            };
          }

          return {
            available: true,
            documentId: 'DOC-BATCH',
            documentName: 'Guide',
            previewPartId: 'part-b',
            activePreviewPartIds: ['part-b'],
            targetText: '第二句。',
            aboveText: 'First sentence.',
            belowText: 'Third sentence.',
            sourceFocusedRange: { startIndex: 0, length: 6, endIndex: 5 },
            targetFocusedRange: { startIndex: 0, length: 3, endIndex: 2 },
            hasFocusedRange: true
          };
        },
        recordTranslation() {}
      },
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateBatch: async (request) => {
          calls.push(request);
          return {
            latencyMs: 20,
            translations: request.segments.map((segment) => ({
              index: segment.index,
              text: `${segment.sourceText} -> ZH`
            }))
          };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Batch Preview Profile',
      providerId: provider.id,
      cacheEnabled: false,
      usePreviewContext: true,
      usePreviewFullText: true,
      usePreviewSummary: false,
      usePreviewAboveBelow: true,
      usePreviewTargetText: true
    });

    const result = await runtime.translate({
      requestId: 'REQ-BATCH-PREVIEW',
      traceId: 'TRACE-BATCH-PREVIEW',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'pretranslate' },
      metadata: { documentId: 'DOC-BATCH' },
      segments: [
        { index: 0, text: 'First sentence.', plainText: 'First sentence.', tmSource: '', tmTarget: '' },
        { index: 1, text: 'Second sentence.', plainText: 'Second sentence.', tmSource: '', tmTarget: '' }
      ]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].previewContext.documentName, 'Guide');
    assert.equal(calls[0].previewContext.fullText, '');
    assert.equal(calls[0].segments[0].previewContext, null);
    assert.equal(calls[0].segments[1].previewContext, null);

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.assembly.previewContext.reason, 'batch_shared_only_mode');
    assert.deepEqual(history.assembly.previewContext.previewAvailableFeatures, []);
    assert.equal(history.segments[0].previewContext.reason, 'batch_shared_only_mode');
    assert.equal(history.segments[1].previewContext.reason, 'batch_shared_only_mode');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime records preview warmup timeout diagnostics when helper never connects in time', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      previewContextWaitMs: 60,
      previewContextPollMs: 10,
      previewContextClient: {
        start() {},
        dispose() {},
        getStatus() {
          return { available: true, connected: false, state: 'disconnected' };
        },
        readDocument() {
          return null;
        },
        getContext() {
          return {
            available: false,
            reason: 'document_not_cached',
            previewMatchMode: 'unmatched',
            activePreviewPartIds: []
          };
        },
        recordTranslation() {}
      },
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ previewContext, segmentPreviewContext, sourceText }) => {
          assert.equal(previewContext, null);
          assert.equal(segmentPreviewContext, null);
          return { text: `${sourceText} -> EN`, latencyMs: 25 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Preview Timeout Diagnostics Profile',
      providerId: provider.id,
      cacheEnabled: false,
      usePreviewContext: true,
      usePreviewFullText: true,
      usePreviewTargetText: true
    });

    const result = await runtime.translate({
      requestId: 'REQ-PREVIEW-TIMEOUT',
      traceId: 'TRACE-PREVIEW-TIMEOUT',
      contractVersion: '1',
      sourceLanguage: 'zho-CN',
      targetLanguage: 'eng',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: { documentId: 'DOC-TIMEOUT' },
      segments: [{ index: 0, text: 'Timeout example.', plainText: 'Timeout example.', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.assembly.previewWarmup.attempted, true);
    assert.equal(history.assembly.previewWarmup.timedOut, true);
    assert.equal(history.assembly.previewWarmup.documentCacheSeen, false);
    assert.equal(history.assembly.previewContext.reason, 'helper_not_connected_in_time');
    assert.equal(history.segments[0].previewContext.reason, 'helper_not_connected_in_time');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime records preview miss diagnostics when helper cache is present but local preview is not aligned', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      previewContextWaitMs: 0,
      previewContextClient: {
        start() {},
        dispose() {},
        getStatus() {
          return { available: true, connected: true, state: 'connected' };
        },
        getContext(request) {
          if (request.includeFullText) {
            return {
              available: true,
              documentId: 'DOC-MISS',
              documentName: 'Guide',
              activePreviewPartIds: ['part-19'],
              fullText: 'A（黑色）：适合全年龄段。'
            };
          }

          return {
            available: false,
            documentId: 'DOC-MISS',
            documentName: 'Guide',
            previewPartId: 'part-19',
            activePreviewPartIds: ['part-19'],
            reason: 'active_part_without_range',
            previewMatchMode: 'unmatched',
            sourceFocusedRange: null,
            targetFocusedRange: null,
            hasDocument: true,
            hasActivePreviewPart: true,
            hasFocusedRange: false
          };
        },
        recordTranslation() {}
      },
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Preview Diagnostics Profile',
      providerId: provider.id,
      cacheEnabled: false,
      usePreviewContext: true,
      usePreviewTargetText: true,
      usePreviewAboveBelow: true
    });

    const result = await runtime.translate({
      requestId: 'REQ-PREVIEW-MISS',
      traceId: 'TRACE-PREVIEW-MISS',
      contractVersion: '1',
      sourceLanguage: 'ZH',
      targetLanguage: 'EN',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: { documentId: 'DOC-MISS' },
      segments: [{ index: 0, text: '适合全年龄段。', plainText: '适合全年龄段。', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.assembly.previewContext.reason, 'active_part_without_range');
    assert.equal(history.segments[0].previewContext.reason, 'active_part_without_range');
    assert.equal(history.segments[0].previewContext.previewPartId, 'part-19');
    assert.deepEqual(history.segments[0].previewContext.activePreviewPartIds, ['part-19']);
    assert.deepEqual(history.segments[0].previewContext.previewAvailableFeatures, ['targetText', 'above', 'below']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime normalizes memoQ metadata and exposes project fields in history', async () => {
  const tempRoot = createTempAppRoot();

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 25 })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Default',
      providerId: provider.id
    });

    const result = await runtime.translate({
      requestId: 'REQ-META',
      traceId: 'TRACE-META',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {
        PorjectID: 'PRJ-42',
        client: 'ACME',
        domain: 'Legal',
        subject: 'NDA',
        documentId: 'DOC-77',
        projectGuid: 'GUID-99',
        segmentLevelMetadata: [{ segmentIndex: 0, segmentId: 'SEG-1', segmentStatus: 5 }]
      },
      segments: [{ index: 0, text: 'Hello', plainText: 'Hello', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.projectId, 'PRJ-42');
    assert.equal(history.client, 'ACME');
    assert.equal(history.domain, 'Legal');
    assert.equal(history.documentId, 'DOC-77');
    assert.equal(history.projectGuid, 'GUID-99');
    assert.equal(history.metadata.projectId, 'PRJ-42');
    assert.equal(history.metadata.segmentLevelMetadata[0].segmentId, 'SEG-1');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime uses batch translation and cache when available', async () => {
  const tempRoot = createTempAppRoot();
  const calls = { batch: 0, single: 0 };

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => {
          calls.single += 1;
          return { text: `${sourceText} -> ZH`, latencyMs: 10 };
        },
        translateBatch: async ({ segments }) => {
          calls.batch += 1;
          return {
            latencyMs: 20,
            translations: segments.map((segment) => ({
              index: segment.index,
              text: `${segment.sourceText} -> ZH`
            }))
          };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Default',
      providerId: provider.id,
      cacheEnabled: true
    });

    const payload = {
      requestId: 'REQ-BATCH',
      traceId: 'TRACE-BATCH',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: { projectId: 'PRJ-BATCH' },
      segments: [
        { index: 0, text: 'Hello', plainText: 'Hello', tmSource: '', tmTarget: '' },
        { index: 1, text: 'World', plainText: 'World', tmSource: '', tmTarget: '' }
      ]
    };

    const first = await runtime.translate(payload);
    const second = await runtime.translate({ ...payload, requestId: 'REQ-BATCH-2', traceId: 'TRACE-BATCH-2' });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(calls.batch, 1);
    assert.equal(calls.single, 0);
    assert.equal(runtime.getAppState().historyExplorer.items.length, 2);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime falls back to single-segment execution when batch translation fails and no fallback route is available', async () => {
  const tempRoot = createTempAppRoot();
  const calls = { batch: 0, single: 0 };

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => {
          calls.single += 1;
          return { text: `${sourceText} -> ZH`, latencyMs: 10 };
        },
        translateBatch: async () => {
          calls.batch += 1;
          throw new Error('batch failed');
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Default',
      providerId: provider.id,
      cacheEnabled: false
    });

    const result = await runtime.translate({
      requestId: 'REQ-FALLBACK',
      traceId: 'TRACE-FALLBACK',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: { projectId: 'PRJ-FALLBACK' },
      segments: [
        { index: 0, text: 'Hello', plainText: 'Hello', tmSource: '', tmTarget: '' },
        { index: 1, text: 'World', plainText: 'World', tmSource: '', tmTarget: '' }
      ]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(calls.batch, 1);
    assert.equal(calls.single, 2);
    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.requestMode, 'batch');
    assert.equal(history.effectiveExecutionMode, 'single');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime parses bound glossary assets and passes tb context to provider calls', async () => {
  const tempRoot = createTempAppRoot();
  const providerCalls = [];

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async (request) => {
          providerCalls.push(request);
          return { text: 'Bonjour', latencyMs: 10 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const glossarySourcePath = path.join(tempRoot, 'source-glossary.csv');
    fs.writeFileSync(glossarySourcePath, 'restart,redemarrer\ninstall,installer\n', 'utf8');

    const glossaryAsset = runtime.importAssetFromPath('glossary', glossarySourcePath);

    const profile = await runtime.saveProfile({
      name: 'Asset-backed',
      providerId: provider.id,
      useUploadedGlossary: true,
      userPrompt: '{{glossary-text}}\n{{source-text}}',
      assetBindings: [
        { assetId: glossaryAsset.id, purpose: 'glossary' }
      ]
    });

    const result = await runtime.translate({
      requestId: 'REQ-ASSET-CONTEXT',
      traceId: 'TRACE-ASSET-CONTEXT',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Restart service', plainText: 'Restart service', tmSource: 'Restart service', tmTarget: 'Redemarrez le service' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(providerCalls.length, 1);
    assert.match(providerCalls[0].assetContext.tb.renderedText, /Required terminology:/);
    assert.equal(providerCalls[0].tbContext.glossaryText, 'Required terminology:\n- "restart" => "redemarrer"');
    assert.equal(providerCalls[0].assetContext.briefText, '');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime attaches advisory terminology QA findings without failing translation', async () => {
  const tempRoot = createTempAppRoot();
  const providerCalls = [];

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async (request) => {
          providerCalls.push(request);
          return { text: '工作空间', latencyMs: 10 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const glossarySourcePath = path.join(tempRoot, 'source-glossary.csv');
    fs.writeFileSync(glossarySourcePath, 'workspace,工作区,EN,ZH,,,,whole_word,10,false,,UI term\nworkspace,工作空间,EN,ZH,,,,whole_word,1,true,,Forbidden\n', 'utf8');
    const glossaryAsset = runtime.importAssetFromPath('glossary', glossarySourcePath);

    const profile = await runtime.saveProfile({
      name: 'TB QA',
      providerId: provider.id,
      useUploadedGlossary: true,
      userPrompt: '{{glossary-text}}\n{{source-text}}',
      assetBindings: [{ assetId: glossaryAsset.id, purpose: 'glossary' }]
    });

    const result = await runtime.translate({
      requestId: 'REQ-TB-QA',
      traceId: 'TRACE-TB-QA',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: { projectId: 'PRJ-TB-QA' },
      segments: [{ index: 0, text: 'workspace', plainText: 'workspace', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(providerCalls.length, 1);
    assert.equal(result.body.translations[0].text, '工作空间');

    const state = runtime.getAppState();
    assert.equal(state.historyExplorer.items[0].status, 'success');
    assert.equal(state.historyExplorer.items[0].qaSummary.terminology.ok, false);
    assert.match(state.historyExplorer.items[0].qaSummary.terminology.issues[0].message, /workspace/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime translation cache changes when bound glossary content changes', async () => {
  const tempRoot = createTempAppRoot();
  let translateCalls = 0;

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => {
          translateCalls += 1;
          return { text: `${sourceText} -> FR`, latencyMs: 10 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const glossaryOnePath = path.join(tempRoot, 'glossary-one.csv');
    const glossaryTwoPath = path.join(tempRoot, 'glossary-two.csv');
    fs.writeFileSync(glossaryOnePath, 'restart,redemarrer\n', 'utf8');
    fs.writeFileSync(glossaryTwoPath, 'restart,relancer\n', 'utf8');

    const glossaryOne = runtime.importAssetFromPath('glossary', glossaryOnePath);
    const glossaryTwo = runtime.importAssetFromPath('glossary', glossaryTwoPath);

    const profile = await runtime.saveProfile({
      name: 'Cached Asset Profile',
      providerId: provider.id,
      cacheEnabled: true,
      userPrompt: '{{glossary-text}} {{source-text}}',
      assetBindings: [{ assetId: glossaryOne.id, purpose: 'glossary' }]
    });

    const payload = {
      requestId: 'REQ-CACHE-ASSET',
      traceId: 'TRACE-CACHE-ASSET',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Restart service', plainText: 'Restart service', tmSource: '', tmTarget: '' }]
    };

    const first = await runtime.translate(payload);
    const second = await runtime.translate(payload);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(translateCalls, 1);

    await runtime.saveProfile({
      ...profile,
      assetBindings: [{ assetId: glossaryTwo.id, purpose: 'glossary' }]
    });

    const third = await runtime.translate({
      ...payload,
      requestId: 'REQ-CACHE-ASSET-2',
      traceId: 'TRACE-CACHE-ASSET-2'
    });

    assert.equal(third.statusCode, 200);
    assert.equal(translateCalls, 2);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime saveProfile aligns prompt templates and legacy prompt fields', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot
    });

    const saved = await runtime.saveProfile({
      name: 'Prompt Template Profile',
      systemPrompt: 'Legacy system prompt',
      userPrompt: 'Legacy user prompt',
      promptTemplates: {
        single: {
          systemPrompt: 'Single system prompt',
          userPrompt: 'Single user prompt {{source-text}}'
        },
        batch: {
          systemPrompt: 'Batch system prompt',
          userPrompt: 'Batch user prompt {{source-text}}'
        }
      }
    });

    assert.equal('systemPrompt' in saved, false);
    assert.equal('userPrompt' in saved, false);
    assert.equal('promptTemplates' in saved, false);

    const state = runtime.getAppState();
    assert.equal('systemPrompt' in state.contextBuilder.profiles[0], false);
    assert.equal('userPrompt' in state.contextBuilder.profiles[0], false);
    assert.equal('promptTemplates' in state.contextBuilder.profiles[0], false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime saveProfile keeps glossary role selections and drops hidden first-release asset roles', async () => {
  const tempRoot = createTempAppRoot();
  const providerCalls = [];

  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async (request) => {
          providerCalls.push(request);
          return { text: 'translated', latencyMs: 20 };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const glossarySourcePath = path.join(tempRoot, 'role-glossary.csv');
    fs.writeFileSync(glossarySourcePath, 'restart,redemarrer\n', 'utf8');

    const glossaryAsset = runtime.importAssetFromPath('glossary', glossarySourcePath);

    const profile = await runtime.saveProfile({
      name: 'Role Asset Profile',
      providerId: provider.id,
      useUploadedGlossary: true,
      userPrompt: '{{glossary-text}}\n{{source-text}}',
      assetSelections: {
        glossaryAssetId: glossaryAsset.id,
        briefAssetId: 'legacy-brief-id'
      }
    });

    assert.deepEqual(profile.assetBindings, [
      { assetId: glossaryAsset.id, purpose: 'glossary' }
    ]);
    assert.deepEqual(profile.assetSelections, {
      glossaryAssetId: glossaryAsset.id
    });

    const result = await runtime.translate({
      requestId: 'REQ-ASSET-SELECTIONS',
      traceId: 'TRACE-ASSET-SELECTIONS',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Restart service', plainText: 'Restart service', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].tbContext.glossaryText, 'Required terminology:\n- "restart" => "redemarrer"');
    assert.equal(providerCalls[0].assetContext.briefText, '');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime keeps app state and asset preview reads side-effect free', async () => {
  const tempRoot = createTempAppRoot();
  const databaseCapture = {};
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      __databaseCapture: databaseCapture
    });

    await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const glossarySourcePath = path.join(tempRoot, 'preview-side-effect-free-glossary.csv');
    fs.writeFileSync(
      glossarySourcePath,
      [
        'Entry_ID,Entry_Subject,Chinese_PRC,Entry_Note',
        '0,Grand & 4X,大战略与4X,genre',
        '1,power,力量,ui'
      ].join('\n'),
      'utf8'
    );

    const glossaryAsset = runtime.importAssetFromPath('glossary', glossarySourcePath);
    databaseCapture.store.runCalls.length = 0;

    const state = runtime.getAppState({});
    assert.equal(state.contextBuilder.assets.length, 1);
    assert.equal(databaseCapture.store.runCalls.length, 0);

    const preview = runtime.getAssetPreview(glossaryAsset.id);
    assert.equal(preview.tbStructureAvailable, true);
    assert.equal(preview.tbStructureApplied, false);
    assert.equal(databaseCapture.store.runCalls.length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime exposes parsed asset previews without reparsing in the renderer', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot
    });

    const glossarySourcePath = path.join(tempRoot, 'preview-glossary.csv');
    const customTmSourcePath = path.join(tempRoot, 'preview-custom-tm.csv');
    const briefSourcePath = path.join(tempRoot, 'preview-brief.txt');
    fs.writeFileSync(glossarySourcePath, 'source,target,forbidden,note\nworkspace,工作区,false,UI term\n', 'utf8');
    fs.writeFileSync(customTmSourcePath, 'source,target\nSave,Enregistrer\nCancel,Annuler\n', 'utf8');
    fs.writeFileSync(briefSourcePath, 'Use concise tone.\nPrefer imperative voice.\n', 'utf8');

    const glossaryAsset = runtime.importAssetFromPath('glossary', glossarySourcePath);
    const customTmAsset = runtime.importAssetFromPath('custom_tm', customTmSourcePath);
    const briefAsset = runtime.importAssetFromPath('brief', briefSourcePath);

    const glossaryPreview = runtime.getAssetPreview(glossaryAsset.id);
    const customTmPreview = runtime.getAssetPreview(customTmAsset.id);
    const briefPreview = runtime.getAssetPreview(briefAsset.id);

    assert.equal(glossaryPreview.type, 'glossary');
    assert.equal(glossaryPreview.parsingMode, 'fallback');
    assert.equal(glossaryPreview.smartParsingAvailable, false);
    assert.equal(glossaryPreview.smartParsingRecommended, true);
    assert.equal(glossaryPreview.rowCount, 1);
    assert.deepEqual(glossaryPreview.columns, ['sourceTerm', 'targetTerm', 'srcLang', 'tgtLang', 'forbidden', 'note']);
    assert.equal(glossaryPreview.rows[0].sourceTerm, 'workspace');
    assert.equal(glossaryPreview.rows[0].targetTerm, '工作区');

    assert.equal(customTmPreview.type, 'custom_tm');
    assert.equal(customTmPreview.rowCount, 2);
    assert.equal(customTmPreview.rows[1].targetTerm, 'Annuler');

    assert.equal(briefPreview.type, 'brief');
    assert.match(briefPreview.text, /Use concise tone/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime enables smart asset parsing preview metadata when an AI provider/model is configured', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot
    });

    const glossarySourcePath = path.join(tempRoot, 'smart-preview-glossary.csv');
    fs.writeFileSync(
      glossarySourcePath,
      [
        'Entry_ID,Source Text,Target Text,Entry_Domain,Forbidden,English_United_States',
        '0,Grand & 4X,Grand et 4X,Gaming,false,hero'
      ].join('\n'),
      'utf8'
    );

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });
    assert.ok(provider.models[0].enabled);

    const glossaryAsset = runtime.importAssetFromPath('glossary', glossarySourcePath);
    const preview = runtime.getAssetPreview(glossaryAsset.id);

    assert.equal(preview.smartParsingAvailable, true);
    assert.equal(preview.parsingMode, 'smart');
    assert.equal(preview.usedFallbackMapping, false);
    assert.equal(preview.detectedMapping.sourceTerm.columnName, 'Source Text');
    assert.equal(preview.detectedMapping.targetTerm.columnName, 'Target Text');
    assert.equal(preview.rows[0].note, 'hero');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime persists ai-assisted tb structure metadata in preview for non-standard table tb files', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot
    });

    const glossarySourcePath = path.join(tempRoot, 'structured-preview-glossary.csv');
    fs.writeFileSync(
      glossarySourcePath,
      [
        'Entry_ID,Entry_Subject,Chinese_PRC,Entry_Note',
        '0,Grand & 4X,大战略与4X,genre',
        '1,power,力量,ui'
      ].join('\n'),
      'utf8'
    );

    await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const glossaryAsset = runtime.importAssetFromPath('glossary', glossarySourcePath);
    const preview = runtime.getAssetPreview(glossaryAsset.id);

    assert.equal(preview.tbStructureAvailable, true);
    assert.equal(preview.tbStructuringMode, 'ai_structured');
    assert.equal(typeof preview.tbStructureSummary, 'string');
    assert.match(preview.tbStructureSummary, /entry_subject/i);
    assert.equal(typeof preview.tbStructureFingerprint, 'string');
    assert.ok(preview.tbStructureFingerprint.length > 10);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime applies detected tb structure explicitly after preview and persists it for later use', async () => {
  const tempRoot = createTempAppRoot();
  const providerCalls = [];
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async (payload) => {
          providerCalls.push(payload);
          return { text: 'translated', latencyMs: 20 };
        }
      }
    });

    const glossarySourcePath = path.join(tempRoot, 'apply-structured-glossary.csv');
    fs.writeFileSync(
      glossarySourcePath,
      [
        'Entry_ID,Entry_Subject,Chinese_PRC,Entry_Note',
        '0,Grand & 4X,大战略与4X,genre',
        '1,power,力量,ui'
      ].join('\n'),
      'utf8'
    );

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const glossaryAsset = runtime.importAssetFromPath('glossary', glossarySourcePath);
    const previewBefore = runtime.getAssetPreview(glossaryAsset.id);
    assert.equal(previewBefore.tbStructureAvailable, true);
    assert.equal(previewBefore.tbStructureApplied, false);

    const assetBefore = runtime.getAppState({}).contextBuilder.assets.find((item) => item.id === glossaryAsset.id);
    assert.equal(assetBefore.tbStructure, null);

    const appliedAsset = runtime.applyAssetTbStructure(glossaryAsset.id, {
      tbStructure: previewBefore.tbStructure,
      tbStructureFingerprint: previewBefore.tbStructureFingerprint,
      tbStructureSummary: previewBefore.tbStructureSummary,
      tbStructureSource: previewBefore.tbStructureSource,
      languagePair: previewBefore.languagePair,
      tbStructureConfidence: previewBefore.tbStructureConfidence
    });

    assert.equal(appliedAsset.tbStructure.fingerprint, previewBefore.tbStructureFingerprint);

    const previewAfter = runtime.getAssetPreview(glossaryAsset.id);
    assert.equal(previewAfter.tbStructureApplied, true);

    const assetAfter = runtime.getAppState({}).contextBuilder.assets.find((item) => item.id === glossaryAsset.id);
    assert.equal(assetAfter.tbStructure.fingerprint, previewBefore.tbStructureFingerprint);
    assert.equal(assetAfter.tbStructure.summary, previewBefore.tbStructureSummary);

    const profile = await runtime.saveProfile({
      name: 'Applied TB Profile',
      providerId: provider.id,
      interactiveProviderId: provider.id,
      interactiveModelId: provider.models[0].id,
      fallbackProviderId: provider.id,
      fallbackModelId: provider.models[0].id,
      userPrompt: '{{glossary-text}}\n{{source-text}}',
      assetBindings: [{ assetId: glossaryAsset.id, purpose: 'glossary' }]
    });

    const result = await runtime.translate({
      requestId: 'REQ-TB-APPLY',
      traceId: 'TRACE-TB-APPLY',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'power', plainText: 'power', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].assetContext.tb.structureFingerprint, previewBefore.tbStructureFingerprint);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime infers explicit bilingual tb structure, language pair, and tb metadata text for prompt rendering', async () => {
  const tempRoot = createTempAppRoot();
  const providerCalls = [];
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async (payload) => {
          providerCalls.push(payload);
          return { text: '英雄', latencyMs: 20 };
        }
      }
    });

    const glossarySourcePath = path.join(tempRoot, 'explicit-bilingual-glossary.csv');
    fs.writeFileSync(
      glossarySourcePath,
      [
        'Entry_ID,Entry_Subject,Entry_Domain,Entry_Note,English_United_States_Def,English_United_States,Term_Info,Term_Example,Chinese_PRC_Def,Chinese_PRC,Term_Info,Term_Example',
        '0,Grand & 4X,Gaming,,hero,hero,CasePermissive;HalfPrefix,,英雄,英雄,,',
        '1,Grand & 4X,Gaming,英雄的一种属性,,power,CasePermissive;HalfPrefix,,战力、战斗力,力量,,'
      ].join('\n'),
      'utf8'
    );

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const glossaryAsset = runtime.importAssetFromPath('glossary', glossarySourcePath);
    const preview = runtime.getAssetPreview(glossaryAsset.id);
    assert.equal(preview.tbStructuringMode, 'explicitly_inferred');
    assert.deepEqual(preview.languagePair, { source: 'en-US', target: 'zh-CN' });

    const profile = await runtime.saveProfile({
      name: 'Structured TB Metadata Profile',
      providerId: provider.id,
      interactiveProviderId: provider.id,
      interactiveModelId: provider.models[0].id,
      fallbackProviderId: provider.id,
      fallbackModelId: provider.models[0].id,
      userPrompt: '{{glossary-text}}\n{{tb-metadata-text}}\n{{source-text}}',
      assetBindings: [{ assetId: glossaryAsset.id, purpose: 'glossary' }]
    });

    const result = await runtime.translate({
      requestId: 'REQ-TB-META',
      traceId: 'TRACE-TB-META',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'hero', plainText: 'hero', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(providerCalls.length, 1);
    assert.match(providerCalls[0].tbContext.glossaryText, /"hero" => "英雄"/);
    assert.doesNotMatch(providerCalls[0].tbContext.glossaryText, /power/);
    assert.match(providerCalls[0].tbContext.tbMetadataText, /TB language pair: en-US -> zh-CN/);
    assert.match(providerCalls[0].tbContext.tbMetadataText, /Entry_Subject: Grand & 4X/);
    assert.match(providerCalls[0].tbContext.tbMetadataText, /Entry_Domain: Gaming/);
    assert.match(providerCalls[0].tbContext.tbMetadataText, /Chinese_PRC_Def: 英雄/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime exposes low-confidence manual tb mapping requirements and reuses saved asset mapping', async () => {
  const tempRoot = createTempAppRoot();
  const providerCalls = [];
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async (payload) => {
          providerCalls.push(payload);
          return { text: '保存', latencyMs: 20 };
        }
      }
    });

    const glossarySourcePath = path.join(tempRoot, 'manual-mapping-glossary.csv');
    fs.writeFileSync(
      glossarySourcePath,
      [
        'Primary Text,Localized Text,Reviewer Notes',
        'Save,保存,UI action',
        'Cancel,取消,Dialog button'
      ].join('\n'),
      'utf8'
    );

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const glossaryAsset = runtime.importAssetFromPath('glossary', glossarySourcePath);
    const previewBefore = runtime.getAssetPreview(glossaryAsset.id);

    assert.equal(previewBefore.manualMappingRequired, true);
    assert.deepEqual(previewBefore.manualMapping, {});
    assert.equal(previewBefore.languagePair.source, '');
    assert.equal(previewBefore.languagePair.target, '');

    const updatedAsset = runtime.saveAssetTbConfig(glossaryAsset.id, {
      manualMapping: { srcColumn: 'Primary Text', tgtColumn: 'Localized Text' },
      languagePair: { source: 'EN', target: 'ZH' }
    });

    assert.deepEqual(updatedAsset.tbManualMapping, { srcColumn: 'Primary Text', tgtColumn: 'Localized Text' });
    assert.deepEqual(updatedAsset.tbLanguagePair, { source: 'EN', target: 'ZH' });

    const previewAfter = runtime.getAssetPreview(glossaryAsset.id);
    assert.equal(previewAfter.tbStructuringMode, 'manual_mapping');
    assert.equal(previewAfter.manualMappingRequired, false);
    assert.deepEqual(previewAfter.languagePair, { source: 'en', target: 'zh' });
    assert.equal(previewAfter.rows[0].sourceTerm, 'Save');
    assert.equal(previewAfter.rows[0].targetTerm, '保存');

    const profile = await runtime.saveProfile({
      name: 'Manual TB Profile',
      providerId: provider.id,
      interactiveProviderId: provider.id,
      interactiveModelId: provider.models[0].id,
      fallbackProviderId: provider.id,
      fallbackModelId: provider.models[0].id,
      userPrompt: '{{glossary-text}}\n{{tb-metadata-text}}\n{{source-text}}',
      assetBindings: [{ assetId: glossaryAsset.id, purpose: 'glossary' }]
    });

    const result = await runtime.translate({
      requestId: 'REQ-TB-MANUAL',
      traceId: 'TRACE-TB-MANUAL',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Save', plainText: 'Save', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(providerCalls.length, 1);
    assert.match(providerCalls[0].tbContext.glossaryText, /"Save" => "保存"/);
    assert.match(providerCalls[0].tbContext.tbMetadataText, /TB language pair: en -> zh/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime uses persisted ai-assisted tb structure for match-time prompt injection without full tb dump', async () => {
  const tempRoot = createTempAppRoot();
  const providerCalls = [];
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async (payload) => {
          providerCalls.push(payload);
          return { text: 'translated', latencyMs: 20 };
        }
      }
    });

    const glossarySourcePath = path.join(tempRoot, 'structured-runtime-glossary.csv');
    fs.writeFileSync(
      glossarySourcePath,
      [
        'Entry_ID,Entry_Subject,Chinese_PRC,Entry_Note',
        '0,Grand & 4X,大战略与4X,genre',
        '1,power,力量,ui'
      ].join('\n'),
      'utf8'
    );

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const glossaryAsset = runtime.importAssetFromPath('glossary', glossarySourcePath);
    const preview = runtime.getAssetPreview(glossaryAsset.id);
    const profile = await runtime.saveProfile({
      name: 'Structured TB Profile',
      providerId: provider.id,
      interactiveProviderId: provider.id,
      interactiveModelId: provider.models[0].id,
      fallbackProviderId: provider.id,
      fallbackModelId: provider.models[0].id,
      userPrompt: '{{glossary-text}}\n{{source-text}}',
      assetBindings: [{ assetId: glossaryAsset.id, purpose: 'glossary' }]
    });

    const result = await runtime.translate({
      requestId: 'REQ-TB-STRUCTURE',
      traceId: 'TRACE-TB-STRUCTURE',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Grand & 4X battle', plainText: 'Grand & 4X battle', tmSource: '', tmTarget: '' }]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].assetContext.tb.structureAvailable, true);
    assert.equal(providerCalls[0].assetContext.tb.structureFingerprint, preview.tbStructureFingerprint);
    assert.match(providerCalls[0].tbContext.glossaryText, /Grand & 4X/);
    assert.doesNotMatch(providerCalls[0].tbContext.glossaryText, /power/);
    assert.doesNotMatch(providerCalls[0].tbContext.glossaryText, /Entry_Subject/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime persists preset metadata on editable profiles', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot
    });

    const profile = await runtime.saveProfile({
      name: 'Preset Profile',
      profilePresetId: 'default-context',
      isPresetDerived: true
    });

    assert.equal(profile.profilePresetId, 'default-context');
    assert.equal(profile.isPresetDerived, true);
    assert.equal(runtime.getAppState().contextBuilder.profiles[0].profilePresetId, 'default-context');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime records rendered prompt view for single-segment history entries', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> FR`, latencyMs: 20 })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Prompt View Profile',
      providerId: provider.id,
      translationStyle: 'Use concise UI wording.'
    });

    await runtime.translate({
      requestId: 'REQ-PROMPT-VIEW-SINGLE',
      traceId: 'TRACE-PROMPT-VIEW-SINGLE',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Hello world', plainText: 'Hello world', tmSource: '', tmTarget: '' }]
    });

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.match(history.assembledPrompt.systemPrompt, /## Translation Style[\s\S]*Use concise UI wording\./);
    assert.match(history.assembledPrompt.userPrompt, /"sourceText": "Hello world"/);
    assert.equal(history.contextSources.translationStyle, 'Use concise UI wording.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime history surfaces TM diagnostics when memoQ does not provide fuzzy hints', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> FR`, latencyMs: 20 })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'TM Diagnostics Profile',
      providerId: provider.id
    });

    await runtime.translate({
      requestId: 'REQ-TM-DIAG',
      traceId: 'TRACE-TM-DIAG',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{
        index: 0,
        text: 'Hello world',
        plainText: 'Hello world',
        tmSource: '',
        tmTarget: '',
        tmDiagnostics: {
          supportFuzzyForwarding: true,
          tmHintsRequested: true,
          tmSourcePresent: false,
          tmTargetPresent: false
        }
      }]
    });

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.contextSources.tmHints, '');
    assert.match(history.contextSources.tmDiagnostics, /did not provide a best fuzzy TM hit/i);
    assert.match(history.contextSources.tmDiagnostics, /TM source present: no/i);
    assert.match(history.contextSources.tmDiagnostics, /TM target present: no/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime records rendered prompt view for batch history entries', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateBatch: async (request) => ({
          latencyMs: 20,
          translations: request.segments.map((segment) => ({
            index: segment.index,
            text: `${segment.sourceText} -> DE`
          }))
        })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true, supportsBatch: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Batch Prompt View Profile',
      providerId: provider.id,
      cacheEnabled: false,
      translationStyle: 'Keep UI copy concise and stable.'
    });

    await runtime.translate({
      requestId: 'REQ-PROMPT-VIEW-BATCH',
      traceId: 'TRACE-PROMPT-VIEW-BATCH',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'DE',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'pretranslate' },
      metadata: {},
      segments: [
        { index: 0, text: 'One', plainText: 'One', tmSource: '', tmTarget: '' },
        { index: 1, text: 'Two', plainText: 'Two', tmSource: '', tmTarget: '' }
      ]
    });

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.requestMode, 'batch');
    assert.equal(history.effectiveExecutionMode, 'batch');
    assert.match(history.assembledPrompt.systemPrompt, /Translate batch from EN to DE|You are translating a batch from EN to DE/);
    assert.equal(history.assembledPrompt.items.length, 2);
    assert.match(history.assembledPrompt.items[0].promptInstructions, /"sourceText": "One"/);
    assert.equal(history.assembledPrompt.items[1].sourceText, 'Two');
    assert.equal(history.attempts[0].effectiveExecutionMode, 'batch');
    assert.equal(history.attempts[0].batchSize, 2);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime normalizes generated document summaries into a single plain-text paragraph', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      previewContextClient: {
        start() {},
        dispose() {},
        getStatus() {
          return { available: true, connected: true, state: 'connected' };
        },
        getContext(request) {
          if (request.includeFullText) {
            return {
              available: true,
              documentId: 'DOC-1',
              documentName: 'Guide.xlsx',
              fullText: 'Full source text for summary generation.'
            };
          }

          return {
            available: true,
            documentId: 'DOC-1',
            documentName: 'Guide.xlsx',
            targetText: ''
          };
        },
        recordTranslation() {}
      },
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        generateText: async () => ({
          text: [
            'This is a game localization spreadsheet.',
            '',
            'Audience:',
            '- Players and alliance leaders.',
            '',
            'Terminology:',
            '- Keep hero and troop terms consistent.'
          ].join('\n')
        }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> EN`, latencyMs: 20 })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Summary Profile',
      providerId: provider.id,
      translationStyle: 'Keep UI copy concise.',
      usePreviewContext: true,
      usePreviewSummary: true
    });

    await runtime.translate({
      requestId: 'REQ-SUMMARY-NORMALIZED',
      traceId: 'TRACE-SUMMARY-NORMALIZED',
      contractVersion: '1',
      sourceLanguage: 'ZH',
      targetLanguage: 'EN',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: { documentId: 'DOC-1' },
      segments: [{ index: 0, text: '英雄带兵', plainText: '英雄带兵', tmSource: '', tmTarget: '' }]
    });

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.contextSources.documentSummary.includes('Audience:'), false);
    assert.equal(history.contextSources.documentSummary.includes('Terminology:'), false);
    assert.equal(history.contextSources.documentSummary.includes('\n'), false);
    assert.match(history.assembledPrompt.systemPrompt, /Players and alliance leaders\./);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime history context sources show only matched terminology instead of glossary fallback', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> EN`, latencyMs: 20 })
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'TB Profile',
      providerId: provider.id
    });

    await runtime.translate({
      requestId: 'REQ-HISTORY-TERMS',
      traceId: 'TRACE-HISTORY-TERMS',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'FR',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: {},
      segments: [{ index: 0, text: 'Hello world', plainText: 'Hello world', tmSource: '', tmTarget: '' }]
    });

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.contextSources.terminology, '');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime executes split batches concurrently within route slot limits', async () => {
  const tempRoot = createTempAppRoot();
  let activeCalls = 0;
  let maxActiveCalls = 0;
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateBatch: async (request) => {
          activeCalls += 1;
          maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
          await new Promise((resolve) => setTimeout(resolve, 25));
          activeCalls -= 1;
          return {
            latencyMs: 25,
            translations: request.segments.map((segment) => ({
              index: segment.index,
              text: `${segment.sourceText} -> DE`
            }))
          };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{
        modelName: 'gpt-4.1-mini',
        enabled: true,
        concurrencyLimit: 2
      }]
    });

    const profile = await runtime.saveProfile({
      name: 'Parallel Batch Profile',
      providerId: provider.id,
      cacheEnabled: false
    });

    const result = await runtime.translate({
      requestId: 'REQ-BATCH-PARALLEL',
      traceId: 'TRACE-BATCH-PARALLEL',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'DE',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'pretranslate' },
      metadata: {},
      segments: Array.from({ length: 16 }, (_, index) => ({
        index,
        text: `Segment ${index}`,
        plainText: `Segment ${index}`,
        tmSource: '',
        tmTarget: ''
      }))
    });

    assert.equal(result.statusCode, 200);
    assert.equal(maxActiveCalls, 2);
    assert.deepEqual(
      result.body.translations.map((item) => item.index),
      Array.from({ length: 16 }, (_, index) => index)
    );

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.attempts.length, 2);
    assert.ok(history.attempts.every((attempt) => attempt.success));
    assert.deepEqual(
      history.attempts.map((attempt) => attempt.segmentIndexes),
      [
        Array.from({ length: 8 }, (_, index) => index),
        Array.from({ length: 8 }, (_, index) => index + 8)
      ]
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime records summary cache and generation debug details in history', async () => {
  const tempRoot = createTempAppRoot();
  let summaryCalls = 0;
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      previewContextClient: {
        start() {},
        dispose() {},
        getStatus() {
          return { state: 'ready' };
        },
        getContext() {
          return {
            available: true,
            documentId: 'doc-1',
            documentName: 'Doc 1',
            importPath: 'C:/docs/doc-1.docx',
            fullText: 'A long source document used for summary generation.',
            activePreviewPartIds: ['part-1'],
            previewPartId: 'part-1',
            previewMatchMode: 'document'
          };
        }
      },
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 20 }),
        generateText: async () => {
          summaryCalls += 1;
          return { text: 'Generated summary.' };
        }
      }
    });

    const provider = await runtime.saveProvider({
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Summary Profile',
      providerId: provider.id,
      interactiveProviderId: provider.id,
      interactiveModelId: provider.models[0].id,
      usePreviewContext: true,
      usePreviewSummary: true,
      userPrompt: '{{summary-text}}\n{{source-text}}'
    });

    const payload = {
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'interactive' },
      metadata: { documentId: 'doc-1' },
      segments: [{ index: 0, text: 'Hello', plainText: 'Hello', tmSource: '', tmTarget: '' }]
    };

    const first = await runtime.translate({
      requestId: 'REQ-SUMMARY-1',
      traceId: 'TRACE-SUMMARY-1',
      ...payload
    });
    const second = await runtime.translate({
      requestId: 'REQ-SUMMARY-2',
      traceId: 'TRACE-SUMMARY-2',
      ...payload
    });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(summaryCalls, 1);

    const history = runtime.getAppState().historyExplorer.items;
    assert.equal(history[0].assembly.previewContext.summary.requested, true);
    assert.equal(history[0].assembly.previewContext.summary.cacheHit, true);
    assert.equal(history[0].assembly.previewContext.summary.generated, false);
    assert.equal(history[0].assembly.previewContext.summary.available, true);
    assert.equal(history[1].assembly.previewContext.summary.requested, true);
    assert.equal(history[1].assembly.previewContext.summary.cacheHit, false);
    assert.equal(history[1].assembly.previewContext.summary.generated, true);
    assert.equal(history[1].assembly.previewContext.summary.available, true);
    assert.equal(history[1].assembly.previewContext.summary.routeProviderName, 'OpenAI');
    assert.equal(history[1].assembly.previewContext.summary.routeModel, 'gpt-4.1-mini');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime retries a failed batch on the same route before using a fallback route', async () => {
  const tempRoot = createTempAppRoot();
  const batchCalls = [];
  let sequentialCalls = 0;
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateBatch: async ({ provider, segments }) => {
          batchCalls.push({
            provider: provider.name,
            indexes: segments.map((segment) => segment.index)
          });
          if (provider.name === 'Primary') {
            throw new Error('batch response missing index 1');
          }
          return {
            latencyMs: 15,
            translations: segments.map((segment) => ({
              index: segment.index,
              text: `${segment.sourceText} -> JA`
            })),
            requestMetadata: {
              mode: 'batch',
              batchIndexes: segments.map((segment) => segment.index),
              systemPrompt: `Batch system ${provider.name}`,
              items: segments.map((segment) => ({
                index: segment.index,
                sourceText: segment.sourceText,
                promptInstructions: `Item ${segment.sourceText}`
              }))
            }
          };
        },
        translateSegment: async () => {
          sequentialCalls += 1;
          return { text: 'same-route-single', latencyMs: 5 };
        }
      }
    });

    const primary = await runtime.saveProvider({
      name: 'Primary',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });
    const fallback = await runtime.saveProvider({
      name: 'Fallback',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'Fallback Batch Profile',
      providerId: primary.id,
      fallbackProviderId: fallback.id,
      fallbackModelId: fallback.models[0].id,
      promptTemplates: {
        batch: {
          systemPrompt: 'Batch system {{target-language}}',
          userPrompt: 'Batch user {{source-text}}'
        }
      }
    });

    const result = await runtime.translate({
      requestId: 'REQ-BATCH-FALLBACK',
      traceId: 'TRACE-BATCH-FALLBACK',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'JA',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'pretranslate' },
      metadata: {},
      segments: [
        { index: 0, text: 'Alpha', plainText: 'Alpha', tmSource: '', tmTarget: '' },
        { index: 1, text: 'Beta', plainText: 'Beta', tmSource: '', tmTarget: '' }
      ]
    });

    assert.equal(result.statusCode, 200);
    assert.equal(sequentialCalls, 2);
    assert.deepEqual(batchCalls, [
      { provider: 'Primary', indexes: [0, 1] }
    ]);

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.providerName, 'Primary');
    assert.equal(history.finalizedByFallbackRoute, false);
    assert.equal(history.effectiveExecutionMode, 'single');
    assert.equal(history.attempts.length, 3);
    assert.equal(history.attempts[0].success, false);
    assert.equal(history.attempts[0].effectiveExecutionMode, 'batch');
    assert.equal(history.attempts[1].success, true);
    assert.equal(history.attempts[1].effectiveExecutionMode, 'single');
    assert.equal(history.promptView.single.requestCount, 2);
    assert.equal(history.promptView.single.requests[1].targetText, 'same-route-single');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime fails the whole request when every batch route and single-route fallback fails', async () => {
  const tempRoot = createTempAppRoot();
  let sequentialCalls = 0;
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot,
      providerRegistry: {
        testConnection: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
        translateBatch: async ({ provider }) => {
          throw new Error(`batch failed for ${provider.name}`);
        },
        translateSegment: async () => {
          sequentialCalls += 1;
          throw new Error('single failed');
        }
      }
    });

    const primary = await runtime.saveProvider({
      name: 'Primary',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });
    const fallback = await runtime.saveProvider({
      name: 'Fallback',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
    });

    const profile = await runtime.saveProfile({
      name: 'All Batch Fail',
      providerId: primary.id,
      fallbackProviderId: fallback.id,
      fallbackModelId: fallback.models[0].id
    });

    const result = await runtime.translate({
      requestId: 'REQ-BATCH-FAIL',
      traceId: 'TRACE-BATCH-FAIL',
      contractVersion: '1',
      sourceLanguage: 'EN',
      targetLanguage: 'JA',
      requestType: 'Plaintext',
      profileResolution: { profileId: profile.id, useCase: 'pretranslate' },
      metadata: {},
      segments: [
        { index: 0, text: 'Alpha', plainText: 'Alpha', tmSource: '', tmTarget: '' },
        { index: 1, text: 'Beta', plainText: 'Beta', tmSource: '', tmTarget: '' }
      ]
    });

    assert.equal(result.statusCode, 502);
    assert.equal(sequentialCalls, 4);

    const history = runtime.getAppState().historyExplorer.items[0];
    assert.equal(history.status, 'failed');
    assert.equal(history.effectiveExecutionMode, 'single');
    assert.equal(history.segments[0].targetText, '');
    assert.equal(history.attempts.length, 6);
    assert.equal(history.attempts[0].effectiveExecutionMode, 'batch');
    assert.equal(history.attempts[1].effectiveExecutionMode, 'single');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runtime rejects unsupported asset imports', async () => {
  const tempRoot = createTempAppRoot();
  try {
    const runtime = await createRuntime({
      appDataRoot: tempRoot
    });

    const unsupportedPath = path.join(tempRoot, 'brief.docx');
    fs.writeFileSync(unsupportedPath, 'not supported', 'utf8');

    assert.throws(
      () => runtime.importAssetFromPath('brief', unsupportedPath),
      /unsupported brief file type/i
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
