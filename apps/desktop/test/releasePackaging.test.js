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

test('packaged desktop bundle includes transitive runtime dependencies required by the background worker', {
  skip: !packagedAppDir
}, async () => {
  assert.equal(fs.existsSync(packagedAsarPath), true, `Expected packaged app.asar at ${packagedAsarPath}`);

  const archivedFiles = new Set(asar.listPackage(packagedAsarPath));
  assert.equal(
    archivedFiles.has('\\node_modules\\mime-db\\package.json'),
    true,
    'Expected packaged runtime dependency "\\node_modules\\mime-db\\package.json" inside app.asar'
  );
  const extractedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-packaged-runtime-'));
  try {
    asar.extractAll(packagedAsarPath, extractedRoot);
    const packagedRequire = (packageName) => require(path.join(extractedRoot, 'node_modules', packageName));

    const XLSX = packagedRequire('xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['source', 'target'], ['Hello', 'Bonjour']]), 'Terms');
    const workbookBytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    assert.ok(workbookBytes.length > 0);

    const { XMLParser } = packagedRequire('fast-xml-parser');
    assert.equal(new XMLParser().parse('<root><value>ok</value></root>').root.value, 'ok');

    const OpenAI = packagedRequire('openai');
    assert.equal(typeof OpenAI, 'function');

    const initSqlJs = packagedRequire('sql.js');
    const SQL = await initSqlJs({
      locateFile: () => path.join(packagedAppDir, 'resources', 'sql-wasm.wasm')
    });
    const database = new SQL.Database();
    database.run('CREATE TABLE smoke (value TEXT);');
    database.run('INSERT INTO smoke VALUES (?);', ['ok']);
    assert.equal(database.exec('SELECT value FROM smoke;')[0].values[0][0], 'ok');
    database.close();

    assert.equal(archivedFiles.has('\\node_modules\\sql.js\\dist\\sql-asm-debug.js'), false);
    assert.equal(archivedFiles.has('\\node_modules\\openai\\src\\index.ts'), false);
    assert.equal(archivedFiles.has('\\node_modules\\xlsx\\dist\\xlsx.full.min.js'), false);
    assert.equal(archivedFiles.has('\\node_modules\\codepage\\package.json'), false);
  } finally {
    fs.rmSync(extractedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
