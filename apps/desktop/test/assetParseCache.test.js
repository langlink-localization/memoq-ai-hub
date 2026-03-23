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

const parseCacheModulePath = require.resolve('../src/asset/assetParseCache');
const originalLoad = Module._load;
delete require.cache[parseCacheModulePath];
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
  getParsedAsset,
  parseAsset
} = require(parseCacheModulePath);

Module._load = originalLoad;
delete require.cache[parseCacheModulePath];

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-ai-hub-asset-parse-cache-'));
}

function createBriefParser() {
  return (asset) => {
    const text = fs.readFileSync(asset.storedPath, 'utf8').trim();
    return {
      text,
      fingerprint: `brief:${text}`,
      rowCount: text ? text.split('\n').length : 0
    };
  };
}

test('asset parse cache routes glossary assets through glossary parser', () => {
  const tempDir = createTempDir();
  try {
    const glossaryPath = path.join(tempDir, 'glossary.csv');
    fs.writeFileSync(glossaryPath, 'source,target\nSave,Enregistrer\n', 'utf8');

    const parsed = parseAsset({
      id: 'asset-1',
      type: 'glossary',
      fileName: 'glossary.csv',
      storedPath: glossaryPath,
      sha256: 'hash-1'
    }, {}, { parseBriefAsset: createBriefParser() });

    assert.equal(parsed.entries[0].sourceTerm, 'Save');
    assert.equal(parsed.entries[0].targetTerm, 'Enregistrer');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset parse cache routes custom tm assets through custom tm parser', () => {
  const tempDir = createTempDir();
  try {
    const customTmPath = path.join(tempDir, 'custom-tm.csv');
    fs.writeFileSync(customTmPath, 'source,target\nSave,Enregistrer\n', 'utf8');

    const parsed = parseAsset({
      id: 'asset-1',
      type: 'custom_tm',
      fileName: 'custom-tm.csv',
      storedPath: customTmPath,
      sha256: 'hash-1'
    }, {}, { parseBriefAsset: createBriefParser() });

    assert.equal(parsed.entries[0].sourceTerm, 'Save');
    assert.equal(parsed.parseInfo.parsingMode, 'fallback');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset parse cache routes brief assets through injected brief parser', () => {
  const tempDir = createTempDir();
  try {
    const briefPath = path.join(tempDir, 'brief.txt');
    fs.writeFileSync(briefPath, 'Use concise tone.\n', 'utf8');

    const parsed = parseAsset({
      id: 'asset-1',
      type: 'brief',
      fileName: 'brief.txt',
      storedPath: briefPath,
      sha256: 'hash-1'
    }, {}, { parseBriefAsset: createBriefParser() });

    assert.equal(parsed.text, 'Use concise tone.');
    assert.equal(parsed.fingerprint, 'brief:Use concise tone.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset parse cache reuses cached result for identical parsing mode and key', () => {
  const tempDir = createTempDir();
  try {
    const briefPath = path.join(tempDir, 'brief.txt');
    fs.writeFileSync(briefPath, 'Use concise tone.\n', 'utf8');
    let calls = 0;
    const cache = new Map();
    const asset = {
      id: 'asset-1',
      type: 'brief',
      fileName: 'brief.txt',
      storedPath: briefPath,
      sha256: 'hash-1'
    };

    const first = getParsedAsset(asset, cache, {}, {
      parseBriefAsset(entry) {
        calls += 1;
        return createBriefParser()(entry);
      }
    });
    const second = getParsedAsset(asset, cache, {}, {
      parseBriefAsset(entry) {
        calls += 1;
        return createBriefParser()(entry);
      }
    });

    assert.equal(calls, 1);
    assert.equal(first, second);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('asset parse cache keeps smart and fallback parsing caches separate', () => {
  const tempDir = createTempDir();
  try {
    const briefPath = path.join(tempDir, 'brief.txt');
    fs.writeFileSync(briefPath, 'Use concise tone.\n', 'utf8');
    let calls = 0;
    const cache = new Map();
    const asset = {
      id: 'asset-1',
      type: 'brief',
      fileName: 'brief.txt',
      storedPath: briefPath,
      sha256: 'hash-1'
    };

    getParsedAsset(asset, cache, { smartParsingAvailable: false }, {
      parseBriefAsset(entry) {
        calls += 1;
        return createBriefParser()(entry);
      }
    });
    getParsedAsset(asset, cache, { smartParsingAvailable: true }, {
      parseBriefAsset(entry) {
        calls += 1;
        return createBriefParser()(entry);
      }
    });

    assert.equal(calls, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
