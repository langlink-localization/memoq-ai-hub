const { createRuntime } = require('./runtime/runtime');
const { createGatewayServer } = require('./server');
const { startGatewayLifecycle, stopGatewayLifecycle } = require('./gatewayLifecycle');
const { DEFAULT_HOST, DEFAULT_PORT } = require('./shared/desktopContract');

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
      console.log(`memoQ AI Hub gateway listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
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
  console.error(error);
  if (runtime || server) {
    void shutdown(1);
    return;
  }
  process.exitCode = 1;
});
