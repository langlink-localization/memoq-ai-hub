const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const forgeConfig = require('../forge.config');

test('forge packaging collects transitive runtime dependencies for discovered desktop modules', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-forge-packaging-'));
  const buildDir = path.join(tempRoot, '.vite', 'build');

  try {
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'backgroundWorker.js'), "require('express');\n", 'utf8');

    const packageNames = forgeConfig.__testables.collectRuntimePackageNames(tempRoot);

    assert.equal(packageNames.includes('express'), true);
    assert.equal(packageNames.includes('mime-db'), true);
    assert.equal(packageNames.includes('electron'), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('forge packaging resolves hoisted ESM-only package roots without a CommonJS export', () => {
  const packageDir = forgeConfig.__testables.resolvePackageDirectory('xml-naming');
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')
  );

  assert.equal(packageJson.name, 'xml-naming');
});

test('forge packaging treats bundled parser entrypoints as self-contained', () => {
  const xlsxDir = forgeConfig.__testables.resolvePackageDirectory('xlsx');
  const parserDir = forgeConfig.__testables.resolvePackageDirectory('fast-xml-parser');

  assert.deepEqual(forgeConfig.__testables.getPackageDependencyNames(xlsxDir), []);
  assert.deepEqual(forgeConfig.__testables.getPackageDependencyNames(parserDir), []);
});

test('forge packaging keeps only runtime files for heavyweight dependencies', () => {
  const shouldCopy = forgeConfig.__testables.shouldCopyRuntimePackagePath;

  assert.equal(shouldCopy('sql.js', 'dist/sql-wasm.js'), true);
  assert.equal(shouldCopy('sql.js', 'dist/sql-asm-debug.js'), false);
  assert.equal(shouldCopy('xlsx', 'xlsx.js'), true);
  assert.equal(shouldCopy('xlsx', 'dist/xlsx.full.min.js'), false);
  assert.equal(shouldCopy('openai', 'resources/responses/responses.js'), true);
  assert.equal(shouldCopy('openai', 'resources/responses/responses.d.ts'), false);
  assert.equal(shouldCopy('openai', 'src/resources/responses/responses.ts'), false);
});
