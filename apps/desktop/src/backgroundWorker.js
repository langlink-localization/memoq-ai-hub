const path = require('path');
const { createRuntime } = require('./runtime/runtime');
const { createGatewayServer } = require('./server');
const { startGatewayLifecycle, stopGatewayLifecycle } = require('./gatewayLifecycle');
const { DEFAULT_HOST, DEFAULT_PORT } = require('./shared/desktopContract');

let runtime = null;
let server = null;
let startupState = { status: 'starting', message: '' };
let shuttingDown = false;

function send(message) {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

function sendStatus(status, message = '') {
  startupState = { status, message: String(message || '') };
  send({
    type: 'status',
    payload: startupState
  });
}

function serializeError(error) {
  return {
    message: String(error?.message || error || 'Unknown worker error'),
    code: error?.code || '',
    statusCode: Number.isFinite(Number(error?.statusCode)) ? Number(error.statusCode) : 500,
    stack: String(error?.stack || '')
  };
}

function loadProviderRegistryOverride() {
  const overridePath = String(process.env.MEMOQ_AI_WORKER_PROVIDER_REGISTRY || '').trim();
  if (!overridePath) {
    return {};
  }

  const resolvedPath = path.resolve(overridePath);
  return {
    providerRegistry: require(resolvedPath)
  };
}

async function startRuntimeAndGateway() {
  sendStatus('starting');

  try {
    runtime = await createRuntime({
      ...loadProviderRegistryOverride()
    });

    ({ server } = await startGatewayLifecycle({
      runtime,
      createGatewayServer,
      host: DEFAULT_HOST,
      port: DEFAULT_PORT
    });
    sendStatus('ready');
    setTimeout(() => {
      if (!shuttingDown && startupState.status === 'ready') {
        send({
          type: 'status',
          payload: startupState
        });
      }
    }, 50);
  } catch (error) {
    try {
      await stopGatewayLifecycle({ runtime, server });
    } catch {
    }
    if (runtime) {
      runtime.dispose?.();
      runtime = null;
    }
    server = null;

    sendStatus('error', error?.message || 'Desktop services failed to start.');
  }
}

async function stopRuntimeAndGateway(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  try {
    await stopGatewayLifecycle({ runtime, server });
    server = null;

    if (runtime) {
      runtime.dispose?.();
      runtime = null;
    }

    sendStatus('stopped');
  } finally {
    process.exit(exitCode);
  }
}

function requireRuntime() {
  if (runtime && startupState.status === 'ready') {
    return runtime;
  }

  const error = new Error(
    startupState.status === 'error'
      ? (startupState.message || 'Desktop services failed to start.')
      : 'Desktop services are still starting.'
  );
  error.code = startupState.status === 'error' ? 'DESKTOP_STARTUP_FAILED' : 'DESKTOP_STARTING';
  error.statusCode = startupState.status === 'error' ? 500 : 503;
  throw error;
}

const requestHandlers = {
  getAppState(payload) {
    return requireRuntime().getAppState(payload || {});
  },
  saveProfile(payload) {
    return requireRuntime().saveProfile(payload || {});
  },
  setDefaultProfile(payload) {
    return requireRuntime().setDefaultProfile(payload);
  },
  duplicateProfile(payload) {
    return requireRuntime().duplicateProfile(payload);
  },
  deleteProfile(payload) {
    return requireRuntime().deleteProfile(payload);
  },
  saveRule(payload) {
    return requireRuntime().saveMappingRule(payload || {});
  },
  deleteRule(payload) {
    return requireRuntime().deleteMappingRule(payload);
  },
  testMatch(payload) {
    return requireRuntime().testMapping(payload || {});
  },
  saveProvider(payload) {
    return requireRuntime().saveProvider(payload || {});
  },
  deleteProvider(payload) {
    return requireRuntime().deleteProvider(payload);
  },
  deleteProviderModel(payload) {
    return requireRuntime().deleteProviderModel(payload?.providerId, payload?.modelId);
  },
  testProvider(payload) {
    return requireRuntime().testProviderConnection(payload);
  },
  testProviderDraft(payload) {
    return requireRuntime().testProviderDraft(payload || {});
  },
  discoverProviderModels(payload) {
    return requireRuntime().discoverProviderModels(payload || {});
  },
  getIntegrationStatus() {
    return requireRuntime().getIntegrationStatus();
  },
  installIntegration(payload) {
    return requireRuntime().installIntegration(payload || {});
  },
  importAsset(payload) {
    return requireRuntime().importAssetFromPath(payload?.assetType, payload?.sourcePath);
  },
  getAssetPreview(payload) {
    return requireRuntime().getAssetPreview(payload?.assetId, payload || {});
  },
  applyAssetTbStructure(payload) {
    return requireRuntime().applyAssetTbStructure(payload?.assetId, payload || {});
  },
  saveAssetTbConfig(payload) {
    return requireRuntime().saveAssetTbConfig(payload?.assetId, payload || {});
  },
  deleteAsset(payload) {
    return requireRuntime().deleteAsset(payload);
  },
  exportHistory(payload) {
    return requireRuntime().exportHistory(payload || {});
  },
  testHandshake() {
    return requireRuntime().testHandshake();
  },
  async shutdown() {
    await stopRuntimeAndGateway(0);
    return { ok: true };
  }
};

process.on('message', async (message) => {
  if (!message || message.type !== 'request') {
    return;
  }

  const handler = requestHandlers[message.channel];
  if (!handler) {
    send({
      type: 'response',
      id: message.id,
      ok: false,
      error: serializeError(new Error(`Unknown worker channel: ${message.channel}`))
    });
    return;
  }

  try {
    const result = await handler(message.payload);
    send({
      type: 'response',
      id: message.id,
      ok: true,
      result
    });
  } catch (error) {
    send({
      type: 'response',
      id: message.id,
      ok: false,
      error: serializeError(error)
    });
  }
});

process.on('disconnect', () => {
  void stopRuntimeAndGateway(0);
});

process.on('SIGTERM', () => {
  void stopRuntimeAndGateway(0);
});

process.on('SIGINT', () => {
  void stopRuntimeAndGateway(0);
});

void startRuntimeAndGateway();
