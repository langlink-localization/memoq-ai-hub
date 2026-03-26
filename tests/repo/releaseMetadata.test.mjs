import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDesktopPackageVersion,
  validateReleaseTag
} from '../../tooling/scripts/release-metadata.mjs';

test('release metadata reads desktop package version as the release source of truth', () => {
  assert.equal(getDesktopPackageVersion(), '1.0.3');
});

test('release metadata validates matching tags against desktop package version', () => {
  assert.deepEqual(validateReleaseTag('v1.0.3'), {
    version: '1.0.3',
    tag: 'v1.0.3'
  });
});

test('release metadata rejects tags that do not match desktop package version', () => {
  assert.throws(
    () => validateReleaseTag('v9.9.9'),
    /does not match apps\/desktop\/package\.json version 1\.0\.3/
  );
});
