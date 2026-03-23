const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_DESKTOP_VERSION,
  readDesktopPackageMetadata
} = require('../src/shared/desktopMetadata');

test('readDesktopPackageMetadata returns package version and mtime when package.json exists', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-desktop-meta-'));
  const packagePath = path.join(repoRoot, 'package.json');

  try {
    fs.writeFileSync(packagePath, JSON.stringify({ version: '2.3.4' }), 'utf8');

    const metadata = readDesktopPackageMetadata(repoRoot);

    assert.equal(metadata.desktopVersion, '2.3.4');
    assert.equal(metadata.packagePath, packagePath);
    assert.ok(metadata.packageLastModifiedAt);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('readDesktopPackageMetadata falls back to the default version when package.json is unavailable', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-desktop-meta-missing-'));

  try {
    const metadata = readDesktopPackageMetadata(repoRoot);

    assert.equal(metadata.desktopVersion, DEFAULT_DESKTOP_VERSION);
    assert.equal(metadata.packagePath, path.join(repoRoot, 'package.json'));
    assert.equal(metadata.packageLastModifiedAt, '');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
