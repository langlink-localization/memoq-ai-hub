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
