'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeBilingualInspection } = require('../src/runtime/runtimeBilingualInspection');

test('bilingual inspection sends the parsed document to QA and names the report from the file', async () => {
  const checked = [];
  const reports = [];
  const inspection = createRuntimeBilingualInspection({
    exportsDir: 'D:\\exports',
    now: () => 42,
    qaService: {
      async checkDocument(payload) {
        checked.push(payload);
        return { status: 'complete' };
      }
    },
    parseBilingualFile: () => ({
      document: { name: 'Spec.mqxliff' },
      languages: { source: 'en', target: 'zh' },
      segments: [{ source: 'Hello' }]
    }),
    writeQaReports: (result, exportsDir, reportName) => {
      reports.push({ result, exportsDir, reportName });
      return { json: `${reportName}.json` };
    }
  });

  const inspected = await inspection.inspectBilingualFile({
    filePath: 'C:\\jobs\\Spec.mqxliff',
    documentId: 'document-1'
  });

  assert.equal(checked[0].trigger, 'import');
  assert.equal(checked[0].document.name, 'Spec.mqxliff');
  assert.equal(checked[0].documentId, 'document-1');
  assert.equal(reports[0].exportsDir, 'D:\\exports');
  assert.equal(reports[0].reportName, 'qa-Spec-42');
  assert.equal(inspected.containsCustomerText, true);
  assert.equal(inspected.result.status, 'complete');
});
