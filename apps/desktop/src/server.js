const express = require('express');
const bodyParser = require('body-parser');
const { PRODUCT_NAME, CONTRACT_VERSION, DEFAULT_HOST, DEFAULT_PORT, ROUTES } = require('./shared/desktopContract');
const { readDesktopVersionFromPayload } = require('./shared/desktopMetadata');

function createGatewayServer(runtime) {
  const app = express();
  app.use(bodyParser.json({ limit: '10mb' }));

  app.get('/', (_req, res) => {
    res.type('html').send(`
      <html>
        <head><title>${PRODUCT_NAME}</title></head>
        <body style="font-family: Segoe UI, Arial, sans-serif; padding: 24px;">
          <h1>${PRODUCT_NAME}</h1>
          <p>The UI runs in the Electron app.</p>
          <p>Gateway base URL: http://${DEFAULT_HOST}:${DEFAULT_PORT}</p>
          <p>Contract version: ${CONTRACT_VERSION}</p>
        </body>
      </html>
    `);
  });

  app.get(ROUTES.health, (_req, res) => {
    const versionPayload = runtime.getDesktopVersionPayload();
    res.json({
      ok: true,
      productName: PRODUCT_NAME,
      contractVersion: CONTRACT_VERSION,
      desktopVersion: readDesktopVersionFromPayload(versionPayload)
    });
  });

  app.get(ROUTES.desktopVersion, (_req, res) => {
    res.json(runtime.getDesktopVersionPayload());
  });

  app.get(ROUTES.integrationStatus, (_req, res) => {
    res.json(runtime.getIntegrationStatus());
  });

  app.post(ROUTES.integrationInstall, (req, res) => {
    try {
      res.json(runtime.installIntegration(req.body || {}));
    } catch (error) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: {
          code: error.code || 'INTEGRATION_FAILED',
          message: error.message
        }
      });
    }
  });

  app.post(ROUTES.mtTranslate, async (req, res) => {
    const result = await runtime.translate(req.body || {});
    res.status(result.statusCode).json(result.body);
  });

  app.post(ROUTES.mtStoreTranslations, async (req, res) => {
    const result = await runtime.storeTranslations(req.body || {});
    res.status(result.statusCode).json(result.body);
  });

  return { app };
}

module.exports = {
  createGatewayServer
};
