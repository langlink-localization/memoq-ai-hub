import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDesktopPackageVersion,
  validateReleaseTag,
  buildStableUpdateManifest,
  STABLE_UPDATE_MANIFEST_NAME,
  PORTABLE_WINDOWS_ARTIFACT_NAME
} from '../../tooling/scripts/release-metadata.mjs';

const currentDesktopVersion = getDesktopPackageVersion();
const currentDesktopTag = `v${currentDesktopVersion}`;

test('release metadata reads desktop package version as the release source of truth', () => {
  assert.match(currentDesktopVersion, /^\d+\.\d+\.\d+$/);
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
    publishedAt: '2026-03-26T00:00:00.000Z'
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
        url: 'https://github.com/langlink-localization/memoq-ai-hub/releases/download/v1.0.7/memoq-ai-hub-win32-x64.zip'
      }
    }
  });
});
