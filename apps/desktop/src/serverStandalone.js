const { createRuntime } = require('./runtime/runtime');
const { createGatewayServer } = require('./server');
const { DEFAULT_HOST, DEFAULT_PORT } = require('./shared/desktopContract');

async function main() {
  const runtime = await createRuntime();
  const gateway = createGatewayServer(runtime);
  gateway.app.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
console.log(`memoQ AI Hub gateway listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
