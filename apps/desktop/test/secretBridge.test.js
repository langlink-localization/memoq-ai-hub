const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkerSecretStore } = require('../src/secretBridge');

function createIpcHarness(options = {}) {
  const sent = [];
  const store = createWorkerSecretStore({
    useMainProcess: true,
    send: (message) => {
      sent.push(message);
    },
    requestTimeoutMs: Number.isFinite(Number(options.requestTimeoutMs)) ? options.requestTimeoutMs : 5000,
    logger: { info() {}, warn() {}, error() {} }
  });

  function respondFromMain(filter, result) {
    const request = [...sent].reverse().find((message) => message.type === 'main-request' && filter(message));
    assert.ok(request, `expected a main request matching ${filter}`);
    store.handleMessage({ type: 'main-response', id: request.id, ok: true, result });
  }

  return { store, sent, respondFromMain };
}

test('worker secret bridge loads ids and serves has() synchronously in main mode', async () => {
  const { store, respondFromMain } = createIpcHarness();

  const ready = store.ready();
  await new Promise((resolve) => setImmediate(resolve));
  respondFromMain((message) => message.channel === 'secrets.listIds', { ids: ['provider-1', 'provider-2'] });
  await ready;

  assert.equal(store.has('provider-1'), true);
  assert.equal(store.has('provider-missing'), false);
});

test('worker secret bridge round-trips get/set/delete over the main channel and caches decrypted values', async () => {
  const { store, respondFromMain, sent } = createIpcHarness();

  const pendingGet = store.get('provider-1');
  await new Promise((resolve) => setImmediate(resolve));
  respondFromMain((message) => message.channel === 'secrets.get', { value: 'sk-cached' });
  assert.equal(await pendingGet, 'sk-cached');

  // Second read must be served from the in-memory cache without another IPC round trip.
  assert.equal(await store.get('provider-1'), 'sk-cached');
  assert.equal(sent.filter((message) => message.channel === 'secrets.get').length, 1);

  const pendingSet = store.set('provider-1', 'sk-rotated');
  await new Promise((resolve) => setImmediate(resolve));
  respondFromMain((message) => message.channel === 'secrets.set', { ok: true });
  await pendingSet;
  assert.equal(await store.get('provider-1'), 'sk-rotated', 'set must refresh the decrypted cache');

  const pendingDelete = store.delete('provider-1');
  await new Promise((resolve) => setImmediate(resolve));
  respondFromMain((message) => message.channel === 'secrets.delete', { ok: true });
  await pendingDelete;

  // After a delete the cache is invalidated, so a fresh read goes back to the main process.
  const pendingDeletedGet = store.get('provider-1');
  await new Promise((resolve) => setImmediate(resolve));
  respondFromMain((message) => message.channel === 'secrets.get', { value: '' });
  assert.equal(await pendingDeletedGet, '');
});

test('worker secret bridge surfaces main-process failures', async () => {
  const { store, sent } = createIpcHarness();

  const pendingGet = store.get('provider-1');
  await new Promise((resolve) => setImmediate(resolve));
  const request = sent.find((message) => message.type === 'main-request' && message.channel === 'secrets.get');
  store.handleMessage({
    type: 'main-response',
    id: request.id,
    ok: false,
    error: { message: 'boom', code: 'OS_SECRET_STORAGE_UNAVAILABLE', statusCode: 503 }
  });

  await assert.rejects(
    () => pendingGet,
    (error) => error.message === 'boom'
      && error.code === 'OS_SECRET_STORAGE_UNAVAILABLE'
      && error.statusCode === 503
  );
});

test('worker secret bridge times out when the main process never answers', async () => {
  const { store } = createIpcHarness({ requestTimeoutMs: 20 });

  await assert.rejects(() => store.get('provider-1'), /timed out/);
});

test('worker secret bridge local mode fails closed without reversible persistence', async () => {
  const store = createWorkerSecretStore({ useMainProcess: false });

  await store.ready();
  assert.equal(store.has('provider-local'), false);
  assert.equal(await store.get('provider-local'), '');
  await assert.rejects(
    () => store.set('provider-local', 'local-key'),
    (error) => error.code === 'OS_SECRET_STORAGE_UNAVAILABLE' && error.statusCode === 503
  );
  assert.equal(store.has('provider-local'), false);
  await store.delete('provider-local');
  assert.equal(store.has('provider-local'), false);
});
