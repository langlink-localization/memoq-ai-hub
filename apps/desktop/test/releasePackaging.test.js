const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
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

test('packaged desktop bundle loads governed runtime modules from ASAR', {
  skip: !packagedAppDir
}, async () => {
  assert.equal(fs.existsSync(packagedAsarPath), true, `Expected packaged app.asar at ${packagedAsarPath}`);

  const archivedFiles = new Set(asar.listPackage(packagedAsarPath));
  const extractedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-packaged-runtime-'));
  try {
    asar.extractAll(packagedAsarPath, extractedRoot);
    const packagedRequire = (bundlePath) => require(path.join(extractedRoot, '.vite', 'build', bundlePath));

    const XLSX = require('xlsx');
    assert.equal(XLSX.version, '0.20.3');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['source', 'target'], ['Hello', 'Bonjour']]), 'Terms');
    const workbookPath = path.join(extractedRoot, 'runtime-smoke.xlsx');
    XLSX.writeFile(workbook, workbookPath);

    const { parseAsset } = packagedRequire(path.join('asset', 'assetParseCache.js'));
    const parsedWorkbook = parseAsset({
      id: 'runtime-xlsx',
      type: 'glossary',
      fileName: 'runtime-smoke.xlsx',
      storedPath: workbookPath,
      sha256: 'runtime-smoke'
    });
    assert.equal(parsedWorkbook.entries[0].sourceTerm, 'Hello');
    assert.equal(parsedWorkbook.entries[0].targetTerm, 'Bonjour');

    const providerBundle = packagedRequire(path.join('provider', 'providerRegistry.js'));
    const databaseBundle = packagedRequire('database.js');
    assert.equal(typeof providerBundle.createProviderRegistry, 'function');
    assert.equal(typeof databaseBundle.createDatabase, 'function');

    assert.equal(archivedFiles.has('\\node_modules\\sql.js\\dist\\sql-asm-debug.js'), false);
    assert.equal(archivedFiles.has('\\node_modules\\openai\\src\\index.ts'), false);
    assert.equal(archivedFiles.has('\\node_modules\\xlsx\\dist\\xlsx.full.min.js'), false);
    assert.equal(archivedFiles.has('\\node_modules\\codepage\\package.json'), false);
  } finally {
    fs.rmSync(extractedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('packaged release includes the Squirrel Windows installer beside the portable zip', {
  skip: !packagedAppDir
}, () => {
  const squirrelSetupPath = path.join(path.dirname(packagedAppDir), 'make', 'squirrel.windows', 'x64', 'memoq-ai-hub-setup.exe');
  assert.equal(
    fs.existsSync(squirrelSetupPath),
    true,
    `Expected Squirrel installer at ${squirrelSetupPath}`
  );
});
