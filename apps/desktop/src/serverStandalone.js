const { createRuntime } = require('./runtime/runtime');
const { createGatewayServer } = require('./server');
const { startGatewayLifecycle, stopGatewayLifecycle } = require('./gatewayLifecycle');
const { DEFAULT_HOST, DEFAULT_PORT } = require('./shared/desktopContract');
const { createAppPaths } = require('./shared/paths');
const { createLogger } = require('./shared/logging');

const logger = createLogger({ source: 'server-standalone', logsDir: createAppPaths().logsDir });
let runtime = null;
let server = null;
let shuttingDown = false;

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  try {
    await stopGatewayLifecycle({ runtime, server });
    server = null;
    runtime?.dispose?.();
    runtime = null;
  } finally {
    process.exit(exitCode);
  }
}

async function main() {
  runtime = await createRuntime();
  ({ server } = await startGatewayLifecycle({
    runtime,
    createGatewayServer,
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    onListening() {
      logger.info('gateway-listening', 'Standalone gateway is listening.', { host: DEFAULT_HOST, port: DEFAULT_PORT });
    }
  }));
}

process.once('SIGINT', () => {
  void shutdown(0);
});

process.once('SIGTERM', () => {
  void shutdown(0);
});

main().catch((error) => {
  logger.error('startup-failed', 'Standalone gateway failed to start.', { error });
  if (runtime || server) {
    void shutdown(1);
    return;
  }
  process.exitCode = 1;
});
