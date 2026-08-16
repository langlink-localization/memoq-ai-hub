const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createMainSecretService, ENCRYPTED_PREFIX } = require('../src/mainSecretService');

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

test('main secret service migrates legacy base64 values in place with a backup', () => {
  const root = createTempRoot();
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const legacyValue = Buffer.from('legacy-key', 'utf8').toString('base64');
  writeStoreFile(root, { 'provider-legacy': legacyValue });

  const service = createMainSecretService({ paths: { appDataRoot: root }, safeStorage: createFakeSafeStorage() });

  assert.equal(service.get('provider-legacy'), 'legacy-key');

  const migrated = readStoreFile(root)['provider-legacy'];
  assert.ok(migrated.startsWith(ENCRYPTED_PREFIX), 'legacy value should be re-encrypted');

  const backup = JSON.parse(fs.readFileSync(path.join(root, 'provider-secrets.json.bak'), 'utf8'));
  assert.equal(backup['provider-legacy'], legacyValue, 'backup keeps the pre-migration file');
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

test('main secret service falls back to base64 when OS encryption is unavailable', () => {
  const root = createTempRoot();
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const service = createMainSecretService({ paths: { appDataRoot: root }, safeStorage: null });
  assert.equal(service.isEncryptionActive(), false);

  service.set('provider-plain', 'plain-key');
  assert.equal(readStoreFile(root)['provider-plain'], Buffer.from('plain-key', 'utf8').toString('base64'));
  assert.equal(service.get('provider-plain'), 'plain-key');
});

test('main secret service starts empty when the store file is missing or corrupt', () => {
  const root = createTempRoot();
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));

  writeStoreFile(root, { broken: true });
  fs.writeFileSync(path.join(root, 'provider-secrets.json'), '{not-json', 'utf8');

  const service = createMainSecretService({ paths: { appDataRoot: root }, safeStorage: null });
  assert.deepEqual(service.listIds(), []);

  service.set('provider-new', 'value');
  assert.equal(service.get('provider-new'), 'value');
});
