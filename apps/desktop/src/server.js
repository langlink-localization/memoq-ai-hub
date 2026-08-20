const express = require('express');
const bodyParser = require('body-parser');
const { PRODUCT_NAME, CONTRACT_VERSION, DEFAULT_HOST, DEFAULT_PORT, ROUTES } = require('./shared/desktopContract');
const { readDesktopVersionFromPayload } = require('./shared/desktopMetadata');
const { createAppPaths } = require('./shared/paths');
const { createLogger } = require('./shared/logging');
const { createGatewayGuard } = require('./gatewayGuard');

const gatewayLogger = createLogger({ source: 'gateway', logsDir: createAppPaths().logsDir });

function createRuntimeRoute(runtimeMethod, defaultCode) {
  return async (req, res) => {
    const startedAtMs = Date.now();
    try {
      const result = await runtimeMethod(req.body || {});
      gatewayLogger.info('route-complete', 'Gateway route completed.', {
        method: req.method,
        path: req.path || req.url,
        statusCode: result?.statusCode || 200,
        durationMs: Date.now() - startedAtMs
      });
      res.status(result?.statusCode || 200).json(result?.body ?? result);
    } catch (error) {
      gatewayLogger.error('route-failed', 'Gateway route failed.', {
        method: req.method,
        path: req.path || req.url,
        durationMs: Date.now() - startedAtMs,
        error
      });
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

function createGatewayServer(runtime, options = {}) {
  const app = express();
  app.use((req, res, next) => {
    const startedAtMs = Date.now();
    res.on?.('finish', () => {
      gatewayLogger.info('http-request', 'Gateway HTTP request finished.', {
        method: req.method,
        path: req.path || req.url,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAtMs
      });
    });
    next();
  });
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use((error, req, res, next) => {
    const oversized = error?.type === 'entity.too.large' || error?.status === 413;
    const malformed = error?.type === 'entity.parse.failed' || error instanceof SyntaxError;
    if (!oversized && !malformed) {
      next(error);
      return;
    }
    res.status(oversized ? 413 : 400).json({
      success: false,
      error: {
        code: oversized ? 'REQUEST_BODY_TOO_LARGE' : 'INVALID_JSON',
        message: oversized ? 'The request body exceeds the 10 MB limit.' : 'The request body is not valid JSON.'
      }
    });
  });
  if (options.guard !== false) {
    app.use(options.guard || createGatewayGuard({ logger: gatewayLogger }));
  }

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
  app.get(ROUTES.qaStatus, (_req, res) => res.json(runtime.getQaStatus()));
  app.post(ROUTES.qaCheckSegment, createRuntimeRoute((payload) => runtime.checkQaSegment(payload), 'QA_CHECK_FAILED'));
  app.post(ROUTES.qaCheckDocument, createRuntimeRoute((payload) => runtime.checkQaDocument(payload), 'QA_CHECK_FAILED'));
  app.post(ROUTES.qaCancel, createRuntimeRoute((payload) => runtime.cancelQa(payload), 'QA_CANCEL_FAILED'));
  app.post(ROUTES.qaFeedback, createRuntimeRoute((payload) => runtime.saveQaFeedback(payload), 'QA_FEEDBACK_FAILED'));
  app.get(ROUTES.qaResults, (req, res) => res.json(runtime.getQaResults(req.params.documentId)));

  return { app };
}

module.exports = {
  createGatewayServer
};
