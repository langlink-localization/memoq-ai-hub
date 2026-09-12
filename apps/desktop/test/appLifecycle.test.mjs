import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVisibleInterval,
  loadHistoryDetail
} from '../src/renderer/src/hooks/useAppLifecycle.mjs';

test('visible interval skips hidden documents and clears its timer', () => {
  let scheduled;
  let clearedTimer;
  let calls = 0;
  const documentRef = { hidden: true };
  const cleanup = createVisibleInterval({
    enabled: true,
    delayMs: 1000,
    callback: () => { calls += 1; },
    documentRef,
    windowRef: {
      setInterval(callback, delayMs) {
        scheduled = { callback, delayMs };
        return 42;
      },
      clearInterval(timer) {
        clearedTimer = timer;
      }
    }
  });

  assert.equal(scheduled.delayMs, 1000);
  scheduled.callback();
  assert.equal(calls, 0);
  documentRef.hidden = false;
  scheduled.callback();
  assert.equal(calls, 1);
  cleanup();
  assert.equal(clearedTimer, 42);
});

test('disabled visible interval does not allocate a timer', () => {
  let allocated = false;
  const cleanup = createVisibleInterval({
    enabled: false,
    delayMs: 1000,
    callback() {},
    windowRef: {
      setInterval() {
        allocated = true;
      }
    }
  });
  cleanup();
  assert.equal(allocated, false);
});

test('history detail loader publishes loading and resolved state', async () => {
  const updates = [];
  loadHistoryDetail({
    api: { getHistoryEntry: async (id) => ({ id, text: 'resolved' }) },
    selectedHistoryId: 'history-1',
    t: (key) => key,
    update: (patch) => updates.push(patch)
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(updates, [
    { record: null, loading: true, error: '' },
    { record: { id: 'history-1', text: 'resolved' } },
    { loading: false }
  ]);
});

test('history detail loader ignores a response after cancellation', async () => {
  let resolveEntry;
  const updates = [];
  const cleanup = loadHistoryDetail({
    api: { getHistoryEntry: () => new Promise((resolve) => { resolveEntry = resolve; }) },
    selectedHistoryId: 'history-2',
    t: (key) => key,
    update: (patch) => updates.push(patch)
  });

  cleanup();
  resolveEntry({ id: 'history-2' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, [{ record: null, loading: true, error: '' }]);
});

test('history detail loader fails closed when the bridge is unavailable', () => {
  const updates = [];
  loadHistoryDetail({
    api: {},
    selectedHistoryId: 'history-3',
    t: (key) => key,
    update: (patch) => updates.push(patch)
  });
  assert.deepEqual(updates, [
    { record: null, loading: true, error: '' },
    { record: null, loading: false, error: 'history.detailLoadFailed' }
  ]);
});

test('visible polling never overlaps a slow request and resumes after rejection', async () => {
  let tick, reject;
  let calls = 0;
  const cleanup = createVisibleInterval({ enabled: true, delayMs: 10,
    callback: () => { calls += 1; return new Promise((_, fail) => { reject = fail; }); },
    documentRef: { hidden: false }, windowRef: { setInterval: (callback) => { tick = callback; }, clearInterval() {} }
  });
  tick(); tick(); tick();
  assert.equal(calls, 1);
  reject(new Error('temporary'));
  await new Promise((resolve) => setImmediate(resolve));
  tick();
  assert.equal(calls, 2);
  cleanup(); tick();
  assert.equal(calls, 2);
  reject(new Error('disposed'));
  await new Promise((resolve) => setImmediate(resolve));
});

test('immediate polling holds the same request slot as later ticks', async () => {
  let tick, resolve;
  let calls = 0;
  const cleanup = createVisibleInterval({ enabled: true, immediate: true, delayMs: 10,
    callback: () => { calls += 1; return new Promise((done) => { resolve = done; }); },
    documentRef: { hidden: false }, windowRef: { setInterval: (callback) => { tick = callback; }, clearInterval() {} }
  });
  assert.equal(calls, 1);
  tick();
  assert.equal(calls, 1);
  resolve();
  await new Promise((done) => setImmediate(done));
  tick();
  assert.equal(calls, 2);
  cleanup(); resolve();
});
