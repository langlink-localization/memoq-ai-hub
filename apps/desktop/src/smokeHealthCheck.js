const { DEFAULT_HOST, DEFAULT_PORT, ROUTES } = require('./shared/desktopContract');
const { createAppPaths } = require('./shared/paths');
const { createLogger } = require('./shared/logging');

const HEALTHCHECK_TIMEOUT_MS = 30000;
const HEALTHCHECK_RETRY_DELAY_MS = 500;
const logger = createLogger({ source: 'smoke-health-check', logsDir: createAppPaths().logsDir });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const url = `http://${DEFAULT_HOST}:${DEFAULT_PORT}${ROUTES.health}`;
  const deadline = Date.now() + HEALTHCHECK_TIMEOUT_MS;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Health check failed with status ${response.status}`);
      }
      const payload = await response.json();
      if (!payload.ok) {
        throw new Error('Gateway health payload is not ok');
      }
      logger.info('health-check-passed', 'Health check passed.', { productName: payload.productName });
      return;
    } catch (error) {
      lastError = error;
      await sleep(HEALTHCHECK_RETRY_DELAY_MS);
    }
  }

  throw lastError || new Error('Health check timed out before the gateway became reachable.');
}

main().catch((error) => {
  logger.error('health-check-failed', 'Health check failed.', { error });
  process.exitCode = 1;
});
