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

test('gateway health returns the same desktop version as the desktop version payload', async () => {
  const desktopVersionPayload = {
    productName: 'memoQ AI Hub',
    desktopVersion: '7.8.9',
    contractVersion: '1',
    runtime: {
      desktopVersion: '7.8.9'
    }
  };
  const runtime = {
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
    }
  };

  const { app } = createGatewayServer(runtime);
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}${ROUTES.health}`);
    const payload = await response.json();

    assert.equal(payload.ok, true);
    assert.equal(payload.desktopVersion, desktopVersionPayload.desktopVersion);
    assert.equal(payload.contractVersion, desktopVersionPayload.contractVersion);
  } finally {
    await close(server);
  }
});
