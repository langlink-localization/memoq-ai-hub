const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createMainSecretService,
  ENCRYPTED_PREFIX,
  OS_SECRET_STORAGE_UNAVAILABLE
} = require('../src/mainSecretService');

function createFakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText) => Buffer.from(`wrapped:${plainText.toString()}`, 'utf8'),
    decryptString: (buffer) => {
      const text = buffer.toString('utf8');
      return text.startsWith('wrapped:') ? text.slice('wrapped:'.length) : '';
    }
  };
}

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-main-secrets-'));
}

function writeStoreFile(root, state) {
  fs.writeFileSync(path.join(root, 'provider-secrets.json'), JSON.stringify(state, null, 2), 'utf8');
}

function readStoreFile(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'provider-secrets.json'), 'utf8'));
}

test('main secret service round-trips values through OS encryption', () => {
  const root = createTempRoot();
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const service = createMainSecretService({ paths: { appDataRoot: root }, safeStorage: createFakeSafeStorage() });
  service.set('provider-1', 'sk-secret');

  const stored = readStoreFile(root)['provider-1'];
  assert.ok(stored.startsWith(ENCRYPTED_PREFIX), 'stored value should be marked as encrypted');
  assert.equal(stored.includes('sk-secret'), false, 'plaintext must not be readable in the file');

  assert.equal(service.get('provider-1'), 'sk-secret');
  assert.equal(service.has('provider-1'), true);
  assert.deepEqual(service.listIds(), ['provider-1']);

  service.delete('provider-1');
  assert.equal(service.has('provider-1'), false);
  assert.equal(service.get('provider-1'), '');
});

test('main secret service atomically migrates legacy base64 values and removes old backups', () => {
  const root = createTempRoot();
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const legacyValue = Buffer.from('legacy-key', 'utf8').toString('base64');
  writeStoreFile(root, { 'provider-legacy': legacyValue });
  fs.writeFileSync(path.join(root, 'provider-secrets.json.bak'), 'old reversible backup', 'utf8');

  const service = createMainSecretService({ paths: { appDataRoot: root }, safeStorage: createFakeSafeStorage() });

  assert.equal(service.get('provider-legacy'), 'legacy-key');

  const migrated = readStoreFile(root)['provider-legacy'];
  assert.ok(migrated.startsWith(ENCRYPTED_PREFIX), 'legacy value should be re-encrypted');

  assert.equal(fs.existsSync(path.join(root, 'provider-secrets.json.bak')), false);
  assert.deepEqual(fs.readdirSync(root).filter((name) => name.endsWith('.tmp')), []);
});

test('main secret service leaves already-encrypted values untouched', () => {
  const root = createTempRoot();
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const fakeStorage = createFakeSafeStorage();
  const encrypted = ENCRYPTED_PREFIX + fakeStorage.encryptString('stable-key').toString('base64');
  writeStoreFile(root, { 'provider-1': encrypted });

  const service = createMainSecretService({ paths: { appDataRoot: root }, safeStorage: fakeStorage });
  assert.equal(readStoreFile(root)['provider-1'], encrypted);
  assert.equal(service.get('provider-1'), 'stable-key');
  assert.equal(fs.existsSync(path.join(root, 'provider-secrets.json.bak')), false, 'no backup when nothing migrates');
});

test('main secret service fails closed when OS encryption is unavailable and leaves the file unchanged', () => {
  const root = createTempRoot();
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const storePath = path.join(root, 'provider-secrets.json');
  writeStoreFile(root, { existing: ENCRYPTED_PREFIX + 'ciphertext' });
  const before = fs.readFileSync(storePath);
  const service = createMainSecretService({ paths: { appDataRoot: root }, safeStorage: null });
  assert.equal(service.isEncryptionActive(), false);

  assert.throws(
    () => service.set('provider-plain', 'plain-key'),
    (error) => error.code === OS_SECRET_STORAGE_UNAVAILABLE && error.statusCode === 503
  );
  assert.deepEqual(fs.readFileSync(storePath), before);
  assert.equal(service.get('existing'), '');
  assert.equal(service.has('existing'), false);
  assert.deepEqual(service.listIds(), []);
});

test('legacy values are unusable without OS encryption but can still be deleted', () => {
  const root = createTempRoot();
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));

  writeStoreFile(root, { legacy: Buffer.from('old-secret', 'utf8').toString('base64') });
  const service = createMainSecretService({ paths: { appDataRoot: root }, safeStorage: null });

  assert.equal(service.get('legacy'), '');
  assert.equal(service.has('legacy'), false);
  service.delete('legacy');
  assert.deepEqual(readStoreFile(root), {});
});

test('main secret service normalizes OS encryption failures and preserves existing data', () => {
  const root = createTempRoot();
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));

  writeStoreFile(root, { existing: 'unchanged' });
  const storePath = path.join(root, 'provider-secrets.json');
  const before = fs.readFileSync(storePath);
  const service = createMainSecretService({
    paths: { appDataRoot: root },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: () => { throw new Error('native encryption failed'); },
      decryptString: () => ''
    }
  });

  assert.throws(
    () => service.set('provider-new', 'new-secret'),
    (error) => error.code === OS_SECRET_STORAGE_UNAVAILABLE && error.statusCode === 503
  );
  assert.deepEqual(fs.readFileSync(storePath), before);
});

test('failed legacy migration preserves the original store and does not log secret data', () => {
  const root = createTempRoot();
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const secret = 'legacy-value-that-must-not-leak';
  writeStoreFile(root, { legacy: Buffer.from(secret, 'utf8').toString('base64') });
  const before = fs.readFileSync(path.join(root, 'provider-secrets.json'));
  const logs = [];
  const failingStorage = {
    isEncryptionAvailable: () => true,
    encryptString: () => { throw new Error(`failed for ${secret}`); },
    decryptString: () => ''
  };

  const service = createMainSecretService({
    paths: { appDataRoot: root },
    safeStorage: failingStorage,
    logger: {
      info(...args) { logs.push(args); },
      warn(...args) { logs.push(args); },
      error(...args) { logs.push(args); }
    }
  });

  assert.deepEqual(fs.readFileSync(path.join(root, 'provider-secrets.json')), before);
  assert.equal(service.get('legacy'), '');
  assert.equal(JSON.stringify(logs).includes(secret), false);
});

test('main secret service stays empty when the store file is missing or corrupt', () => {
  const root = createTempRoot();
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, 'provider-secrets.json'), '{not-json', 'utf8');

  const service = createMainSecretService({ paths: { appDataRoot: root }, safeStorage: null });
  assert.deepEqual(service.listIds(), []);
  assert.throws(() => service.set('provider-new', 'value'), (error) => error.code === OS_SECRET_STORAGE_UNAVAILABLE);
});
