const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { ROUTES } = require('../src/shared/desktopContract');
const { createGatewayServer } = require('../src/server');

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createRuntimeStub(overrides = {}) {
  const desktopVersionPayload = {
    productName: 'memoQ AI Hub',
    desktopVersion: '7.8.9',
    contractVersion: '1',
    runtime: {
      desktopVersion: '7.8.9'
    }
  };

  return {
    getDesktopVersionPayload() {
      return desktopVersionPayload;
    },
    getIntegrationStatus() {
      return { status: 'not_installed' };
    },
    installIntegration() {
      return { status: 'installed' };
    },
    async translate() {
      return { statusCode: 200, body: { ok: true } };
    },
    async storeTranslations() {
      return { statusCode: 200, body: { ok: true } };
    },
    ...overrides
  };
}

test('gateway health returns the same desktop version as the desktop version payload', async () => {
  const runtime = createRuntimeStub();

  const { app } = createGatewayServer(runtime);
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}${ROUTES.health}`);
    const payload = await response.json();

    assert.equal(payload.ok, true);
    assert.equal(payload.desktopVersion, runtime.getDesktopVersionPayload().desktopVersion);
    assert.equal(payload.contractVersion, runtime.getDesktopVersionPayload().contractVersion);
  } finally {
    await close(server);
  }
});

test('gateway translate success still passes through runtime status and body', async () => {
  const runtime = createRuntimeStub({
    async translate(payload) {
      return {
        statusCode: 202,
        body: {
          success: true,
          echoedRequestId: payload.requestId
        }
      };
    }
  });
  const { app } = createGatewayServer(runtime);
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}${ROUTES.mtTranslate}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'req-1' })
    });
    const payload = await response.json();

    assert.equal(response.status, 202);
    assert.deepEqual(payload, {
      success: true,
      echoedRequestId: 'req-1'
    });
  } finally {
    await close(server);
  }
});

test('gateway translate wraps runtime exceptions in a stable JSON error body', async () => {
  const runtime = createRuntimeStub({
    async translate() {
      const error = new Error('translate exploded');
      error.statusCode = 503;
      error.code = 'PROVIDER_DOWN';
      throw error;
    }
  });
  const { app } = createGatewayServer(runtime);
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}${ROUTES.mtTranslate}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    const payload = await response.json();

    assert.equal(response.status, 503);
    assert.deepEqual(payload, {
      success: false,
      error: {
        code: 'PROVIDER_DOWN',
        message: 'translate exploded'
      }
    });
  } finally {
    await close(server);
  }
});

test('gateway storeTranslations uses the translation failure contract for thrown errors', async () => {
  const runtime = createRuntimeStub({
    async storeTranslations() {
      throw new Error('writeback exploded');
    }
  });
  const { app } = createGatewayServer(runtime);
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}${ROUTES.mtStoreTranslations}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, {
      success: false,
      error: {
        code: 'TRANSLATION_FAILED',
        message: 'writeback exploded'
      }
    });
  } finally {
    await close(server);
  }
});

test('gateway integration install keeps its existing integration error contract', async () => {
  const runtime = createRuntimeStub({
    installIntegration() {
      const error = new Error('install exploded');
      error.statusCode = 409;
      throw error;
    }
  });
  const { app } = createGatewayServer(runtime);
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}${ROUTES.integrationInstall}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.deepEqual(payload, {
      success: false,
      error: {
        code: 'INTEGRATION_FAILED',
        message: 'install exploded'
      }
    });
  } finally {
    await close(server);
  }
});
