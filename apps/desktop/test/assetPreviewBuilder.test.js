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
        { sourceText: 'Save', targetText: 'Enregistrer', sourceLang: '', targetLang: '' }
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
  assert.deepEqual(preview.columns, ['sourceText', 'targetText', 'sourceLang', 'targetLang']);
  assert.equal(preview.rows[0].targetText, 'Enregistrer');
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


test('memoQ preview separates notes from repeated metadata without changing runtime entries', () => {
  const entry = { sourceTerm: 'PlayStation®5 console', targetTerm: 'console PlayStation®5',
    metadata: { entry: { Entry_ID: '10001', Entry_Subject: 'Action', Entry_Note: 'Keep <desc_id=1> | literal' },
      source: { Term_Info: 'CasePermissive;HalfPrefix' }, target: { Term_Info: 'CasePermissive;HalfPrefix' } } };
  entry.note = '10001 | Action | Keep <desc_id=1> | literal | CasePermissive;HalfPrefix | CasePermissive;HalfPrefix | Keep <desc_id=1> | literal';
  const original = JSON.stringify(entry);
  const row = buildAssetPreview({ type: 'glossary' }, { entries: [entry] }).rows[0];
  assert.equal(row.note, 'Keep <desc_id=1> | literal');
  assert.deepEqual(row.details.filter((item) => item.label === 'Term_Info').map((item) => item.group), ['source', 'target']);
  assert.equal(row.details.some((item) => item.label === 'Entry_Note'), false);
  assert.equal(JSON.stringify(entry), original);
  entry.metadata.entry.Entry_Note = '';
  entry.note = '10001 | Action | CasePermissive;HalfPrefix | CasePermissive;HalfPrefix';
  assert.equal(buildAssetPreview({ type: 'glossary' }, { entries: [entry] }).rows[0].note, '');
});

test('concept previews retain notes, duplicate header positions and non-language fields', () => {
  const parseInfo = { directionMode: 'automatic', conceptCount: 1,
    languageColumns: [{ columnIndex: 1, language: 'en' }, { columnIndex: 2, language: 'pt-BR' }],
    availableColumnDetails: ['Entry_ID', 'English', 'Portuguese_Brazil', 'Entry_Note', 'Term_Info', 'Term_Info'].map((columnName, columnIndex) => ({ columnIndex, columnName })),
    conceptRows: [['10001', 'console', 'console', 'Actual note', 'HalfPrefix', 'HalfPrefix']] };
  const preview = buildAssetPreview({ type: 'glossary' }, { entries: [], parseInfo });
  assert.equal(preview.rows[0].note, 'Actual note');
  assert.deepEqual(preview.rows[0].details.map((item) => item.label), ['1. Entry_ID', '5. Term_Info', '6. Term_Info']);
  assert.ok(preview.columns.includes('note'));
});

test('plain notes preserve delimiters and TM previews retain metadata and context', () => {
  const note = 'A | B\n<desc_id=123>';
  assert.equal(buildAssetPreview({ type: 'glossary' }, { entries: [{ note }] }).rows[0].note, note);
  const row = buildAssetPreview({ type: 'custom_tm' }, { entries: [{ sourceText: 'Save', targetText: 'Salvar',
    metadata: { tuid: '42', flag: false }, context: { previousSource: '<desc_id=123>', nextSource: '' } }] }).rows[0];
  assert.deepEqual(row.details, [
    { group: 'entry', label: 'tuid', value: '42' }, { group: 'entry', label: 'flag', value: 'false' },
    { group: 'context', label: 'previousSource', value: '<desc_id=123>' }
  ]);
});
