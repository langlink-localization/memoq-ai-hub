import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getDesktopPackageVersion,
  validateReleaseTag,
  buildStableUpdateManifest,
  writeStableUpdateManifest,
  STABLE_UPDATE_MANIFEST_NAME,
  PORTABLE_WINDOWS_ARTIFACT_NAME,
  COMPACT_PORTABLE_WINDOWS_ARTIFACT_NAME
} from '../../tooling/scripts/release-metadata.mjs';

const currentDesktopVersion = getDesktopPackageVersion();
const currentDesktopTag = `v${currentDesktopVersion}`;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const portableSha256 = 'a'.repeat(64);
const portableCompactSha256 = 'b'.repeat(64);

test('release metadata reads desktop package version as the release source of truth', () => {
  assert.match(currentDesktopVersion, /^\d+\.\d+\.\d+$/);
});

test('root package version tracks the desktop package version', () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(
    rootPackage.version,
    currentDesktopVersion,
    'root package.json must not drift from apps/desktop/package.json'
  );
});

test('release metadata validates matching tags against desktop package version', () => {
  assert.deepEqual(validateReleaseTag(currentDesktopTag), {
    version: currentDesktopVersion,
    tag: currentDesktopTag
  });
});

test('release metadata rejects tags that do not match desktop package version', () => {
  assert.throws(
    () => validateReleaseTag('v9.9.9'),
    new RegExp(`does not match apps\\/desktop\\/package\\.json version ${currentDesktopVersion.replaceAll('.', '\\.')}`)
  );
});

test('release metadata builds the public stable update manifest', () => {
  const manifest = buildStableUpdateManifest({
    version: '1.0.7',
    publishedAt: '2026-03-26T00:00:00.000Z',
    assetSha256: {
      portable: portableSha256,
      portableCompact: portableCompactSha256
    }
  });

  assert.equal(STABLE_UPDATE_MANIFEST_NAME, 'memoq-ai-hub-updates-stable.json');
  assert.deepEqual(manifest, {
    version: '1.0.7',
    tag: 'v1.0.7',
    channel: 'stable',
    publishedAt: '2026-03-26T00:00:00.000Z',
    releaseNotes: '',
    releaseNotesUrl: 'https://github.com/langlink-localization/memoq-ai-hub/releases/tag/v1.0.7',
    assets: {
      portable: {
        name: PORTABLE_WINDOWS_ARTIFACT_NAME,
        url: 'https://github.com/langlink-localization/memoq-ai-hub/releases/download/v1.0.7/memoq-ai-hub-win32-x64.zip',
        sha256: portableSha256
      },
      portableCompact: {
        name: COMPACT_PORTABLE_WINDOWS_ARTIFACT_NAME,
        url: 'https://github.com/langlink-localization/memoq-ai-hub/releases/download/v1.0.7/memoq-ai-hub-win32-x64.7z',
        sha256: portableCompactSha256
      }
    }
  });
});

test('release metadata hashes the packaged artifacts when writing the stable manifest', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-release-digests-'));
  const zipBytes = Buffer.from('portable zip');
  const compactBytes = Buffer.from('portable compact');

  try {
    fs.writeFileSync(path.join(tempRoot, PORTABLE_WINDOWS_ARTIFACT_NAME), zipBytes);
    fs.writeFileSync(path.join(tempRoot, COMPACT_PORTABLE_WINDOWS_ARTIFACT_NAME), compactBytes);
    const outputPath = path.join(tempRoot, STABLE_UPDATE_MANIFEST_NAME);

    const { manifest } = writeStableUpdateManifest(outputPath, {
      version: '1.0.7',
      publishedAt: '2026-03-26T00:00:00.000Z'
    });

    assert.equal(manifest.assets.portable.sha256, createHash('sha256').update(zipBytes).digest('hex'));
    assert.equal(manifest.assets.portableCompact.sha256, createHash('sha256').update(compactBytes).digest('hex'));
    assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), manifest);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release metadata rejects malformed digests and missing packaged artifacts', () => {
  assert.throws(
    () => buildStableUpdateManifest({
      version: '1.0.7',
      assetSha256: {
        portable: 'not-a-digest',
        portableCompact: portableCompactSha256
      }
    }),
    /Portable ZIP SHA-256 must be a 64-character hexadecimal digest/
  );

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-release-missing-artifacts-'));
  try {
    assert.throws(
      () => writeStableUpdateManifest(path.join(tempRoot, STABLE_UPDATE_MANIFEST_NAME), { version: '1.0.7' }),
      /Release artifact not found/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release workflow uploads every portable artifact advertised by the manifest', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');

  assert.match(workflow, /\$compactPath = "apps\/desktop\/out\/memoq-ai-hub-win32-x64\.7z"/);
  assert.match(workflow, /Test-Path \$compactPath/);
  assert.match(workflow, /gh release upload \$tag \$zipPath \$compactPath \$manifestPath --clobber/);
  assert.match(workflow, /gh release create \$tag \$zipPath \$compactPath \$manifestPath --title/);
});
