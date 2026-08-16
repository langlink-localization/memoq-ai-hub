const { createSecretStore } = require('./secretStore');

const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

function createWorkerSecretStore(options = {}) {
  const paths = options.paths || null;
  const logger = options.logger || { info() {}, warn() {}, error() {} };
  const useMainProcess = Boolean(options.useMainProcess);
  const send = typeof options.send === 'function' ? options.send : (() => {});
  const requestTimeoutMs = Number.isFinite(Number(options.requestTimeoutMs))
    ? Number(options.requestTimeoutMs)
    : DEFAULT_REQUEST_TIMEOUT_MS;

  const localStore = useMainProcess ? null : createSecretStore(paths || { appDataRoot: process.cwd() });
  const decryptedCache = new Map();
  const idCache = new Set();
  const pendingRequests = new Map();
  let requestSequence = 0;
  let readyPromise = null;

  function handleMessage(message) {
    if (!message || message.type !== 'main-response') {
      return;
    }

    const pending = pendingRequests.get(message.id);
    if (!pending) {
      return;
    }

    pendingRequests.delete(message.id);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }

    if (message.ok) {
      pending.resolve(message.result);
      return;
    }

    pending.reject(new Error(String(message.error?.message || 'Main-process request failed.')));
  }

  function requestMain(channel, payload) {
    return new Promise((resolve, reject) => {
      const id = `secret_req_${Date.now()}_${requestSequence += 1}`;
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`Main-process request timed out: ${channel}`));
      }, requestTimeoutMs);

      pendingRequests.set(id, { resolve, reject, timer });

      try {
        send({ type: 'main-request', id, channel, payload });
      } catch (error) {
        pendingRequests.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async function get(id) {
    const key = String(id || '');
    if (decryptedCache.has(key)) {
      return decryptedCache.get(key);
    }

    const value = useMainProcess
      ? String((await requestMain('secrets.get', { id: key }))?.value || '')
      : String(localStore.get(key) || '');

    decryptedCache.set(key, value);
    return value;
  }

  function has(id) {
    if (useMainProcess) {
      return idCache.has(String(id || ''));
    }
    return Boolean(localStore.has(id));
  }

  async function set(id, secret) {
    const key = String(id || '');
    if (useMainProcess) {
      await requestMain('secrets.set', { id: key, secret: String(secret || '') });
    } else {
      localStore.set(key, secret);
    }
    decryptedCache.set(key, String(secret || ''));
    idCache.add(key);
  }

  async function deleteSecret(id) {
    const key = String(id || '');
    if (useMainProcess) {
      await requestMain('secrets.delete', { id: key });
    } else {
      localStore.delete(key);
    }
    decryptedCache.delete(key);
    idCache.delete(key);
  }

  function ready() {
    if (!useMainProcess) {
      return Promise.resolve();
    }

    if (!readyPromise) {
      readyPromise = (async () => {
        try {
          const result = await requestMain('secrets.listIds', {});
          for (const id of Array.isArray(result?.ids) ? result.ids : []) {
            idCache.add(String(id));
          }
          logger.info('secret-bridge-ready', 'Worker secret bridge loaded the secret id list from the main process.', {
            count: idCache.size
          });
        } catch (error) {
          readyPromise = null;
          logger.error('secret-bridge-ready-failed', 'Failed to load the secret id list from the main process.', { error });
          throw error;
        }
      })();
    }

    return readyPromise;
  }

  return {
    handleMessage,
    ready,
    get,
    has,
    set,
    delete: deleteSecret
  };
}

module.exports = {
  createWorkerSecretStore
};
