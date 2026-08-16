const test = require('node:test');
const assert = require('node:assert/strict');

const {
  settleActivePreviewSnapshot,
  previewSnapshotSignature
} = require('../src/runtime/previewSnapshotSettle');

function createPayload(overrides = {}) {
  return {
    mappingCertain: true,
    document: { id: 'doc-1', name: 'Doc' },
    segment: { previewPartId: 'part-1', segmentIndex: 3, source: 'src', target: 'tgt' },
    languages: { source: 'ZH', target: 'JA' },
    revision: { previewRevision: 1, capturedAt: '2026-08-16T00:00:00.000Z' },
    ...overrides
  };
}

function createHarness(readSequence) {
  let index = 0;
  const sleeps = [];
  return {
    readActive: () => {
      const value = readSequence[Math.min(index, readSequence.length - 1)];
      index += 1;
      return value;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    sleeps,
    readCount: () => index
  };
}

test('settle returns immediately when consecutive reads agree', async () => {
  const stable = createPayload();
  const harness = createHarness([stable]);

  const settled = await settleActivePreviewSnapshot({
    readActive: harness.readActive,
    sleep: harness.sleep,
    settleMs: 400,
    maxWaits: 3
  });

  assert.equal(settled, stable);
  assert.deepEqual(harness.sleeps, [400], 'one settle window is enough for stable data');
});

test('settle keeps waiting while the preview cache is still updating', async () => {
  const stale = createPayload();
  const midFlight = createPayload({
    segment: { previewPartId: 'part-1', segmentIndex: 3, source: 'src', target: 'updated target' },
    revision: { previewRevision: 2, capturedAt: '2026-08-16T00:00:01.000Z' }
  });
  const harness = createHarness([stale, midFlight, midFlight]);

  const settled = await settleActivePreviewSnapshot({
    readActive: harness.readActive,
    sleep: harness.sleep,
    settleMs: 250,
    maxWaits: 3
  });

  assert.equal(settled, midFlight, 'the first stable read after the in-flight push wins');
  assert.deepEqual(harness.sleeps, [250, 250]);
});

test('settle gives up after the configured wait budget and returns the latest read', async () => {
  const first = createPayload();
  const second = createPayload({ revision: { previewRevision: 2, capturedAt: 't2' } });
  const third = createPayload({ revision: { previewRevision: 3, capturedAt: 't3' } });
  const harness = createHarness([first, second, third]);

  const settled = await settleActivePreviewSnapshot({
    readActive: harness.readActive,
    sleep: harness.sleep,
    settleMs: 100,
    maxWaits: 2
  });

  assert.equal(settled, third, 'after exhausting waits the newest snapshot is used');
  assert.deepEqual(harness.sleeps, [100, 100]);
});

test('unmapped and missing payloads share a stable signature', () => {
  assert.equal(previewSnapshotSignature(null), 'unmapped');
  assert.equal(previewSnapshotSignature({ mappingCertain: false }), 'unmapped');
  assert.notEqual(previewSnapshotSignature(createPayload()), 'unmapped');
});

test('settle works without a reader and yields null', async () => {
  const settled = await settleActivePreviewSnapshot({ sleep: async () => {} });
  assert.equal(settled, null);
});
