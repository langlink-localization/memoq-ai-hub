import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { useAssetPreviewController } from '../src/renderer/src/hooks/useAssetPreviewController.mjs';
import { requestEditorDeparture } from '../src/renderer/src/editorNavigation.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function mountAssets(t, api, overrides = {}) {
  let controller, renderer;
  const errors = [];
  function Harness() {
    controller = useAssetPreviewController({ api, assets: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      t: (key) => key, message: { success() {} }, notifyError: (error) => errors.push(error), refresh: async () => {}, ...overrides });
    return null;
  }
  act(() => { renderer = create(createElement(Harness)); });
  t.after(() => act(() => renderer.unmount()));
  return { current: () => controller, errors };
}

test('asset controller keeps the new asset selected when an old preview resolves last', async (t) => {
  const a = deferred(), b = deferred();
  const h = mountAssets(t, { getAssetPreview: (id) => (id === 'a' ? a : b).promise });
  let first, second;
  act(() => { first = h.current().openAssetPreview('a'); });
  act(() => { second = h.current().openAssetPreview('b'); });
  await act(async () => { b.resolve({ rowCount: 2, manualMapping: { srcColumn: 'B' } }); await second; });
  await act(async () => { a.resolve({ rowCount: 1, manualMapping: { srcColumn: 'A' } }); await first; });
  assert.equal(h.current().assetPreviewRecord.id, 'b');
  assert.equal(h.current().assetPreviewData.rowCount, 2);
  assert.equal(h.current().assetPreviewManualDraft.srcColumn, 'B');
  assert.equal(h.current().assetPreviewLoading, false);
});

test('asset controller ignores a rejected request after drawer dismissal', async (t) => {
  const gate = deferred();
  const h = mountAssets(t, { getAssetPreview: () => gate.promise });
  let pending;
  act(() => { pending = h.current().openAssetPreview('a'); });
  act(() => h.current().closeAssetPreview());
  await act(async () => { gate.reject(new Error('old failure')); await pending; });
  assert.equal(h.current().assetPreviewOpen, false);
  assert.equal(h.current().assetPreviewData, null);
  assert.equal(h.current().assetPreviewLoading, false);
  assert.deepEqual(h.errors, []);
});

test('asset controller retries a failed preview in the same drawer', async (t) => {
  let calls = 0;
  const h = mountAssets(t, { getAssetPreview: async () => {
    if (++calls === 1) throw new Error('temporary parse failure');
    return { rowCount: 4 };
  } });
  await act(async () => { await h.current().openAssetPreview('a'); });
  assert.equal(h.current().assetPreviewData.error, 'temporary parse failure');
  await act(async () => { await h.current().retryAssetPreview(); });
  assert.equal(h.current().assetPreviewOpen, true);
  assert.equal(h.current().assetPreviewRecord.id, 'a');
  assert.equal(h.current().assetPreviewData.rowCount, 4);
});

test('asset mapping save rejects duplicate submissions and drawer dismissal while writing', async (t) => {
  const gate = deferred();
  let saves = 0;
  const h = mountAssets(t, { getAssetPreview: async () => ({ rowCount: 1 }),
    saveAssetTbConfig: () => { saves += 1; return gate.promise; } });
  await act(async () => { await h.current().openAssetPreview('a'); });
  let pending;
  act(() => {
    pending = h.current().saveAssetPreviewTbConfig();
    void h.current().saveAssetPreviewTbConfig();
    h.current().closeAssetPreview();
    void h.current().openAssetPreview('b');
  });
  assert.equal(saves, 1);
  assert.equal(h.current().assetPreviewSaving, true);
  assert.equal(h.current().assetPreviewOpen, true);
  assert.equal(h.current().assetPreviewRecord.id, 'a');
  await act(async () => { gate.resolve(); await pending; });
  assert.equal(h.current().assetPreviewSaving, false);
});

test('editor departure waits for explicit discard and blocks departure during a write', () => {
  let confirm, departures = 0;
  const options = { dirty: true, busy: false, name: 'Rule', t: (key) => key,
    modal: { confirm: (value) => { confirm = value; } }, proceed: () => { departures += 1; } };
  requestEditorDeparture(options);
  assert.equal(departures, 0);
  assert.equal(confirm.cancelText, 'navigation.stay');
  confirm.onOk();
  assert.equal(departures, 1);
  confirm = null;
  requestEditorDeparture({ ...options, busy: true });
  assert.equal(confirm, null);
  assert.equal(departures, 1);
  requestEditorDeparture({ ...options, dirty: false });
  assert.equal(departures, 2);
});
import { useReducedMotion } from '../src/renderer/src/hooks/useReducedMotion.mjs';

test('reduced-motion follows the system setting and releases the change listener', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  let listener, removed, renderer, reduced;
  const query = { matches: true, addEventListener: (_, callback) => { listener = callback; },
    removeEventListener: (_, callback) => { removed = callback; } };
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => query });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'matchMedia', previous);
    else delete globalThis.matchMedia;
  });
  function Harness() { reduced = useReducedMotion(); return null; }
  act(() => { renderer = create(createElement(Harness)); });
  assert.equal(reduced, true);
  act(() => { query.matches = false; listener(); });
  assert.equal(reduced, false);
  act(() => renderer.unmount());
  assert.equal(removed, listener);
});
import { useProviderController } from '../src/renderer/src/hooks/useProviderController.mjs';
import { createPendingOperationRegistry } from '../src/renderer/src/uiBehavior.mjs';

test('provider controller rejects duplicate saves until the current save settles', async (t) => {
  const gate = deferred();
  const pending = createPendingOperationRegistry();
  let controller, renderer, calls = 0;
  const provider = { id: 'provider-1', name: 'Test provider', type: 'openai', enabled: true,
    status: 'connected', hasSecret: true, lastCheckedAt: '2026-09-12T00:00:00Z',
    models: [{ id: 'model-1', modelName: 'test-model', enabled: true }] };
  function Harness() {
    controller = useProviderController({
      api: { saveProvider: () => { calls += 1; return gate.promise; } },
      t: (key) => key, message: { success() {} }, modal: {}, notifyError: (error) => { throw error; },
      refresh: async () => {}, requestNavigation() {}, requestPageNavigation() {},
      state: { providerHub: { providers: [provider] } },
      beginPendingOperation: (key, setter) => {
        const end = pending.begin(key);
        if (!end) return null;
        setter(true);
        return () => { end(); setter(false); };
      }
    });
    return null;
  }
  act(() => { renderer = create(createElement(Harness)); });
  t.after(() => act(() => renderer.unmount()));
  let first, second;
  act(() => { first = controller.saveCurrentProvider(); second = controller.saveCurrentProvider(); });
  assert.equal(calls, 1);
  assert.equal(await second, false);
  assert.equal(controller.savingProvider, true);
  await act(async () => { gate.resolve(provider); await first; });
  assert.equal(controller.savingProvider, false);
});
