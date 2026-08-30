const fs = require('fs');
const path = require('path');

const ENCRYPTED_PREFIX = 'enc:v1:';
const OS_SECRET_STORAGE_UNAVAILABLE = 'OS_SECRET_STORAGE_UNAVAILABLE';

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

function createSecretStorageUnavailableError() {
  const error = new Error('Windows secure credential storage is unavailable. Restart Windows or sign in again before saving an API key.');
  error.code = OS_SECRET_STORAGE_UNAVAILABLE;
  error.statusCode = 503;
  return error;
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
    } catch (error) {
      logger.warn('secret-store-read-failed', 'Provider secret store was unreadable; starting from an empty store.', { error: error?.message });
      return {};
    }
  }

  function writeState(state) {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const temporaryPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(temporaryPath, storePath);
    } finally {
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // Temp-file cleanup is best-effort; the store itself was already renamed into place.
      }
    }
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
      } catch {
        logger.error('secret-decrypt-failed', 'Failed to decrypt a stored secret.');
        return '';
      }
    }
    logger.warn('legacy-secret-unavailable', 'A legacy secret cannot be used until OS encryption is available for migration.');
    return '';
  }

  function migrateLegacyValues() {
    if (!encryptionReady) {
      return;
    }

    try {
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
          const encryptedValue = ENCRYPTED_PREFIX + encryptToCipherText(plainText);
          if (decryptCipherText(encryptedValue.slice(ENCRYPTED_PREFIX.length)) !== plainText) {
            throw new Error('OS secret encryption verification failed.');
          }
          migrated[id] = encryptedValue;
          changed = true;
        } else {
          migrated[id] = value;
        }
      }

      if (!changed) {
        return;
      }

      writeState(migrated);
      try {
        fs.rmSync(`${storePath}.bak`, { force: true });
      } catch {
      }
      logger.info('secrets-migrated', 'Legacy secrets were migrated to OS-level encryption.');
    } catch {
      logger.error('secrets-migration-failed', 'Legacy secret migration failed; the original store was preserved.');
    }
  }

  function has(id) {
    const value = readState()[id];
    return Boolean(encryptionReady && typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX));
  }

  function get(id) {
    return decryptStoredValue(readState()[id]);
  }

  function set(id, secret) {
    const value = String(secret || '');
    if (!value) {
      return;
    }
    if (!encryptionReady) {
      throw createSecretStorageUnavailableError();
    }
    const state = readState();
    let encryptedValue = '';
    try {
      encryptedValue = ENCRYPTED_PREFIX + encryptToCipherText(value);
      if (decryptCipherText(encryptedValue.slice(ENCRYPTED_PREFIX.length)) !== value) {
        throw new Error('OS secret encryption verification failed.');
      }
    } catch {
      throw createSecretStorageUnavailableError();
    }
    state[id] = encryptedValue;
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
    if (!encryptionReady) {
      return [];
    }
    return Object.entries(readState())
      .filter(([, value]) => typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX))
      .map(([id]) => id);
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
  ENCRYPTED_PREFIX,
  OS_SECRET_STORAGE_UNAVAILABLE
};
