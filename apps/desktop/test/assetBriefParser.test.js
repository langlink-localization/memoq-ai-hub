const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MAX_BRIEF_CHARACTERS,
  fingerprintText,
  normalizeWhitespace,
  parseBriefAsset,
  truncateText
} = require('../src/asset/assetBriefParser');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-ai-hub-asset-brief-'));
}

test('asset brief parser normalizes whitespace deterministically', () => {
  const value = '  Line one \r\n\r\n\r\nLine two\t\rLine three  ';

  assert.equal(normalizeWhitespace(value), 'Line one\n\nLine two\nLine three');
});

test('asset brief parser truncates without leaving trailing whitespace', () => {
  assert.equal(truncateText('Alpha Beta   ', 10), 'Alpha Beta');
});

test('asset brief parser computes stable sha256 fingerprints', () => {
  assert.equal(
    fingerprintText('hello'),
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
  );
});

test('asset brief parser parses normalized truncated brief assets', () => {
  const tempDir = createTempDir();
  try {
    const briefPath = path.join(tempDir, 'brief.txt');
    fs.writeFileSync(briefPath, 'Line one\r\n\r\n\r\nLine two \r\n', 'utf8');

    const parsed = parseBriefAsset({ storedPath: briefPath });

    assert.equal(parsed.text, 'Line one\n\nLine two');
    assert.equal(parsed.rowCount, 3);
    assert.equal(parsed.fingerprint, fingerprintText('Line one\n\nLine two'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset brief parser truncates before computing row count and fingerprint', () => {
  const tempDir = createTempDir();
  try {
    const briefPath = path.join(tempDir, 'long-brief.txt');
    fs.writeFileSync(briefPath, 'A'.repeat(MAX_BRIEF_CHARACTERS + 25), 'utf8');

    const parsed = parseBriefAsset({ storedPath: briefPath });

    assert.equal(parsed.text.length, MAX_BRIEF_CHARACTERS);
    assert.equal(parsed.rowCount, 1);
    assert.equal(parsed.fingerprint, fingerprintText(parsed.text));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
