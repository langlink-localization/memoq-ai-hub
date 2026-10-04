'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createRuntimeHistoryExport } = require('../src/runtime/runtimeHistoryExport');

function createEntry(id) {
  return {
    id,
    requestId: `request-${id}`,
    projectId: 'project-1',
    client: 'Client',
    domain: 'Domain',
    subject: 'Subject',
    documentId: 'document-1',
    projectGuid: 'guid-1',
    profileName: 'Profile',
    providerName: 'Provider',
    model: 'model',
    submittedAt: '2026-10-04T01:00:00.000Z',
    completedAt: '2026-10-04T01:00:01.000Z',
    status: 'success',
    segments: [{
      sourceText: 'Hello',
      targetText: '你好',
      tmSource: '',
      tmTarget: ''
    }]
  };
}

test('history export writes the selected rows as csv without loading every entry', () => {
  const exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-history-export-'));
  const sheets = [];
  const exporter = createRuntimeHistoryExport({
    loadHistoryEntries: () => [createEntry('keep'), createEntry('drop')],
    exportsDir,
    now: () => 42,
    loadXlsx: () => ({
      utils: {
        json_to_sheet: (rows) => {
          sheets.push(rows);
          return rows;
        },
        sheet_to_csv: () => 'requestId,source,target\n'
      }
    })
  });

  const exported = exporter.exportHistory({
    format: 'csv',
    scope: 'selected',
    selectedIds: ['keep']
  });

  assert.equal(exported.count, 1);
  assert.equal(exported.path, path.join(exportsDir, 'history-export-42.csv'));
  assert.equal(sheets[0][0].requestId, 'request-keep');
  assert.equal(fs.readFileSync(exported.path, 'utf8'), 'requestId,source,target\n');
  fs.rmSync(exportsDir, { recursive: true, force: true });
});
