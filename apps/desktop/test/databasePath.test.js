const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildSqlWasmCandidates } = require('../src/database');

test('SQL WASM resolution covers source, Vite development, and packaged layouts', () => {
  const sourceDir = path.join('repo', 'apps', 'desktop', 'src');
  const viteBuildDir = path.join('repo', 'apps', 'desktop', '.vite', 'build');
  const resourcesDir = path.join('installed-app', 'resources');
  const expectedWorkspaceWasm = path.join('repo', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');

  assert.equal(
    buildSqlWasmCandidates(sourceDir, resourcesDir).some((candidate) => (
      candidate.endsWith(expectedWorkspaceWasm)
    )),
    true
  );
  assert.equal(
    buildSqlWasmCandidates(viteBuildDir, resourcesDir).some((candidate) => (
      candidate.endsWith(expectedWorkspaceWasm)
    )),
    true
  );
  assert.equal(
    buildSqlWasmCandidates(viteBuildDir, resourcesDir).includes(
      path.join(resourcesDir, 'sql-wasm.wasm')
    ),
    true
  );
});
