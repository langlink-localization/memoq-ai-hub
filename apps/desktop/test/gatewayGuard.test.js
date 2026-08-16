const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { createGatewayGuard } = require('../src/gatewayGuard');

const GUARD_PORT = 5271;

function createGuardServer(options = {}) {
  const guard = createGatewayGuard({ port: GUARD_PORT, ...options });
  const server = http.createServer((req, res) => {
    guard(req, res, () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ passed: true }));
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function closeGuardServer(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function request(baseUrl, path, headers = {}) {
  return new Promise((resolve, reject) => {
    // fetch() forbids overriding the Host header, so raw http is required here.
    const req = http.request(new URL(`${baseUrl}${path}`), { method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: JSON.parse(data || '{}') });
      });
    });
    req.once('error', reject);
    req.end();
  });
}

test('gateway guard accepts loopback hosts without an Origin header (memoQ plugin shape)', async () => {
  const { server, baseUrl } = await createGuardServer();
  test.after(() => closeGuardServer(server));

  const direct = await request(baseUrl, '/health', { host: `127.0.0.1:${GUARD_PORT}` });
  assert.equal(direct.status, 200);
  assert.equal(direct.body.passed, true);

  const localhost = await request(baseUrl, '/mt/translate', { host: `localhost:${GUARD_PORT}` });
  assert.equal(localhost.status, 200);
  assert.equal(localhost.body.passed, true);
});

test('gateway guard rejects foreign Host headers (DNS rebinding shape)', async () => {
  const { server, baseUrl } = await createGuardServer();
  test.after(() => closeGuardServer(server));

  const rebinding = await request(baseUrl, '/mt/translate', { host: `evil.example:${GUARD_PORT}` });
  assert.equal(rebinding.status, 403);
  assert.equal(rebinding.body.error.code, 'GATEWAY_HOST_REJECTED');

  const wrongPort = await request(baseUrl, '/health', { host: '127.0.0.1:9999' });
  assert.equal(wrongPort.status, 403);
  assert.equal(wrongPort.body.error.code, 'GATEWAY_HOST_REJECTED');
});

test('gateway guard rejects cross-origin browser requests (CSRF shape)', async () => {
  const { server, baseUrl } = await createGuardServer();
  test.after(() => closeGuardServer(server));

  const foreignOrigin = await request(baseUrl, '/desktop/integration/install', {
    host: `127.0.0.1:${GUARD_PORT}`,
    origin: 'http://evil.example'
  });
  assert.equal(foreignOrigin.status, 403);
  assert.equal(foreignOrigin.body.error.code, 'GATEWAY_ORIGIN_REJECTED');

  const sameOrigin = await request(baseUrl, '/health', {
    host: `127.0.0.1:${GUARD_PORT}`,
    origin: `http://127.0.0.1:${GUARD_PORT}`
  });
  assert.equal(sameOrigin.status, 200);

  const localhostOrigin = await request(baseUrl, '/health', {
    host: `127.0.0.1:${GUARD_PORT}`,
    origin: `http://localhost:${GUARD_PORT}`
  });
  assert.equal(localhostOrigin.status, 200);
});

test('gateway guard honors a custom port for its allowlists', async () => {
  const { server, baseUrl } = await createGuardServer({ port: 6000 });
  test.after(() => closeGuardServer(server));

  const customPort = await request(baseUrl, '/health', { host: '127.0.0.1:6000' });
  assert.equal(customPort.status, 200);

  const contractPort = await request(baseUrl, '/health', { host: `127.0.0.1:${GUARD_PORT}` });
  assert.equal(contractPort.status, 403);
});
