const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createRuntime } = require('../src/runtime/runtime');

function createTempAppRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-qa-history-'));
}

async function createHistoryHarness(tempRoot) {
  const runtime = await createRuntime({
    appDataRoot: tempRoot,
    providerRegistry: {
      testConnection: async () => ({ ok: true, latencyMs: 5, message: 'ok' }),
      checkQuality: async () => ({ output: JSON.stringify({ findings: [] }), latencyMs: 3 })
    }
  });
  return runtime;
}

async function runCheck(runtime, overrides = {}) {
  return runtime.checkQaSegment({
    segment: { source: 'Total: 10 USD on 2026-08-15.', target: '合计：10 美元（2026-08-15）。' },
    document: { id: 'doc-1', name: 'Doc 1' },
    languages: { source: 'EN', target: 'ZH' },
    ...overrides
  });
}

test('QA history lists persisted checks with filters, detail, delete, and export', async () => {
  const tempRoot = createTempAppRoot();
  const runtime = await createHistoryHarness(tempRoot);
  const exported = [];

  try {
    const manual = await runCheck(runtime);
    const preview = await runCheck(runtime, {
      trigger: 'preview-target-changed',
      document: { id: 'doc-2', name: 'Doc 2' }
    });
    await runCheck(runtime);

    const history = runtime.getQaHistory({});
    assert.equal(history.items.length, 3);
    assert.deepEqual([...new Set(history.items.map((item) => item.trigger))].sort(), ['manual', 'preview-target-changed']);
    assert.equal(typeof history.items[0].findingCounts.total, 'number');
    assert.equal(typeof history.items[0].segment.source, 'string');
    assert.match(history.items[0].requestId, /^[0-9a-f-]{36}$/i);
    assert.ok(history.items.every((item) => item.updatedAt >= history.items[history.items.length - 1].updatedAt));

    const manualOnly = runtime.getQaHistory({ trigger: 'manual' });
    assert.equal(manualOnly.items.length, 2);
    assert.ok(manualOnly.items.every((item) => item.trigger === 'manual'));

    const docOnly = runtime.getQaHistory({ documentId: 'doc-2' });
    assert.equal(docOnly.items.length, 1);
    assert.equal(docOnly.items[0].documentName, 'Doc 2');

    const limited = runtime.getQaHistory({ limit: 2 });
    assert.equal(limited.items.length, 2);

    const entry = runtime.getQaHistoryEntry({ requestId: manual.requestId });
    assert.equal(entry.result.requestId, manual.requestId);
    assert.equal(entry.item.requestId, manual.requestId);
    assert.deepEqual(entry.feedback, []);

    const deleteResult = runtime.deleteQaHistory([preview.requestId]);
    assert.equal(deleteResult.deletedCount, 1);
    assert.equal(runtime.getQaHistory({}).items.length, 2);
    assert.equal(runtime.getQaHistoryEntry({ requestId: preview.requestId }), null);

    const csvExport = runtime.exportQaHistory({ format: 'csv' });
    exported.push(csvExport.path);
    assert.equal(fs.existsSync(csvExport.path), true);
    assert.equal(csvExport.count, 2);

    const xlsxExport = runtime.exportQaHistory({ format: 'xlsx', scope: 'selected', selectedIds: [manual.requestId] });
    exported.push(xlsxExport.path);
    assert.equal(xlsxExport.count, 1);
    assert.equal(fs.existsSync(xlsxExport.path), true);
  } finally {
    runtime.dispose?.();
    for (const filePath of exported) {
      fs.rmSync(filePath, { force: true });
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('QA history feedback entries are returned with the history detail', async () => {
  const tempRoot = createTempAppRoot();
  const runtime = await createHistoryHarness(tempRoot);

  try {
    const result = await runCheck(runtime);
    const finding = (result.findings || [])[0];
    if (finding) {
      runtime.saveQaFeedback({ requestId: result.requestId, findingId: finding.id, state: 'false-positive' });
      const entry = runtime.getQaHistoryEntry({ requestId: result.requestId });
      assert.equal(entry.feedback.length, 1);
      assert.equal(entry.feedback[0].state, 'false-positive');
    } else {
      const entry = runtime.getQaHistoryEntry({ requestId: result.requestId });
      assert.deepEqual(entry.feedback, []);
    }
  } finally {
    runtime.dispose?.();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
