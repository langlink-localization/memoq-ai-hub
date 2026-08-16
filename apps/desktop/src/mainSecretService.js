const fs = require('fs');
const path = require('path');

const ENCRYPTED_PREFIX = 'enc:v1:';

function resolveSafeStorage() {
  try {
    const electron = require('electron');
    if (electron && electron.safeStorage) {
      return electron.safeStorage;
    }
  } catch {
  }
  return null;
}

function decodeLegacyBase64(value) {
  try {
    return Buffer.from(String(value), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function createMainSecretService(options = {}) {
  const paths = options.paths || { appDataRoot: process.cwd() };
  const logger = options.logger || { info() {}, warn() {}, error() {} };
  const safeStorage = options.safeStorage !== undefined ? options.safeStorage : resolveSafeStorage();
  const storePath = path.join(paths.appDataRoot, 'provider-secrets.json');

  const encryptionReady = Boolean(
    safeStorage
    && typeof safeStorage.encryptString === 'function'
    && typeof safeStorage.decryptString === 'function'
    && (typeof safeStorage.isEncryptionAvailable !== 'function' || safeStorage.isEncryptionAvailable())
  );

  function encryptToCipherText(plainText) {
    return safeStorage.encryptString(String(plainText)).toString('base64');
  }

  function decryptCipherText(cipherText) {
    return safeStorage.decryptString(Buffer.from(String(cipherText), 'base64'));
  }

  function readState() {
    try {
      return JSON.parse(fs.readFileSync(storePath, 'utf8')) || {};
    } catch {
      return {};
    }
  }

  function writeState(state) {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(state, null, 2), 'utf8');
  }

  function decryptStoredValue(value) {
    if (!value) {
      return '';
    }
    if (typeof value !== 'string') {
      return '';
    }
    if (value.startsWith(ENCRYPTED_PREFIX)) {
      if (!encryptionReady) {
        logger.warn('secret-decrypt-unavailable', 'Stored secret is encrypted but OS encryption is unavailable.');
        return '';
      }
      try {
        return decryptCipherText(value.slice(ENCRYPTED_PREFIX.length));
      } catch (error) {
        logger.error('secret-decrypt-failed', 'Failed to decrypt a stored secret.', { error });
        return '';
      }
    }
    return decodeLegacyBase64(value);
  }

  function migrateLegacyValues() {
    if (!encryptionReady) {
      return;
    }

    const state = readState();
    const migrated = {};
    let changed = false;

    for (const [id, value] of Object.entries(state)) {
      if (typeof value === 'string' && value && !value.startsWith(ENCRYPTED_PREFIX)) {
        const plainText = decodeLegacyBase64(value);
        if (!plainText) {
          migrated[id] = value;
          continue;
        }
        migrated[id] = ENCRYPTED_PREFIX + encryptToCipherText(plainText);
        changed = true;
      } else {
        migrated[id] = value;
      }
    }

    if (!changed) {
      return;
    }

    try {
      fs.copyFileSync(storePath, `${storePath}.bak`);
    } catch {
    }
    writeState(migrated);
    logger.info('secrets-migrated', 'Legacy plaintext secrets were re-encrypted with OS-level encryption.');
  }

  function has(id) {
    return Boolean(readState()[id]);
  }

  function get(id) {
    return decryptStoredValue(readState()[id]);
  }

  function set(id, secret) {
    const value = String(secret || '');
    if (!value) {
      return;
    }
    const state = readState();
    state[id] = encryptionReady
      ? ENCRYPTED_PREFIX + encryptToCipherText(value)
      : Buffer.from(value, 'utf8').toString('base64');
    writeState(state);
  }

  function deleteSecret(id) {
    const state = readState();
    if (!(id in state)) {
      return;
    }
    delete state[id];
    writeState(state);
  }

  function listIds() {
    return Object.keys(readState());
  }

  migrateLegacyValues();

  return {
    has,
    get,
    set,
    delete: deleteSecret,
    listIds,
    isEncryptionActive() {
      return encryptionReady;
    }
  };
}

module.exports = {
  createMainSecretService,
  ENCRYPTED_PREFIX
};
