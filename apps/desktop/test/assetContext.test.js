const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const workbookStore = new Map();
const XLSX = {
  readFile(filePath) {
    return workbookStore.get(filePath) || { SheetNames: [], Sheets: {} };
  },
  writeFile(workbook, filePath) {
    workbookStore.set(filePath, workbook);
    fs.writeFileSync(filePath, 'mock-xlsx', 'utf8');
  },
  utils: {
    aoa_to_sheet(rows) {
      return { rows: Array.isArray(rows) ? rows : [] };
    },
    book_new() {
      return { SheetNames: [], Sheets: {} };
    },
    book_append_sheet(workbook, sheet, name) {
      workbook.SheetNames.push(name);
      workbook.Sheets[name] = sheet;
    },
    sheet_to_json(sheet) {
      return Array.isArray(sheet?.rows) ? sheet.rows : [];
    }
  }
};

class XMLParser {
  parse(xml) {
    const entryMatch = xml.match(/<termEntry[^>]*id="([^"]+)"[\s\S]*?<langSet[^>]*xml:lang="([^"]+)"[\s\S]*?<term>([^<]+)<\/term>[\s\S]*?<langSet[^>]*xml:lang="([^"]+)"[\s\S]*?<term>([^<]+)<\/term>/i);
    if (!entryMatch) {
      return { tbx: { text: { body: { termEntry: [] } } } };
    }
    return {
      tbx: {
        text: {
          body: {
            termEntry: {
              '@_id': entryMatch[1],
              langSet: [
                { '@_lang': entryMatch[2], tig: { term: entryMatch[3] } },
                { '@_lang': entryMatch[4], tig: { term: entryMatch[5] } }
              ]
            }
          }
        }
      }
    };
  }
}

const assetContextModulePath = require.resolve('../src/asset/assetContext');
const originalLoad = Module._load;
delete require.cache[assetContextModulePath];
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'xlsx') {
    return XLSX;
  }
  if (request === 'fast-xml-parser') {
    return { XMLParser };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  ASSET_PURPOSES,
  buildAssetContext,
  buildAssetPreview,
  getAssetImportRules,
  normalizeAssetBinding,
  validateAssetImport
} = require(assetContextModulePath);

Module._load = originalLoad;
delete require.cache[assetContextModulePath];

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-ai-hub-assets-'));
}

test('asset context exposes supported import rules', () => {
  const rules = getAssetImportRules();

  assert.deepEqual(rules.glossary.extensions, ['.csv', '.tsv', '.txt', '.xlsx', '.tbx']);
  assert.deepEqual(rules.brief.extensions, ['.txt', '.md']);
});

test('asset context normalizes glossary csv assets into deterministic text', () => {
  const tempDir = createTempDir();
  try {
    const glossaryPath = path.join(tempDir, 'glossary.csv');
    fs.writeFileSync(glossaryPath, 'hello,bonjour\nworld,monde\n', 'utf8');

    const context = buildAssetContext({
      assets: [{
        id: 'asset-1',
        type: ASSET_PURPOSES.glossary,
        name: 'glossary.csv',
        fileName: 'glossary.csv',
        storedPath: glossaryPath,
        sha256: 'hash-1'
      }],
      assetBindings: [{ assetId: 'asset-1', purpose: ASSET_PURPOSES.glossary }],
      profile: { useUploadedGlossary: true, useBrief: true },
      cache: new Map()
    });

    assert.equal(context.glossaryText, 'Required terminology:\n- "hello" => "bonjour"\n- "world" => "monde"');
    assert.equal(context.briefText, '');
    assert.deepEqual(context.assetHints, ['glossary:glossary.csv']);
    assert.equal(context.tb.entries.length, 2);
    assert.equal(context.tb.entries[0].sourceTerm, 'hello');
    assert.equal(context.tb.entries[0].targetTerm, 'bonjour');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset context normalizes glossary xlsx assets', () => {
  const tempDir = createTempDir();
  try {
    const glossaryPath = path.join(tempDir, 'glossary.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['source', 'target'],
      ['install', 'installer'],
      ['restart', 'redemarrer']
    ]), 'Glossary');
    XLSX.writeFile(workbook, glossaryPath);

    const context = buildAssetContext({
      assets: [{
        id: 'asset-1',
        type: ASSET_PURPOSES.glossary,
        name: 'glossary.xlsx',
        fileName: 'glossary.xlsx',
        storedPath: glossaryPath,
        sha256: 'hash-1'
      }],
      assetBindings: [{ assetId: 'asset-1', purpose: ASSET_PURPOSES.glossary }],
      profile: { useUploadedGlossary: true },
      cache: new Map()
    });

    assert.equal(context.tb.entries[0].sourceTerm, 'install');
    assert.equal(context.tb.entries[0].targetTerm, 'installer');
    assert.equal(context.tb.entries[1].sourceTerm, 'restart');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset context builds preview rows for custom tm assets', () => {
  const tempDir = createTempDir();
  try {
    const customTmPath = path.join(tempDir, 'custom-tm.csv');
    fs.writeFileSync(customTmPath, 'source,target\nSave,Enregistrer\nCancel,Annuler\n', 'utf8');

    const preview = buildAssetPreview({
      id: 'asset-1',
      type: ASSET_PURPOSES.customTm,
      name: 'custom-tm.csv',
      fileName: 'custom-tm.csv',
      storedPath: customTmPath,
      sha256: 'hash-1'
    }, new Map());

    assert.equal(preview.type, 'custom_tm');
    assert.equal(preview.rowCount, 2);
    assert.equal(preview.parsingMode, 'fallback');
    assert.equal(preview.smartParsingAvailable, false);
    assert.deepEqual(preview.columns, ['sourceTerm', 'targetTerm', 'srcLang', 'tgtLang']);
    assert.deepEqual(preview.rows[0], {
      sourceTerm: 'Save',
      targetTerm: 'Enregistrer',
      srcLang: '',
      tgtLang: ''
    });
    assert.equal(preview.truncated, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset context falls back to deterministic parsing when smart parsing is unavailable', () => {
  const tempDir = createTempDir();
  try {
    const glossaryPath = path.join(tempDir, 'fallback-glossary.csv');
    fs.writeFileSync(glossaryPath, 'source,target\nhello,bonjour\n', 'utf8');

    const preview = buildAssetPreview({
      id: 'asset-1',
      type: ASSET_PURPOSES.glossary,
      name: 'fallback-glossary.csv',
      fileName: 'fallback-glossary.csv',
      storedPath: glossaryPath,
      sha256: 'hash-1'
    }, new Map(), { smartParsingAvailable: false });

    assert.equal(preview.parsingMode, 'fallback');
    assert.equal(preview.smartParsingAvailable, false);
    assert.equal(preview.smartParsingRecommended, true);
    assert.match(preview.upgradeHint, /configure an ai provider and model/i);
    assert.equal(preview.rows[0].sourceTerm, 'hello');
    assert.equal(preview.rows[0].targetTerm, 'bonjour');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset context exposes smart mapping metadata for messy english-like headers when AI is available', () => {
  const tempDir = createTempDir();
  try {
    const glossaryPath = path.join(tempDir, 'smart-glossary.csv');
    fs.writeFileSync(
      glossaryPath,
      [
        'Entry_ID,Source Text,Target Text,Entry_Domain,Entry_ClientID,Forbidden,English_United_States',
        '0,Grand & 4X,Grand et 4X,Gaming,,false,hero',
        '1,power,puissance,Gaming,,false,marketing'
      ].join('\n'),
      'utf8'
    );

    const preview = buildAssetPreview({
      id: 'asset-1',
      type: ASSET_PURPOSES.glossary,
      name: 'smart-glossary.csv',
      fileName: 'smart-glossary.csv',
      storedPath: glossaryPath,
      sha256: 'hash-1'
    }, new Map(), { smartParsingAvailable: true });

    assert.equal(preview.parsingMode, 'smart');
    assert.equal(preview.smartParsingAvailable, true);
    assert.equal(preview.usedFallbackMapping, false);
    assert.equal(preview.detectedMapping.sourceTerm.columnName, 'Source Text');
    assert.equal(preview.detectedMapping.targetTerm.columnName, 'Target Text');
    assert.equal(preview.detectedMapping.domain.columnName, 'Entry_Domain');
    assert.equal(preview.detectedMapping.note.columnName, 'English_United_States');
    assert.equal(preview.rows[0].sourceTerm, 'Grand & 4X');
    assert.equal(preview.rows[0].targetTerm, 'Grand et 4X');
    assert.equal(preview.rows[0].note, 'hero');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset context exposes persisted tb structure metadata for ai-assisted table tb files', () => {
  const tempDir = createTempDir();
  try {
    const glossaryPath = path.join(tempDir, 'structured-glossary.csv');
    fs.writeFileSync(
      glossaryPath,
      [
        'Entry_ID,Entry_Subject,Chinese_PRC,Entry_Note',
        '0,Grand & 4X,大战略与4X,genre',
        '1,power,力量,ui'
      ].join('\n'),
      'utf8'
    );

    const preview = buildAssetPreview({
      id: 'asset-1',
      type: ASSET_PURPOSES.glossary,
      name: 'structured-glossary.csv',
      fileName: 'structured-glossary.csv',
      storedPath: glossaryPath,
      sha256: 'hash-structured-1'
    }, new Map(), { smartParsingAvailable: true });

    assert.equal(preview.tbStructuringMode, 'ai_structured');
    assert.equal(preview.tbStructureAvailable, true);
    assert.equal(typeof preview.tbStructureSummary, 'string');
    assert.match(preview.tbStructureSummary, /entry_subject/i);
    assert.equal(typeof preview.tbStructureFingerprint, 'string');
    assert.ok(preview.tbStructureFingerprint.length > 10);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset context infers bilingual tb structure and language pair from explicit language headers', () => {
  const tempDir = createTempDir();
  try {
    const glossaryPath = path.join(tempDir, 'bilingual-structured-glossary.csv');
    fs.writeFileSync(
      glossaryPath,
      [
        'Entry_ID,Entry_Subject,Entry_Domain,Entry_Note,English_United_States_Def,English_United_States,Term_Info,Term_Example,Chinese_PRC_Def,Chinese_PRC,Term_Info,Term_Example',
        '0,Grand & 4X,Gaming,,hero,hero,CasePermissive;HalfPrefix,,英雄,英雄,,',
        '1,Grand & 4X,Gaming,英雄的一种属性,,power,CasePermissive;HalfPrefix,,战力、战斗力,力量,,'
      ].join('\n'),
      'utf8'
    );

    const preview = buildAssetPreview({
      id: 'asset-structured-headers',
      type: ASSET_PURPOSES.glossary,
      name: 'bilingual-structured-glossary.csv',
      fileName: 'bilingual-structured-glossary.csv',
      storedPath: glossaryPath,
      sha256: 'hash-structured-explicit-1'
    }, new Map(), { smartParsingAvailable: true });

    assert.equal(preview.tbStructureAvailable, true);
    assert.equal(preview.tbStructuringMode, 'explicitly_inferred');
    assert.deepEqual(preview.languagePair, { source: 'en-US', target: 'zh-CN' });
    assert.equal(preview.manualMappingRequired, false);
    assert.match(preview.tbStructureSummary, /English_United_States/i);
    assert.match(preview.tbStructureSummary, /Chinese_PRC/i);
    assert.deepEqual(preview.mappingWarnings, []);
    assert.deepEqual(preview.tbStructureWarnings, []);
    assert.equal(preview.rows[0].sourceTerm, 'hero');
    assert.equal(preview.rows[0].targetTerm, '英雄');
    assert.equal(preview.rows[0].srcLang, 'en-US');
    assert.equal(preview.rows[0].tgtLang, 'zh-CN');
    assert.match(preview.rows[0].note, /Grand & 4X/);
    assert.match(preview.rows[1].note, /英雄的一种属性/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset context falls back from ambiguous smart mapping and reports warnings', () => {
  const tempDir = createTempDir();
  try {
    const glossaryPath = path.join(tempDir, 'ambiguous-glossary.csv');
    fs.writeFileSync(
      glossaryPath,
      [
        'Primary Text,Localized Text,Reviewer Notes',
        'Save,Enregistrer,UI action',
        'Cancel,Annuler,Dialog button'
      ].join('\n'),
      'utf8'
    );

    const preview = buildAssetPreview({
      id: 'asset-1',
      type: ASSET_PURPOSES.glossary,
      name: 'ambiguous-glossary.csv',
      fileName: 'ambiguous-glossary.csv',
      storedPath: glossaryPath,
      sha256: 'hash-1'
    }, new Map(), { smartParsingAvailable: true });

    assert.equal(preview.parsingMode, 'fallback');
    assert.equal(preview.smartParsingAvailable, true);
    assert.equal(preview.usedFallbackMapping, true);
    assert.ok(Array.isArray(preview.mappingWarnings));
    assert.match(preview.mappingWarnings.join('\n'), /low confidence|fallback/i);
    assert.equal(preview.rows[0].sourceTerm, 'Primary Text');
    assert.equal(preview.rows[0].targetTerm, 'Localized Text');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset context imports tbx assets into normalized terminology entries', () => {
  const tempDir = createTempDir();
  try {
    const glossaryPath = path.join(tempDir, 'glossary.tbx');
    fs.writeFileSync(glossaryPath, `<?xml version="1.0" encoding="UTF-8"?>
<tbx>
  <text>
    <body>
      <termEntry id="tb1">
        <langSet xml:lang="en">
          <tig>
            <term>workspace</term>
          </tig>
        </langSet>
        <langSet xml:lang="zh-CN">
          <tig>
            <term>工作区</term>
          </tig>
        </langSet>
      </termEntry>
    </body>
  </text>
</tbx>`, 'utf8');

    const context = buildAssetContext({
      assets: [{
        id: 'asset-1',
        type: ASSET_PURPOSES.glossary,
        name: 'glossary.tbx',
        fileName: 'glossary.tbx',
        storedPath: glossaryPath,
        sha256: 'hash-1'
      }],
      assetBindings: [{ assetId: 'asset-1', purpose: ASSET_PURPOSES.glossary }],
      profile: { useUploadedGlossary: true },
      cache: new Map()
    });

    assert.equal(context.tb.entries.length, 2);
    const enToZh = context.tb.entries.find((entry) => entry.srcLang === 'en' && entry.tgtLang === 'zh-CN');
    assert.ok(enToZh);
    assert.equal(enToZh.sourceTerm, 'workspace');
    assert.equal(enToZh.targetTerm, '工作区');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset context combines multiple brief assets in binding order', () => {
  const tempDir = createTempDir();
  try {
    const briefOne = path.join(tempDir, 'brief-one.txt');
    const briefTwo = path.join(tempDir, 'brief-two.md');
    fs.writeFileSync(briefOne, 'Use concise tone.\n', 'utf8');
    fs.writeFileSync(briefTwo, 'Prefer imperative voice.\n', 'utf8');

    const context = buildAssetContext({
      assets: [
        {
          id: 'brief-1',
          type: ASSET_PURPOSES.brief,
          name: 'brief-one.txt',
          fileName: 'brief-one.txt',
          storedPath: briefOne,
          sha256: 'hash-1'
        },
        {
          id: 'brief-2',
          type: ASSET_PURPOSES.brief,
          name: 'brief-two.md',
          fileName: 'brief-two.md',
          storedPath: briefTwo,
          sha256: 'hash-2'
        }
      ],
      assetBindings: [
        { assetId: 'brief-1', purpose: ASSET_PURPOSES.brief },
        { assetId: 'brief-2', purpose: ASSET_PURPOSES.brief }
      ],
      profile: { useBrief: true },
      cache: new Map()
    });

    assert.equal(context.briefText, 'Use concise tone.\n\n---\n\nPrefer imperative voice.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset context builds truncated text preview for brief assets', () => {
  const tempDir = createTempDir();
  try {
    const briefPath = path.join(tempDir, 'brief.txt');
    fs.writeFileSync(briefPath, 'Line one\nLine two\nLine three\n', 'utf8');

    const preview = buildAssetPreview({
      id: 'brief-1',
      type: ASSET_PURPOSES.brief,
      name: 'brief.txt',
      fileName: 'brief.txt',
      storedPath: briefPath,
      sha256: 'hash-1'
    }, new Map(), { maxRows: 2, maxCharacters: 12 });

    assert.equal(preview.type, 'brief');
    assert.equal(preview.rowCount, 3);
    assert.equal(preview.text, 'Line one\nLin');
    assert.equal(preview.truncated, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset context honors disabled glossary and brief toggles', () => {
  const tempDir = createTempDir();
  try {
    const glossaryPath = path.join(tempDir, 'glossary.txt');
    const briefPath = path.join(tempDir, 'brief.txt');
    fs.writeFileSync(glossaryPath, 'hello\tbonjour\n', 'utf8');
    fs.writeFileSync(briefPath, 'Be formal.\n', 'utf8');

    const context = buildAssetContext({
      assets: [
        {
          id: 'glossary-1',
          type: ASSET_PURPOSES.glossary,
          name: 'glossary.txt',
          fileName: 'glossary.txt',
          storedPath: glossaryPath,
          sha256: 'hash-1'
        },
        {
          id: 'brief-1',
          type: ASSET_PURPOSES.brief,
          name: 'brief.txt',
          fileName: 'brief.txt',
          storedPath: briefPath,
          sha256: 'hash-2'
        }
      ],
      assetBindings: [
        { assetId: 'glossary-1', purpose: ASSET_PURPOSES.glossary },
        { assetId: 'brief-1', purpose: ASSET_PURPOSES.brief }
      ],
      profile: { useUploadedGlossary: false, useBrief: false },
      cache: new Map()
    });

    assert.equal(context.glossaryText, '');
    assert.equal(context.briefText, '');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset context validates supported import extensions', () => {
  const normalized = validateAssetImport('glossary', 'D:\\tmp\\glossary.csv');
  assert.equal(normalized.type, 'glossary');
  assert.deepEqual(normalized.extension, '.csv');

  const tbx = validateAssetImport('glossary', 'D:\\tmp\\glossary.tbx');
  assert.equal(tbx.extension, '.tbx');

  assert.throws(
    () => validateAssetImport('brief', 'D:\\tmp\\brief.docx'),
    /unsupported brief file type/i
  );
});

test('asset context normalizes asset bindings defensively', () => {
  assert.deepEqual(
    normalizeAssetBinding({ assetId: 'a1', purpose: 'Custom TM' }),
    { assetId: 'a1', purpose: 'custom_tm' }
  );
  assert.equal(normalizeAssetBinding({ assetId: '' }), null);
});
