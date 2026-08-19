'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createRuntimeQaHistoryService } = require('../src/runtime/runtimeQaHistoryService');
const { createRuntimePromptPresetStore } = require('../src/runtime/runtimePromptPresetStore');
const { normalizePromptPresets } = require('../src/shared/promptPresets');

test('QA history service keeps persistence and spreadsheet loading behind its boundary', () => {
  const exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-qa-history-service-'));
  const items = [{
    requestId: 'request-1',
    updatedAt: '2026-08-20T00:00:00.000Z',
    documentName: 'Document',
    trigger: 'manual',
    status: 'complete',
    segment: { source: 'Source', target: 'Target' },
    findingCounts: { major: 1 },
    execution: { aiStatus: 'complete', aiModel: 'model' }
  }];
  let spreadsheetLoads = 0;
  const persistence = {
    listQaResultsAll: () => items,
    readQaResult: (requestId) => requestId === 'request-1' ? { requestId } : null,
    listQaFeedback: () => [{ state: 'accepted' }],
    deleteQaResults: (requestIds) => ({ deletedCount: requestIds.length })
  };
  const service = createRuntimeQaHistoryService({
    persistence,
    exportsDir,
    now: () => 123,
    loadXlsx: () => {
      spreadsheetLoads += 1;
      return {
        utils: {
          json_to_sheet: (rows) => rows,
          sheet_to_csv: () => 'requestId,status\nrequest-1,complete\n',
          book_new: () => ({}),
          book_append_sheet: () => {}
        },
        writeFile: () => {}
      };
    }
  });

  try {
    assert.equal(service.list({}).items.length, 1);
    assert.equal(service.getEntry({ requestId: 'request-1' }).feedback[0].state, 'accepted');
    assert.equal(service.remove(['request-1']).deletedCount, 1);
    assert.equal(spreadsheetLoads, 0);

    const exported = service.exportHistory({ format: 'csv' });
    assert.equal(spreadsheetLoads, 1);
    assert.equal(exported.count, 1);
    assert.equal(path.basename(exported.path), 'qa-history-export-123.csv');
    assert.match(fs.readFileSync(exported.path, 'utf8'), /request-1,complete/);
  } finally {
    fs.rmSync(exportsDir, { recursive: true, force: true });
  }
});

test('prompt preset store owns state mutation while preserving built-in protections', () => {
  let state = { promptPresets: normalizePromptPresets([]) };
  let writes = 0;
  const store = createRuntimePromptPresetStore({
    loadState: () => structuredClone(state),
    saveState: (nextState) => {
      state = structuredClone(nextState);
      writes += 1;
    },
    nowIso: () => '2026-08-20T00:00:00.000Z'
  });

  const saved = store.save({
    name: 'Custom QA',
    scope: 'qa',
    systemPrompt: 'Review {{source-language}} to {{target-language}}.',
    userPrompt: 'Source: {{source-text}}\nTarget: {{target-text}}'
  });
  assert.equal(saved.updatedAt, '2026-08-20T00:00:00.000Z');
  assert.equal(writes, 1);
  assert.equal(store.remove(saved.id).deleted, true);
  assert.equal(writes, 2);
  assert.throws(() => store.remove('builtin-qa-default'), /cannot be deleted/i);

  const restored = store.restoreBuiltin('builtin-qa-default');
  assert.equal(restored.builtin, true);
  assert.equal(writes, 3);
});
