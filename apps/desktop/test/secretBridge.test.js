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

test('worker retries empty secret responses and restores readiness after recovery', async () => {
  const { store, sent, respondFromMain } = createIpcHarness();
  const ready = store.ready();
  respondFromMain((message) => message.channel === 'secrets.listIds', { ids: [] });
  await ready;
  const first = store.get('provider-recovered');
  respondFromMain((message) => message.channel === 'secrets.get', { value: '' });
  assert.equal(await first, '');
  const second = store.get('provider-recovered');
  respondFromMain((message) => message.channel === 'secrets.get', { value: 'test-recovered' });
  assert.equal(await second, 'test-recovered');
  assert.equal(store.has('provider-recovered'), true);
  assert.equal(await store.get('provider-recovered'), 'test-recovered');
  assert.equal(sent.filter((message) => message.channel === 'secrets.get').length, 2);
});

test('a delayed secret read cannot repopulate cache after deletion', async () => {
  const { store, respondFromMain } = createIpcHarness();
  const read = store.get('removed');
  const deletion = store.delete('removed');
  respondFromMain((message) => message.channel === 'secrets.delete', { ok: true });
  await deletion;
  respondFromMain((message) => message.channel === 'secrets.get', { value: 'old-test-value' });
  await read;
  assert.equal(store.has('removed'), false);
  const nextRead = store.get('removed');
  respondFromMain((message) => message.channel === 'secrets.get', { value: '' });
  assert.equal(await nextRead, '');
});

test('concurrent reads of one credential share a single main-process request', async () => {
  const { store, sent, respondFromMain } = createIpcHarness();
  const reads = Array.from({ length: 24 }, () => store.get('shared'));
  const other = store.get('other');
  const sharedRequests = sent.filter(message => message.channel === 'secrets.get' && message.payload.id === 'shared');
  // Settle every request even on the old implementation so a failing assertion does not leave timers behind.
  for (const request of sharedRequests) store.handleMessage({ type: 'main-response', id: request.id, ok: true, result: { value: 'test-shared' } });
  respondFromMain(message => message.payload.id === 'other', { value: 'test-other' });
  assert.deepEqual(await Promise.all(reads), Array(24).fill('test-shared'));
  assert.equal(await other, 'test-other');
  assert.equal(sharedRequests.length, 1);
});

test('failed shared credential reads release their slot and can retry', async () => {
  const { store, sent, respondFromMain } = createIpcHarness();
  const results = Promise.allSettled([store.get('retry'), store.get('retry')]);
  const requests = sent.filter(message => message.channel === 'secrets.get');
  for (const request of requests) store.handleMessage({ type: 'main-response', id: request.id, ok: false, error: { message: 'transient failure' } });
  assert.deepEqual((await results).map(result => result.status), ['rejected', 'rejected']);
  const retry = store.get('retry');
  respondFromMain(message => message.channel === 'secrets.get', { value: 'test-recovered' });
  assert.equal(await retry, 'test-recovered');
  assert.equal(requests.length, 1);
});

test('reads after deletion cannot join an obsolete in-flight credential read', async () => {
  const { store, sent, respondFromMain } = createIpcHarness();
  const oldRead = store.get('changed');
  const oldRequest = sent.at(-1);
  const deletion = store.delete('changed');
  respondFromMain(message => message.channel === 'secrets.delete', { ok: true });
  await deletion;
  const newRead = store.get('changed');
  const newRequest = sent.at(-1);
  assert.notEqual(newRequest.id, oldRequest.id);
  store.handleMessage({ type: 'main-response', id: oldRequest.id, ok: true, result: { value: 'test-old' } });
  await oldRead;
  const joinedRead = store.get('changed');
  const lastRequest = sent.at(-1);
  // Older completion must not evict a newer pending slot.
  for (const request of new Set([newRequest, lastRequest])) store.handleMessage({ type: 'main-response', id: request.id, ok: true, result: { value: '' } });
  assert.equal(await newRead, '');
  assert.equal(await joinedRead, '');
  assert.equal(lastRequest.id, newRequest.id);
  assert.equal(store.has('changed'), false);
});
