import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestLifecycle, runLatestRequest } from '../src/renderer/src/requestLifecycle.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('latest read owns data, errors and pending state when responses arrive out of order', async () => {
  const lifecycle = createRequestLifecycle();
  const a = deferred(), b = deferred();
  const updates = [];
  const run = (gate) => runLatestRequest(lifecycle, {
    load: () => gate.promise, resolve: (value) => updates.push(value),
    reject: () => updates.push('error'), settle: () => updates.push('settled')
  });
  const first = run(a), second = run(b);
  a.reject(new Error('obsolete'));
  assert.equal(await first, false);
  assert.deepEqual(updates, []);
  b.resolve('asset-b');
  assert.equal(await second, true);
  assert.deepEqual(updates, ['asset-b', 'settled']);
});

test('closing or unmounting a view invalidates pending read publication', async () => {
  const lifecycle = createRequestLifecycle(), gate = deferred();
  const updates = [];
  const pending = runLatestRequest(lifecycle, { load: () => gate.promise,
    resolve: (value) => updates.push(value), settle: () => updates.push('settled') });
  lifecycle.invalidate();
  gate.resolve('closed asset');
  assert.equal(await pending, false);
  assert.deepEqual(updates, []);
});

test('failed reads can be retried without retaining the old failure', async () => {
  const lifecycle = createRequestLifecycle(), updates = [];
  await runLatestRequest(lifecycle, { load: () => { throw new Error('failed'); },
    resolve() {}, reject: (error) => updates.push(error.message) });
  await runLatestRequest(lifecycle, { load: async () => 'recovered', resolve: (value) => updates.push(value) });
  assert.deepEqual(updates, ['failed', 'recovered']);
});
