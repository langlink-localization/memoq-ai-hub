const express = require('express');
const bodyParser = require('body-parser');
const { PRODUCT_NAME, CONTRACT_VERSION, DEFAULT_HOST, DEFAULT_PORT, ROUTES } = require('./shared/desktopContract');
const { readDesktopVersionFromPayload } = require('./shared/desktopMetadata');

function createRuntimeRoute(runtimeMethod, defaultCode) {
  return async (req, res) => {
    try {
      const result = await runtimeMethod(req.body || {});
      res.status(result?.statusCode || 200).json(result?.body ?? result);
    } catch (error) {
      res.status(error?.statusCode || 500).json({
        success: false,
        error: {
          code: error?.code || defaultCode,
          message: error?.message || 'Unexpected runtime failure.'
        }
      });
    }
  };
}

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

  app.post(ROUTES.integrationInstall, createRuntimeRoute((payload) => runtime.installIntegration(payload), 'INTEGRATION_FAILED'));
  app.post(ROUTES.mtTranslate, createRuntimeRoute((payload) => runtime.translate(payload), 'TRANSLATION_FAILED'));
  app.post(ROUTES.mtTranslateAggregate, createRuntimeRoute((payload) => runtime.submitAggregateTranslation(payload), 'TRANSLATION_FAILED'));
  app.post(ROUTES.mtTranslateAggregateResult, createRuntimeRoute((payload) => runtime.waitAggregateTranslation(payload), 'TRANSLATION_FAILED'));
  app.post(ROUTES.mtStoreTranslations, createRuntimeRoute((payload) => runtime.storeTranslations(payload), 'TRANSLATION_FAILED'));

  return { app };
}

module.exports = {
  createGatewayServer
};
