const fs = require('fs');
const path = require('path');

function createFallbackStore({ cwd, name }) {
  const filePath = path.join(String(cwd || process.cwd()), `${String(name || 'store')}.json`);

  function readState() {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
    } catch {
      return {};
    }
  }

  function writeState(state) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
  }

  return {
    get(key) {
      return readState()[key];
    },
    set(key, value) {
      const state = readState();
      state[key] = value;
      writeState(state);
    },
    delete(key) {
      const state = readState();
      delete state[key];
      writeState(state);
    }
  };
}

function createBackingStore(paths) {
  const options = {
    cwd: paths.appDataRoot,
    name: 'provider-secrets',
    clearInvalidConfig: true
  };

  try {
    const Store = require('electron-store');
    return new Store(options);
  } catch (_error) {
    return createFallbackStore(options);
  }
}

function resolveSafeStorage() {
  try {
    const electron = require('electron');
    if (electron && electron.safeStorage) {
      return electron.safeStorage;
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function createSecretStore(paths) {
  const store = createBackingStore(paths);
  const safeStorage = resolveSafeStorage();

  function encrypt(plainText) {
    const value = String(plainText || '');
    if (!value) return '';
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(value).toString('base64');
    }
    return Buffer.from(value, 'utf8').toString('base64');
  }

  function decrypt(cipherText) {
    const value = String(cipherText || '');
    if (!value) return '';
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    }
    return Buffer.from(value, 'base64').toString('utf8');
  }

  return {
    has(id) {
      return Boolean(store.get(id));
    },
    get(id) {
      const encrypted = store.get(id);
      return encrypted ? decrypt(encrypted) : '';
    },
    set(id, secret) {
      const value = String(secret || '');
      if (!value) return;
      store.set(id, encrypt(value));
    },
    delete(id) {
      store.delete(id);
    }
  };
}

module.exports = {
  createSecretStore
};
