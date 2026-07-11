import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  listFiles,
  median,
  summarizeDirectory,
  validateBenchmarkArtifacts
} from '../../tooling/scripts/benchmark-desktop.mjs';

test('desktop benchmark median is stable for odd and even sample sets', () => {
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([8, 2, 4, 6]), 5);
  assert.equal(median([]), null);
});

test('desktop benchmark directory summary counts nested file bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-benchmark-summary-'));
  try {
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, 'small.txt'), 'abc');
    fs.writeFileSync(path.join(root, 'nested', 'large.txt'), '123456');

    const files = listFiles(root);
    const summary = summarizeDirectory(root, 1);

    assert.equal(files.length, 2);
    assert.equal(summary.totalBytes, 9);
    assert.equal(summary.fileCount, 2);
    assert.deepEqual(summary.largestFiles, [{ path: 'nested/large.txt', bytes: 6 }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('desktop benchmark rejects missing or empty acceptance artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-benchmark-artifacts-'));
  const packageDir = path.join(root, 'package');
  const rendererDir = path.join(root, 'renderer');
  const releaseArchive = path.join(root, 'portable.7z');

  try {
    assert.throws(
      () => validateBenchmarkArtifacts({ packageDir, releaseArchive, rendererDir }),
      /Desktop benchmark prerequisites are missing/
    );

    fs.mkdirSync(packageDir);
    fs.mkdirSync(rendererDir);
    fs.writeFileSync(releaseArchive, '');
    assert.throws(
      () => validateBenchmarkArtifacts({ packageDir, releaseArchive, rendererDir }),
      /non-empty compact release archive/
    );

    fs.writeFileSync(releaseArchive, 'archive');
    assert.doesNotThrow(
      () => validateBenchmarkArtifacts({ packageDir, releaseArchive, rendererDir })
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
