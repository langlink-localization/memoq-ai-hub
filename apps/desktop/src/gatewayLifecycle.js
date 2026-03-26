async function startGatewayLifecycle({
  runtime,
  createGatewayServer,
  host,
  port,
  onListening
}) {
  runtime?.markGatewayReady?.(false);
  const gateway = createGatewayServer(runtime);

  try {
    const server = await new Promise((resolve, reject) => {
      const listeningServer = gateway.app.listen(port, host, () => resolve(listeningServer));
      listeningServer.once('error', reject);
    });

    runtime?.markGatewayReady?.(true);
    onListening?.({ gateway, server, host, port });
    return { gateway, server };
  } catch (error) {
    runtime?.markGatewayReady?.(false);
    throw error;
  }
}

async function stopGatewayLifecycle({ runtime, server }) {
  runtime?.markGatewayReady?.(false);

  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

module.exports = {
  startGatewayLifecycle,
  stopGatewayLifecycle
};
