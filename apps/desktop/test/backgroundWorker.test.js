const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { spawnSync } = require('child_process');
const { createRuntime } = require('../src/runtime/runtime');

function createTempAppRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-ai-hub-worker-'));
}

function createMockOpenAIModule(tempRoot) {
  const moduleDir = path.join(tempRoot, 'node_modules', 'openai');
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(path.join(moduleDir, 'index.js'), `
    class OpenAI {
      constructor() {
        this.responses = { create: async () => ({ output_text: 'OK' }) };
        this.chat = { completions: { create: async () => ({ choices: [{ message: { content: 'OK' } }] }) } };
        this.models = { list: async () => ({ data: [] }) };
      }
    }

    OpenAI.OpenAI = OpenAI;
    OpenAI.default = OpenAI;
    module.exports = OpenAI;
  `, 'utf8');
}

function createMockDesktopDependencyModules(tempRoot) {
  const nodeModulesDir = path.join(tempRoot, 'node_modules');

  const expressDir = path.join(nodeModulesDir, 'express');
  fs.mkdirSync(expressDir, { recursive: true });
  fs.writeFileSync(path.join(expressDir, 'index.js'), `
    const http = require('http');

    module.exports = function express() {
      const routes = { GET: new Map(), POST: new Map() };

      const app = (req, res) => {
        const methodRoutes = routes[req.method] || new Map();
        const handler = methodRoutes.get(req.url);
        if (!handler) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }

        res.status = function status(code) {
          res.statusCode = code;
          return res;
        };
        res.type = function type(contentType) {
          res.setHeader('Content-Type', contentType);
          return res;
        };
        res.send = function send(body) {
          res.end(body);
          return res;
        };
        res.json = function json(body) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
          return res;
        };

        handler(req, res);
      };

      app.use = function use() {};
      app.get = function get(route, handler) {
        routes.GET.set(route, handler);
      };
      app.post = function post(route, handler) {
        routes.POST.set(route, handler);
      };
      app.listen = function listen(port, host, callback) {
        const server = http.createServer(app);
        return server.listen(port, host, callback);
      };

      return app;
    };
  `, 'utf8');

  const bodyParserDir = path.join(nodeModulesDir, 'body-parser');
  fs.mkdirSync(bodyParserDir, { recursive: true });
  fs.writeFileSync(path.join(bodyParserDir, 'index.js'), `
    module.exports = {
      json() {
        return function jsonMiddleware(_req, _res, next) {
          if (typeof next === 'function') {
            next();
          }
        };
      }
    };
  `, 'utf8');

  const electronStoreDir = path.join(nodeModulesDir, 'electron-store');
  fs.mkdirSync(electronStoreDir, { recursive: true });
  fs.writeFileSync(path.join(electronStoreDir, 'index.js'), `
    class Store {
      constructor() {
        this.values = new Map();
      }
      get(key) {
        return this.values.get(key);
      }
      set(key, value) {
        this.values.set(key, value);
      }
      delete(key) {
        this.values.delete(key);
      }
    }
    module.exports = Store;
  `, 'utf8');

  const sqlJsDir = path.join(nodeModulesDir, 'sql.js');
  fs.mkdirSync(sqlJsDir, { recursive: true });
  fs.writeFileSync(path.join(sqlJsDir, 'index.js'), `
    module.exports = async function initSqlJs() {
      let appStateRow = null;

      class Statement {
        constructor(sql) {
          this.sql = String(sql || '');
          this.rows = [];
          this.index = -1;
        }
        bind(params = {}) {
          if (this.sql.includes('SELECT data_json FROM app_state') && appStateRow && appStateRow.id === params.$id) {
            this.rows = [{ data_json: appStateRow.data_json }];
          } else if (this.sql.includes('SELECT id FROM app_state') && appStateRow && appStateRow.id === params.$id) {
            this.rows = [{ id: appStateRow.id }];
          } else {
            this.rows = [];
          }
          this.index = -1;
        }
        run(params = {}) {
          if (this.sql.includes('INSERT INTO app_state') || this.sql.includes('UPDATE app_state')) {
            appStateRow = {
              id: params.$id,
              data_json: params.$data,
              updated_at: params.$updatedAt
            };
          }
        }
        step() {
          this.index += 1;
          return this.index < this.rows.length;
        }
        getAsObject() {
          return this.rows[this.index] || {};
        }
        free() {}
      }

      class Database {
        exec() {}
        prepare(sql) {
          return new Statement(sql);
        }
        export() {
          return new Uint8Array();
        }
        getRowsModified() {
          return 1;
        }
        close() {}
      }

      return { Database };
    };
  `, 'utf8');

  const xlsxDir = path.join(nodeModulesDir, 'xlsx');
  fs.mkdirSync(xlsxDir, { recursive: true });
  fs.writeFileSync(path.join(xlsxDir, 'index.js'), `
    const fs = require('fs');

    module.exports = {
      readFile: () => ({ SheetNames: [], Sheets: {} }),
      utils: {
        sheet_to_json: () => [],
        json_to_sheet: (rows) => ({ rows: Array.isArray(rows) ? rows : [] }),
        sheet_to_csv: (sheet) => {
          const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
          if (!rows.length) {
            return '';
          }
          const headers = Object.keys(rows[0]);
          return [
            headers.join(','),
            ...rows.map((row) => headers.map((header) => String(row[header] ?? '')).join(','))
          ].join('\\n');
        },
        book_new: () => ({ sheets: [] }),
        book_append_sheet: (workbook, sheet, name) => {
          workbook.sheets.push({ name, sheet });
        }
      },
      writeFile: (workbook, outputPath) => {
        fs.writeFileSync(outputPath, JSON.stringify(workbook), 'utf8');
      }
    };
  `, 'utf8');
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function createWorkerClient(worker) {
  let requestId = 0;
  const pending = new Map();
  let lastStatus = null;

  const messageHandler = (message) => {
    if (message?.type === 'status') {
      lastStatus = message.payload || null;
      return;
    }

    if (!message || message.type !== 'response') {
      return;
    }

    const request = pending.get(message.id);
    if (!request) {
      return;
    }

    pending.delete(message.id);

    if (message.ok) {
      request.resolve(message.result);
      return;
    }

    const error = new Error(String(message.error?.message || 'Worker request failed.'));
    error.code = message.error?.code || '';
    request.reject(error);
  };

  const rejectPending = (message, code = 'WORKER_CLIENT_DISPOSED') => {
    if (!pending.size) {
      return;
    }

    for (const [id, request] of pending.entries()) {
      const error = new Error(message);
      error.code = code;
      request.reject(error);
      pending.delete(id);
    }
  };

  const exitHandler = (code, signal) => {
    rejectPending(
      `Worker exited before responding (code: ${String(code)}, signal: ${String(signal || '')}).`,
      'WORKER_EXITED'
    );
  };

  const errorHandler = (error) => {
    rejectPending(error?.message || 'Worker emitted an error before responding.', 'WORKER_ERRORED');
  };

  worker.on('message', messageHandler);
  worker.on('exit', exitHandler);
  worker.on('error', errorHandler);

  return {
    invoke(channel, payload) {
      const id = `test_req_${Date.now()}_${requestId += 1}`;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.send({
          type: 'request',
          id,
          channel,
          payload
        });
      });
    },
    getLastStatus() {
      return lastStatus;
    },
    dispose() {
      worker.off('message', messageHandler);
      worker.off('exit', exitHandler);
      worker.off('error', errorHandler);
      rejectPending('Worker client disposed before request completion.');
    }
  };
}

async function waitForReady(client, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 15000);
  const requestTimeoutMs = Number(options.requestTimeoutMs || 1000);
  const getLastStatus = typeof options.getLastStatus === 'function' ? options.getLastStatus : null;
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    const status = getLastStatus?.();
    if (status?.status === 'error') {
      throw new Error(status.message || 'Worker reported startup error.');
    }

    try {
      const handshake = await Promise.race([
        client.invoke('testHandshake'),
        new Promise((_, reject) => {
          setTimeout(() => {
            const error = new Error('Timed out waiting for testHandshake response.');
            error.code = 'WORKER_HANDSHAKE_TIMEOUT';
            reject(error);
          }, requestTimeoutMs);
        })
      ]);
      if (handshake?.productName) {
        return handshake;
      }
    } catch (error) {
      if (error?.code === 'DESKTOP_STARTUP_FAILED') {
        throw error;
      }
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(lastError?.message || 'Timed out waiting for worker status ready');
}

async function createRuntimeHarness(tempRoot, options = {}) {
  const previousDataDir = process.env.MEMOQ_AI_DESKTOP_DATA_DIR;
  process.env.MEMOQ_AI_DESKTOP_DATA_DIR = tempRoot;

  try {
    const runtime = await createRuntime({
      providerRegistry: options.providerRegistry || {},
      fetch: options.fetch,
      manifestUrl: options.manifestUrl,
      packagingMode: options.packagingMode,
      extractArchive: options.extractArchive
    });
    runtime.markGatewayReady(true);

    return {
      runtime,
      dispose() {
        runtime.markGatewayReady(false);
        runtime.dispose?.();
        if (previousDataDir === undefined) {
          delete process.env.MEMOQ_AI_DESKTOP_DATA_DIR;
        } else {
          process.env.MEMOQ_AI_DESKTOP_DATA_DIR = previousDataDir;
        }
      }
    };
  } catch (error) {
    if (previousDataDir === undefined) {
      delete process.env.MEMOQ_AI_DESKTOP_DATA_DIR;
    } else {
      process.env.MEMOQ_AI_DESKTOP_DATA_DIR = previousDataDir;
    }
    throw error;
  }
}

test('background worker boots and proxies runtime requests', async (t) => {
  const tempRoot = createTempAppRoot();
  const harness = await createRuntimeHarness(tempRoot, {
    providerRegistry: {
      testConnection: async ({ modelName }) => ({ ok: true, latencyMs: 5, message: `ok:${modelName}` }),
      translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 8 })
    }
  });
  const { runtime } = harness;

  t.after(() => {
    harness.dispose();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const provider = runtime.saveProvider({
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
  });

  runtime.saveProfile({
    name: 'Default',
    interactiveProviderId: provider.id,
    fallbackProviderId: provider.id
  });

  const state = runtime.getAppState({});
  const handshake = runtime.getDesktopVersionPayload();

  assert.equal(state.providerHub.providers.length, 1);
  assert.equal(state.contextBuilder.profiles.length, 1);
  assert.equal(handshake.productName, 'memoQ AI Hub');
  assert.equal(handshake.contractVersion, '1');
});

test('background worker proxies discovery for official and compatible providers', async (t) => {
  const tempRoot = createTempAppRoot();
  const harness = await createRuntimeHarness(tempRoot, {
    providerRegistry: {
      testConnection: async ({ modelName }) => ({ ok: true, latencyMs: 5, message: `ok:${modelName}` }),
      discoverModels: async ({ provider, apiKey }) => ({
        ok: true,
        models: provider.type === 'openai'
          ? [
            { modelName: 'gpt-4.1-mini' },
            { modelName: 'gpt-4.1' }
          ]
          : [
            { modelName: `${provider.requestPath}:${apiKey}` },
            { modelName: 'gpt-4.1-mini' }
          ]
      }),
      translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 8 })
    }
  });
  const { runtime } = harness;

  t.after(() => {
    harness.dispose();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const provider = runtime.saveProvider({
    name: 'OpenAI Compatible',
    type: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    requestPath: '/chat/completions',
    apiKey: 'saved-key',
    models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
  });

  const discovery = await runtime.discoverProviderModels({
    id: provider.id,
    name: provider.name,
    type: provider.type,
    baseUrl: provider.baseUrl,
    requestPath: provider.requestPath
  });
  const officialDiscovery = await runtime.discoverProviderModels({
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'official-key',
    models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
  });
  const state = runtime.getAppState({});

  assert.equal(discovery.ok, true);
  assert.deepEqual(discovery.models.map((model) => model.modelName), ['/chat/completions:saved-key', 'gpt-4.1-mini']);
  assert.equal(officialDiscovery.ok, true);
  assert.deepEqual(officialDiscovery.models.map((model) => model.modelName), ['gpt-4.1-mini', 'gpt-4.1']);
  assert.equal(state.providerHub.providers[0].requestPath, '/chat/completions');
});

test('background worker keeps a default model when saving a provider without explicit models', async (t) => {
  const tempRoot = createTempAppRoot();
  const harness = await createRuntimeHarness(tempRoot, {
    providerRegistry: {
      testConnection: async ({ modelName }) => ({ ok: true, latencyMs: 5, message: `ok:${modelName}` }),
      translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 8 })
    }
  });
  const { runtime } = harness;

  t.after(() => {
    harness.dispose();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const provider = runtime.saveProvider({
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    models: []
  });
  const state = runtime.getAppState({});

  assert.equal(provider.models.length, 1);
  assert.equal(provider.models[0].modelName, 'gpt-5.4-mini');
  assert.equal(state.providerHub.providers[0].models[0].modelName, 'gpt-5.4-mini');
});

test('background worker proxies parsed asset previews', async (t) => {
  const tempRoot = createTempAppRoot();
  const harness = await createRuntimeHarness(tempRoot);
  const { runtime } = harness;

  t.after(() => {
    harness.dispose();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const glossaryPath = path.join(tempRoot, 'preview-glossary.csv');
  fs.writeFileSync(glossaryPath, 'source,target\nworkspace,工作区\n', 'utf8');

  const asset = runtime.importAssetFromPath('glossary', glossaryPath);
  const preview = runtime.getAssetPreview(asset.id, {});

  assert.equal(preview.assetId, asset.id);
  assert.equal(preview.type, 'glossary');
  assert.equal(preview.rowCount, 1);
  assert.equal(preview.rows[0].sourceTerm, 'workspace');
});

test('background worker runtime harness exposes translation cache bypass and clear controls', async (t) => {
  const tempRoot = createTempAppRoot();
  const harness = await createRuntimeHarness(tempRoot, {
    providerRegistry: {
      testConnection: async () => ({ ok: true, latencyMs: 5, message: 'ok' }),
      translateSegment: async ({ sourceText }) => ({ text: `${sourceText} -> ZH`, latencyMs: 8 })
    }
  });
  const { runtime } = harness;

  t.after(() => {
    harness.dispose();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const provider = runtime.saveProvider({
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    models: [{ modelName: 'gpt-4.1-mini', enabled: true }]
  });

  const profile = runtime.saveProfile({
    name: 'Default',
    providerId: provider.id,
    cacheEnabled: true
  });

  const bypassResult = runtime.bypassTranslationCacheOnce(profile.id);
  const stateWithBypass = runtime.getAppState({});
  const clearResult = runtime.clearTranslationCache();

  assert.equal(bypassResult.bypassPending, true);
  assert.deepEqual(stateWithBypass.contextBuilder.translationCacheBypassProfileIds, [profile.id]);
  assert.equal(clearResult.clearedCount, 0);
});

test('background worker runtime harness exposes portable update metadata without in-app portable download flow', async (t) => {
  const tempRoot = createTempAppRoot();
  const manifestUrl = 'https://example.com/latest.json';
  const releaseNotesUrl = 'https://example.com/release';
  const portableUrl = 'https://example.com/memoq-ai-hub-win32-x64.zip';
  const harness = await createRuntimeHarness(tempRoot, {
    fetch: async (url) => {
      if (url === manifestUrl) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              version: '1.0.13',
              releaseNotesUrl,
              assets: {
                portable: {
                  name: 'memoq-ai-hub-win32-x64.zip',
                  url: portableUrl
                }
              }
            };
          }
        };
      }
    },
    manifestUrl,
    packagingMode: 'portable'
  });
  const { runtime } = harness;

  t.after(() => {
    harness.dispose();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const available = await runtime.checkForUpdates({ manual: true });

  assert.equal(runtime.getUpdateStatus().latestVersion, '1.0.13');
  assert.equal(available.updateStatus, 'available');
  assert.equal(available.portableDownloadUrl, releaseNotesUrl);
  await assert.rejects(() => runtime.downloadPortableUpdate(), /browser download page/i);
  await assert.rejects(() => runtime.preparePortableUpdate(path.join(tempRoot, 'memoq-ai-hub-win32-x64.zip')), /browser download page/i);
});

test('background worker entrypoint stays parseable for packaging builds', () => {
  const entryPath = path.join(__dirname, '..', 'src', 'backgroundWorker.js');
  const result = spawnSync(process.execPath, ['--check', entryPath], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout || 'backgroundWorker.js failed syntax check');
});
