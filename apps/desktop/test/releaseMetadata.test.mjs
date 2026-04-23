import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildStableUpdateManifest,
  getDesktopPackageVersion,
  validateReleaseCommitOnRef,
  validateReleaseTag
} from '../../../tooling/scripts/release-metadata.mjs';

test('release metadata reads the desktop package version from apps/desktop/package.json', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-release-meta-'));
  const desktopDir = path.join(repoRoot, 'apps', 'desktop');

  try {
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'package.json'), JSON.stringify({ version: '3.4.5' }), 'utf8');

    assert.equal(getDesktopPackageVersion(repoRoot), '3.4.5');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('release metadata rejects tags that do not match the desktop package version', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-release-meta-tag-'));
  const desktopDir = path.join(repoRoot, 'apps', 'desktop');

  try {
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'package.json'), JSON.stringify({ version: '1.0.12' }), 'utf8');

    assert.deepEqual(validateReleaseTag('v1.0.12', repoRoot), {
      version: '1.0.12',
      tag: 'v1.0.12'
    });

    assert.throws(
      () => validateReleaseTag('v1.0.11', repoRoot),
      /does not match apps\/desktop\/package\.json version 1\.0\.12/
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('stable update manifest points portable downloads at the matching release tag', () => {
  const manifest = buildStableUpdateManifest({
    version: '1.0.12',
    repository: 'langlink-localization/memoq-ai-hub',
    publishedAt: '2026-03-31T00:00:00.000Z'
  });

  assert.equal(manifest.tag, 'v1.0.12');
  assert.equal(manifest.version, '1.0.12');
  assert.equal(
    manifest.assets.portable.url,
    'https://github.com/langlink-localization/memoq-ai-hub/releases/download/v1.0.12/memoq-ai-hub-win32-x64.zip'
  );
});

test('release metadata rejects commits that are not reachable from the release base ref', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-release-mainline-'));
  const commitFile = path.join(repoRoot, 'tracked.txt');

  const git = (...args) => {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8'
    }).trim();
  };

  try {
    git('init', '--initial-branch=main');
    git('config', 'user.name', 'Codex');
    git('config', 'user.email', 'codex@example.com');

    fs.writeFileSync(commitFile, 'main\n', 'utf8');
    git('add', 'tracked.txt');
    git('commit', '-m', 'main commit');
    const mainCommit = git('rev-parse', 'HEAD');

    git('checkout', '-b', 'release/old');
    fs.writeFileSync(commitFile, 'release old\n', 'utf8');
    git('commit', '-am', 'old release commit');
    const oldReleaseCommit = git('rev-parse', 'HEAD');

    assert.deepEqual(validateReleaseCommitOnRef(mainCommit, 'main', repoRoot), {
      commitSha: mainCommit,
      refName: 'main'
    });

    assert.throws(
      () => validateReleaseCommitOnRef(oldReleaseCommit, 'main', repoRoot),
      /is not reachable from main/
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
