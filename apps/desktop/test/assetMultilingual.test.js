const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');
const { parseGlossaryAsset } = require('../src/asset/assetGlossaryParser');
const { buildMultilingualTbStructure, buildEntriesFromTbStructure } = require('../src/asset/assetTbStructure');
const { matchTbEntries } = require('../src/asset/assetTerminology');
const { createRuntimeAssetTbService } = require('../src/runtime/runtimeAssetTbService');
const { ensureAsset } = require('../src/runtime/runtimeState');
const { buildAssetPreview } = require('../src/asset/assetPreviewBuilder');
const { getParsedAsset } = require('../src/asset/assetParseCache');
const { resolveAssetLanguage } = require('../src/shared/languageNormalization');

function fixture(t, text, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-multilingual-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storedPath = path.join(dir, 'terms.csv');
  fs.writeFileSync(storedPath, text);
  return { id: 'terms', type: 'glossary', name: 'terms.csv', fileName: 'terms.csv', storedPath, sha256: 'test', ...extra };
}

function matches(parsed, text, srcLang, tgtLang) {
  return matchTbEntries({ matcher: parsed.matcher, text, srcLang, tgtLang }).map((hit) => hit.targetTerm);
}

test('one three-language table serves all six translation directions without AI', (t) => {
  const asset = fixture(t, 'English,简体中文,日本語\nsave,保存,保存する\n');
  const parsed = parseGlossaryAsset(asset);
  assert.equal(parsed.parseInfo.tbStructure.kind, 'multilingual');
  assert.equal(parsed.entries.length, 3);
  const terms = [['en', 'save'], ['zh-Hans', '保存'], ['ja', '保存する']];
  for (const [srcLang, source] of terms) {
    for (const [tgtLang, target] of terms) {
      if (srcLang !== tgtLang) assert.deepEqual(matches(parsed, source, srcLang, tgtLang), [target]);
    }
  }
});

test('specific regional and script columns cannot leak through base-language buckets', (t) => {
  const parsed = parseGlossaryAsset(fixture(t, 'en-US,en-GB,zh-CN,zh-TW\ncolor,colour,颜色,顏色\n'));
  assert.deepEqual(matches(parsed, 'color', 'en-US', 'zh-TW'), ['顏色']);
  assert.deepEqual(matches(parsed, 'colour', 'en-GB', 'zh-CN'), ['颜色']);
  assert.deepEqual(matches(parsed, 'color', 'en-GB', 'zh-CN'), []);
  assert.deepEqual(matches(parsed, 'color', 'en-US', 'zh-Hant'), ['顏色']);
});

test('sparse and quoted cells preserve values and do not invent missing pairs', (t) => {
  const parsed = parseGlossaryAsset(fixture(t, 'en,zh,ja\n"Save, now",保存,\n"line\nbreak",,改行\n'));
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].sourceTerm, 'Save, now');
  assert.equal(parsed.entries[1].sourceTerm, 'line\nbreak');
  assert.deepEqual(matches(parsed, '保存', 'zh', 'ja'), []);
});

test('later language pairs and source rows are not silently cut at 1000 generated entries', (t) => {
  const text = 'en,zh,ja\n' + Array.from({ length: 1100 }, (_, i) => `term${i},术语${i},用語${i}`).join('\n');
  const asset = fixture(t, text);
  const parsed = parseGlossaryAsset(asset);
  assert.equal(parsed.entries.length, 3300);
  assert.deepEqual(matches(parsed, '术语1099', 'zh', 'ja'), ['用語1099']);
  const preview = buildAssetPreview(asset, parsed, { maxRows: 3 });
  assert.deepEqual(preview.rows.map((row) => `${row.srcLang}:${row.tgtLang}`), ['en:zh', 'en:ja', 'zh:ja']);
  assert.equal(preview.truncated, true);
});

test('manual language columns persist across state normalization and invalidate cached parses', (t) => {
  const asset = fixture(t, 'A,B,C\nsave,保存,保存する\n');
  let state = { assets: [asset] };
  let saves = 0;
  const cache = new Map();
  const service = createRuntimeAssetTbService({ loadState: () => state, saveState: (next) => {
    saves += 1; state = JSON.parse(JSON.stringify(next));
  }, parsedAssetCache: cache });
  const languageColumns = [{ columnIndex: 0, language: 'English' }, { columnIndex: 1, language: '简体中文' }, { columnIndex: 2, language: 'ja' }];
  service.saveAssetTbConfig(asset.id, { languageColumns });
  const reloaded = ensureAsset(state.assets[0]);
  assert.equal(saves, 1);
  assert.deepEqual(reloaded.tbLanguageColumns.map((column) => column.language), ['en', 'zh-Hans', 'ja']);
  assert.deepEqual(matches(getParsedAsset(reloaded, cache), 'save', 'en', 'ja'), ['保存する']);
  const changed = { ...reloaded, tbLanguageColumns: reloaded.tbLanguageColumns.slice(0, 2) };
  assert.equal(getParsedAsset(changed, cache).entries.length, 1);
  assert.equal(getParsedAsset(reloaded, cache).entries.length, 3);
});

test('invalid mappings reject without saving, including duplicate languages and unknown columns', (t) => {
  const asset = fixture(t, 'A,B,C\na,b,c\n');
  let saves = 0;
  const service = createRuntimeAssetTbService({ loadState: () => ({ assets: [asset] }), saveState: () => { saves += 1; }, parsedAssetCache: new Map() });
  for (const languageColumns of [
    [], [{ columnIndex: 0, language: 'en' }],
    [{ columnIndex: 0, language: 'en' }, { columnIndex: 1, language: 'English' }],
    [{ columnIndex: 0, language: 'en' }, { columnIndex: 0, language: 'zh' }],
    [{ columnIndex: 0, language: 'en' }, { columnIndex: 8, language: 'zh' }],
    [{ columnIndex: 0, language: 'not a language' }, { columnIndex: 1, language: 'zh' }]
  ]) assert.throws(() => service.saveAssetTbConfig(asset.id, { languageColumns }));
  assert.equal(saves, 0);
});

test('duplicate header labels are addressable by index and notes are preserved', (t) => {
  const parsed = parseGlossaryAsset(fixture(t, 'Text,Text,Note\nsave,保存,UI action\n', {
    tbLanguageColumns: [{ columnIndex: 0, language: 'en' }, { columnIndex: 1, language: 'zh' }]
  }));
  assert.equal(parsed.entries[0].targetTerm, '保存');
  assert.equal(parsed.entries[0].note, 'UI action');
});

test('empty configured language pairs never fall back to unrelated columns', (t) => {
  const parsed = parseGlossaryAsset(fixture(t, 'id,note,en,ja,zh\n1,comment,save,,\n'));
  assert.equal(parsed.entries.length, 0);
});

test('workbook sheets with matching headers merge without treating headers as terms', (t) => {
  const asset = fixture(t, '', { fileName: 'terms.xlsx' });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['en', 'zh', 'ja'], ['save', '保存', '保存する']]), 'One');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['en', 'zh', 'ja'], ['open', '打开', '開く']]), 'Two');
  XLSX.writeFile(workbook, asset.storedPath, { bookType: 'xlsx' });
  assert.equal(parseGlossaryAsset(asset).entries.length, 6);
  workbook.Sheets.Two = XLSX.utils.aoa_to_sheet([['ja', 'en', 'zh'], ['開く', 'open', '打开']]);
  XLSX.writeFile(workbook, asset.storedPath, { bookType: 'xlsx' });
  assert.throws(() => parseGlossaryAsset(asset), /different columns/);
});

test('expansion capacity fails explicitly instead of retaining only early pairs', () => {
  const rows = [['en', 'zh', 'ja'], ...Array.from({ length: 16667 }, () => ['a', '甲', 'あ'])];
  const structure = buildMultilingualTbStructure(rows, {}, [{ columnIndex: 0, language: 'en' }, { columnIndex: 1, language: 'zh' }, { columnIndex: 2, language: 'ja' }]);
  assert.throws(() => buildEntriesFromTbStructure(rows, structure), /50,000/);
});

test('language names and memoQ aliases normalize while arbitrary headers are rejected', () => {
  for (const [input, expected] of [['英文', 'en'], ['English_United_States', 'en-US'], ['Chinese_PRC', 'zh-CN'], ['日本語', 'ja'], ['jpn', 'ja'], ['备注', ''], ['Entry_ID', ''], ['xyz', '']]) {
    assert.equal(resolveAssetLanguage(input), expected, input);
  }
});


test('legacy headerless bilingual rows retain terminology flags instead of becoming language columns', (t) => {
  const asset = fixture(t, 'workspace,工作区,EN,ZH,,,,whole_word,10,false,,UI term\nworkspace,工作空间,EN,ZH,,,,whole_word,1,true,,Forbidden\n');
  const parsed = parseGlossaryAsset(asset);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[1].forbidden, true);
  assert.equal(parsed.entries[0].sourceTerm, 'workspace');
});


test('ambiguous repeated language headers leave the file available for manual configuration', (t) => {
  const parsed = parseGlossaryAsset(fixture(t, 'en,English,ja\nsave,save,保存する\n'));
  assert.equal(parsed.parseInfo.availableColumnDetails.length, 3);
  assert.deepEqual(parsed.parseInfo.languageColumns, []);
});


test('headerless configuration preserves the first row across save, reload, and cache changes', (t) => {
  const asset = fixture(t, 'save,保存,保存する\nopen,打开,開く\n');
  let state = { assets: [asset] };
  const cache = new Map();
  const service = createRuntimeAssetTbService({ loadState: () => state, saveState: (next) => { state = JSON.parse(JSON.stringify(next)); }, parsedAssetCache: cache });
  const languageColumns = [{ columnIndex: 0, language: 'en' }, { columnIndex: 1, language: 'zh' }, { columnIndex: 2, language: 'ja' }];
  service.saveAssetTbConfig(asset.id, { hasHeader: false, languageColumns });
  const restored = ensureAsset(state.assets[0]);
  assert.equal(restored.tbHasHeader, false);
  const parsed = getParsedAsset(restored, cache);
  assert.equal(parsed.entries.length, 6);
  assert.deepEqual(matches(parsed, 'save', 'en', 'ja'), ['保存する']);
  assert.equal(parsed.parseInfo.hasHeader, false);
  assert.equal(parsed.parseInfo.rawColumnDetails[0].columnName, 'save');
  assert.deepEqual(parsed.parseInfo.availableColumnDetails[0].samples, ['save', 'open']);
  const withHeader = getParsedAsset({ ...restored, tbHasHeader: true }, cache);
  assert.equal(withHeader.entries.length, 3);
  assert.deepEqual(matches(withHeader, 'save', 'en', 'ja'), []);
});

test('one-row headerless glossary retains its only record', (t) => {
  const parsed = parseGlossaryAsset(fixture(t, 'save,保存,保存する', {
    tbHasHeader: false,
    tbLanguageColumns: [{ columnIndex: 0, language: 'en' }, { columnIndex: 1, language: 'zh' }, { columnIndex: 2, language: 'ja' }]
  }));
  assert.equal(parsed.entries.length, 3);
  assert.deepEqual(matches(parsed, '保存する', 'ja', 'en'), ['save']);
});

test('headerless workbook retains first records on every worksheet', (t) => {
  const asset = fixture(t, '', { fileName: 'terms.xlsx', tbHasHeader: false,
    tbLanguageColumns: [{ columnIndex: 0, language: 'en' }, { columnIndex: 1, language: 'ja' }] });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['save', '保存する']]), 'One');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['open', '開く']]), 'Two');
  XLSX.writeFile(workbook, asset.storedPath, { bookType: 'xlsx' });
  const parsed = parseGlossaryAsset(asset);
  assert.equal(parsed.entries.length, 2);
  assert.deepEqual(matches(parsed, 'save', 'en', 'ja'), ['保存する']);
  assert.deepEqual(matches(parsed, 'open', 'en', 'ja'), ['開く']);
});

test('CSV tabs inside a quoted term do not change the delimiter', (t) => {
  const parsed = parseGlossaryAsset(fixture(t, 'en,zh,ja\n"save\tnow",保存,保存する'));
  assert.equal(parsed.entries.length, 3);
  assert.equal(parsed.entries[0].sourceTerm, 'save\tnow');
});
