const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildAssetPreview } = require('../src/asset/assetPreviewBuilder');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-ai-hub-asset-preview-'));
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateText(value, maxCharacters) {
  const normalized = String(value || '');
  if (!maxCharacters || normalized.length <= maxCharacters) {
    return normalized;
  }

  return normalized.slice(0, maxCharacters).trimEnd();
}

test('asset preview builder shapes glossary preview rows and preserves parseInfo fields', () => {
  const preview = buildAssetPreview(
    { type: 'glossary', storedPath: 'unused' },
    {
      rowCount: 2,
      entries: [
        { sourceTerm: 'Save', targetTerm: 'Enregistrer', srcLang: 'en', tgtLang: 'fr', forbidden: false, note: 'UI' },
        { sourceTerm: 'Cancel', targetTerm: 'Annuler', srcLang: 'en', tgtLang: 'fr', forbidden: true, note: '' }
      ],
      parseInfo: {
        parsingMode: 'smart',
        smartParsingAvailable: true,
        tbStructureAvailable: true
      }
    },
    {},
    { normalizeWhitespace, truncateText }
  );

  assert.equal(preview.type, 'glossary');
  assert.equal(preview.rowCount, 2);
  assert.equal(preview.rows[0].sourceTerm, 'Save');
  assert.equal(preview.rows[1].forbidden, true);
  assert.equal(preview.parsingMode, 'smart');
  assert.equal(preview.tbStructureAvailable, true);
});

test('asset preview builder shapes custom tm preview rows', () => {
  const preview = buildAssetPreview(
    { type: 'custom_tm', storedPath: 'unused' },
    {
      rowCount: 1,
      entries: [
        { sourceTerm: 'Save', targetTerm: 'Enregistrer', srcLang: '', tgtLang: '' }
      ],
      parseInfo: {
        parsingMode: 'fallback',
        smartParsingAvailable: false
      }
    },
    {},
    { normalizeWhitespace, truncateText }
  );

  assert.equal(preview.type, 'custom_tm');
  assert.deepEqual(preview.columns, ['sourceTerm', 'targetTerm', 'srcLang', 'tgtLang']);
  assert.equal(preview.rows[0].targetTerm, 'Enregistrer');
  assert.equal(preview.parsingMode, 'fallback');
});

test('asset preview builder truncates brief previews without affecting row count', () => {
  const tempDir = createTempDir();
  try {
    const briefPath = path.join(tempDir, 'brief.txt');
    fs.writeFileSync(briefPath, 'Line one\nLine two\nLine three\n', 'utf8');

    const preview = buildAssetPreview(
      { type: 'brief', storedPath: briefPath },
      { rowCount: 3 },
      { maxCharacters: 12 },
      { normalizeWhitespace, truncateText }
    );

    assert.equal(preview.type, 'brief');
    assert.equal(preview.rowCount, 3);
    assert.equal(preview.text, 'Line one\nLin');
    assert.equal(preview.truncated, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
