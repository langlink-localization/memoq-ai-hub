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

const parserModulePath = require.resolve('../src/asset/assetGlossaryParser');
const originalLoad = Module._load;
delete require.cache[parserModulePath];
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
  parseGlossaryAsset,
  parseCustomTmAsset
} = require(parserModulePath);

Module._load = originalLoad;
delete require.cache[parserModulePath];

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-ai-hub-asset-parser-'));
}

test('asset glossary parser exposes smart mapping metadata for messy headers', () => {
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

    const parsed = parseGlossaryAsset({
      id: 'asset-1',
      type: 'glossary',
      name: 'smart-glossary.csv',
      fileName: 'smart-glossary.csv',
      storedPath: glossaryPath,
      sha256: 'hash-1'
    }, { smartParsingAvailable: true });

    assert.equal(parsed.parseInfo.parsingMode, 'smart');
    assert.equal(parsed.parseInfo.smartParsingAvailable, true);
    assert.equal(parsed.parseInfo.detectedMapping.sourceTerm.columnName, 'Source Text');
    assert.equal(parsed.entries[0].sourceTerm, 'Grand & 4X');
    assert.equal(parsed.entries[0].targetTerm, 'Grand et 4X');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset glossary parser preserves inferred tb structure metadata for explicit bilingual headers', () => {
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

    const parsed = parseGlossaryAsset({
      id: 'asset-structured-headers',
      type: 'glossary',
      name: 'bilingual-structured-glossary.csv',
      fileName: 'bilingual-structured-glossary.csv',
      storedPath: glossaryPath,
      sha256: 'hash-structured-explicit-1'
    }, { smartParsingAvailable: true });

    assert.equal(parsed.parseInfo.tbStructureAvailable, true);
    assert.equal(parsed.parseInfo.tbStructuringMode, 'explicitly_inferred');
    assert.deepEqual(parsed.parseInfo.languagePair, { source: 'en-US', target: 'zh-CN' });
    assert.equal(parsed.entries[0].sourceTerm, 'hero');
    assert.equal(parsed.entries[0].targetTerm, '英雄');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset glossary parser parses custom tm csv assets into normalized entries', () => {
  const tempDir = createTempDir();
  try {
    const customTmPath = path.join(tempDir, 'custom-tm.csv');
    fs.writeFileSync(customTmPath, 'source,target\nSave,Enregistrer\nCancel,Annuler\n', 'utf8');

    const parsed = parseCustomTmAsset({
      id: 'asset-1',
      type: 'custom_tm',
      name: 'custom-tm.csv',
      fileName: 'custom-tm.csv',
      storedPath: customTmPath,
      sha256: 'hash-1'
    });

    assert.equal(parsed.rowCount, 2);
    assert.equal(parsed.parseInfo.parsingMode, 'fallback');
    assert.equal(parsed.entries[0].sourceTerm, 'Save');
    assert.equal(parsed.entries[0].targetTerm, 'Enregistrer');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
