const test = require('node:test');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const assert = require('node:assert/strict');
const { createSystemUpdateTransport } = require('../src/update/systemUpdateTransport');
const { createWorkerUpdateFetch } = require('../src/update/workerUpdateFetch');

function bridge(ses, options = {}) {
  const host = createSystemUpdateTransport({ getSession: async () => ses, createRequest: (requestOptions) => {
    const req = new EventEmitter();
    const controller = new AbortController();
    let url = requestOptions.url;
    let nextUrl;
    let current;
    async function run() {
      try {
        current = await ses.fetch(url, { ...requestOptions, credentials: 'omit', signal: controller.signal });
        if ([301, 302, 303, 307, 308].includes(current.status)) {
          nextUrl = new URL(current.headers.get('location'), url).href;
          req.emit('redirect', current.status, 'GET', nextUrl);
        } else {
          const readable = current.body ? Readable.fromWeb(current.body) : Readable.from([]);
          readable.statusCode = current.status;
          readable.headers = Object.fromEntries(current.headers);
          req.emit('response', readable);
        }
      } catch (error) { req.emit('error', error); }
    }
    req.end = () => { void run(); };
    req.followRedirect = () => { url = nextUrl; void run(); };
    req.abort = () => { controller.abort(); if (current?.body && !current.body.locked) void current.body.cancel().catch(() => {}); };
    return req;
  }, ...options });
  const messages = [];
  const worker = createWorkerUpdateFetch({ send(message) {
    messages.push(message);
    void host.handle(message.channel, message.payload).then(
      (result) => worker.handleMessage({ type: 'main-response', id: message.id, ok: true, result }),
      (error) => worker.handleMessage({ type: 'main-response', id: message.id, ok: false, error: { message: error.message } })
    );
  } });
  return { host, worker, messages };
}

test('system session refreshes for each request, validates redirects and bounds IPC chunks', async () => {
  let refreshes = 0;
  const calls = [];
  const bytes = Buffer.alloc(700_000, 7);
  const { host, worker, messages } = bridge({
    async forceReloadProxyConfig() { refreshes += 1; },
    async fetch(url, options) {
      calls.push({ url, options });
      if (url.endsWith('/start')) return new Response(null, { status: 302, headers: { location: '/archive' } });
      return new Response(bytes);
    }
  });
  try {
    const result = await worker.fetch('https://example.com/start');
    assert.equal(result.url, 'https://example.com/archive');
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
    assert.ok(messages.filter((m) => m.channel === 'updates.network.read').length >= 4);
    assert.equal(calls[0].options.redirect, 'manual');
    assert.equal(calls[0].options.credentials, 'omit');
    const next = await worker.fetch('https://example.com/archive');
    await next.body.cancel();
    assert.equal(refreshes, 2);
  } finally { host.dispose(); }
});

test('HTTPS downgrade redirects and credentials are rejected before the next request', async () => {
  for (const location of ['http://example.com/file', 'https://user:secret@example.com/file', 'file:///tmp/file']) {
    let calls = 0;
    const { host, worker } = bridge({
      async forceReloadProxyConfig() {},
      async fetch() { calls += 1; return new Response(null, { status: 302, headers: { location } }); }
    });
    try { await assert.rejects(worker.fetch('https://example.com/start')); assert.equal(calls, 1); }
    finally { host.dispose(); }
  }
});

test('aborting while waiting for response headers aborts the main request', async () => {
  let signal;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const { host, worker } = bridge({
    async forceReloadProxyConfig() {},
    fetch(url, options) { signal = options.signal; started(); return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))); }
  });
  const controller = new AbortController();
  const result = worker.fetch('https://example.com/file', { signal: controller.signal });
  await ready;
  controller.abort(new Error('user cancelled'));
  await assert.rejects(result, /user cancelled/);
  assert.equal(signal.aborted, true);
  host.dispose();
});

test('cancellation during streaming and worker loss close the main network response', async () => {
  let cancels = 0;
  const { host, worker } = bridge({
    async forceReloadProxyConfig() {},
    async fetch() { return new Response(new ReadableStream({ cancel() { cancels += 1; } })); }
  });
  const controller = new AbortController();
  const response = await worker.fetch('https://example.com/file', { signal: controller.signal });
  const reading = response.arrayBuffer();
  controller.abort(new Error('user cancelled'));
  await assert.rejects(reading, /cancel/);
  assert.equal(cancels, 1);
  const second = await worker.fetch('https://example.com/other');
  const nextRead = second.arrayBuffer();
  host.dispose();
  await assert.rejects(nextRead);
  assert.equal(cancels, 2);
});

test('proxy resolution failures never fall back to a direct request', async () => {
  let fetched = false;
  const { host, worker } = bridge({
    async forceReloadProxyConfig() { throw new Error('proxy unavailable'); },
    async fetch() { fetched = true; }
  });
  await assert.rejects(worker.fetch('https://example.com/file'), /proxy unavailable/);
  assert.equal(fetched, false);
  host.dispose();
});

test('HTTP failures release request slots even when callers ignore the response body', async () => {
  const { host, worker } = bridge({
    async forceReloadProxyConfig() {},
    async fetch() { return new Response('unavailable', { status: 503 }); }
  });
  try { for (let i = 0; i < 4; i += 1) assert.equal((await worker.fetch('https://example.com/file')).status, 503); }
  finally { host.dispose(); }
});

test('oversized manifest is rejected from its headers before streaming', async () => {
  const { host, worker } = bridge({
    async forceReloadProxyConfig() {},
    async fetch() { return new Response('large', { headers: { 'content-length': String(2 * 1024 * 1024) } }); }
  });
  try { await assert.rejects(worker.fetch('https://example.com/file', { headers: { accept: 'application/json' } }), /size limit/); }
  finally { host.dispose(); }
});

test('redirect loops are bounded and rejected', async () => {
  let calls = 0;
  const { host, worker } = bridge({
    async forceReloadProxyConfig() {},
    async fetch() { calls += 1; return new Response(null, { status: 302, headers: { location: '/again' } }); }
  });
  try { await assert.rejects(worker.fetch('https://example.com/start'), /Too many/); assert.equal(calls, 9); }
  finally { host.dispose(); }
});
