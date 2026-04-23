const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_DESKTOP_VERSION,
  resolveDesktopPackagePath,
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

test('readDesktopPackageMetadata walks up from packaged build paths to the app package.json', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-desktop-meta-packaged-'));
  const packagedBuildDir = path.join(repoRoot, '.vite', 'build');
  const packagePath = path.join(repoRoot, 'package.json');

  try {
    fs.mkdirSync(packagedBuildDir, { recursive: true });
    fs.writeFileSync(packagePath, JSON.stringify({ version: '9.8.7' }), 'utf8');

    assert.equal(resolveDesktopPackagePath(packagedBuildDir), packagePath);

    const metadata = readDesktopPackageMetadata(packagedBuildDir);
    assert.equal(metadata.desktopVersion, '9.8.7');
    assert.equal(metadata.packagePath, packagePath);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
