const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const { readDesktopPackageMetadata } = require('../src/shared/desktopMetadata');

const packagedAppDir = String(process.env.MEMOQ_AI_PACKAGED_APP_DIR || '').trim();
const packagedAsarPath = packagedAppDir ? path.join(packagedAppDir, 'resources', 'app.asar') : '';
const expectedVersion = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
).version;

test('packaged desktop metadata resolves the shipped version from the unpacked app directory', {
  skip: !packagedAppDir
}, () => {
  const metadata = readDesktopPackageMetadata(path.join(packagedAppDir, '.vite'));

  assert.equal(metadata.desktopVersion, expectedVersion);
  assert.match(metadata.packagePath, /package\.json$/);
});

test('packaged desktop bundle stores the shipped desktop version inside app.asar', {
  skip: !packagedAppDir
}, () => {
  assert.equal(fs.existsSync(packagedAsarPath), true, `Expected packaged app.asar at ${packagedAsarPath}`);

  const packagedPackageJson = JSON.parse(
    asar.extractFile(packagedAsarPath, 'package.json').toString('utf8')
  );

  assert.equal(packagedPackageJson.version, expectedVersion);
});

test('packaged desktop bundle includes transitive runtime dependencies required by the background worker', {
  skip: !packagedAppDir
}, () => {
  assert.equal(fs.existsSync(packagedAsarPath), true, `Expected packaged app.asar at ${packagedAsarPath}`);

  const archivedFiles = new Set(asar.listPackage(packagedAsarPath));
  assert.equal(
    archivedFiles.has('\\node_modules\\mime-db\\package.json'),
    true,
    'Expected packaged runtime dependency "\\node_modules\\mime-db\\package.json" inside app.asar'
  );
});
