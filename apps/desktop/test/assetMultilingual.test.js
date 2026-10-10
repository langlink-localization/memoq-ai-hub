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

test('automatic bilingual assets are concepts and preserve both translation directions', (t) => {
  const asset = fixture(t, 'en,ja\nFurnace,大熔炉\n', { tbDirectionMode: 'automatic' });
  const parsed = parseGlossaryAsset(asset);
  assert.equal(parsed.parseInfo.tbStructure.kind, 'multilingual');
  assert.deepEqual(matches(parsed, 'Furnace', 'en', 'ja'), ['大熔炉']);
  assert.deepEqual(matches(parsed, '大熔炉', 'ja', 'en'), ['Furnace']);
  const preview = buildAssetPreview(asset, parsed);
  assert.equal(preview.previewLayout, 'concepts');
  assert.equal(preview.rowCount, 1);
  assert.deepEqual(preview.rows, [{ language_0: 'Furnace', language_1: '大熔炉', note: '', details: [] }]);
});

test('automatic multi-language rules only match the chosen direction while plain rows remain reusable', (t) => {
  const asset = fixture(t, 'en,zh,ja,forbidden,allowedVariants\nFurnace,大熔炉,大炉,true,\nsave,保存,保存する,,\n', {
    tbDirectionMode: 'automatic', tbRuleLanguagePair: { source: 'zh', target: 'ja' }
  });
  const parsed = parseGlossaryAsset(asset);
  const rules = matchTbEntries({ matcher: parsed.matcher, text: '大熔炉3级', srcLang: 'zh', tgtLang: 'ja' });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].entry.forbidden, true);
  assert.equal(rules[0].entry.allowReverse, false);
  assert.deepEqual(matches(parsed, '大炉', 'ja', 'zh'), []);
  assert.deepEqual(matches(parsed, 'Furnace', 'en', 'ja'), []);
  for (const [source, text] of [['en', 'save'], ['zh', '保存'], ['ja', '保存する']]) {
    for (const [target, expected] of [['en', 'save'], ['zh', '保存'], ['ja', '保存する']]) {
      if (source !== target) assert.deepEqual(matches(parsed, text, source, target), [expected]);
    }
  }
});

test('unscoped directional rows fail closed and a validated save restores only their chosen direction', (t) => {
  const asset = fixture(t, 'en,zh,ja,allowedVariants\nFurnace,大熔炉,大熔炉,大熔炉Lv\n', { tbDirectionMode: 'automatic' });
  const parsed = parseGlossaryAsset(asset);
  assert.equal(parsed.parseInfo.ruleDirectionRequired, true);
  assert.equal(parsed.entries.length, 0);
  let saves = 0;
  const cache = new Map();
  const service = createRuntimeAssetTbService({ loadState: () => ({ assets: [asset] }), saveState: () => { saves++; }, parsedAssetCache: cache });
  const languageColumns = [{ columnIndex: 0, language: 'en' }, { columnIndex: 1, language: 'zh' }, { columnIndex: 2, language: 'ja' }];
  assert.throws(() => service.saveAssetTbConfig(asset.id, { languageColumns }), /Choose the original/);
  assert.equal(saves, 0);
  getParsedAsset(asset, cache);
  service.saveAssetTbConfig(asset.id, { languageColumns, ruleLanguagePair: { source: 'zh', target: 'ja' } });
  assert.equal(cache.size, 0);
  const reloaded = ensureAsset(JSON.parse(JSON.stringify(asset)));
  assert.equal(reloaded.tbDirectionMode, 'automatic');
  const updated = getParsedAsset(reloaded, cache);
  assert.deepEqual(updated.entries[0].allowedVariants, ['大熔炉Lv']);
  assert.deepEqual(matches(updated, '大熔炉', 'ja', 'zh'), []);
  assert.deepEqual(matches(updated, '大熔炉', 'zh', 'ja'), ['大熔炉']);
});

test('legacy rules retain their published reverse behavior until explicitly changed', (t) => {
  const legacy = fixture(t, 'sourceTerm,targetTerm,srcLang,tgtLang,forbidden,allowedVariants\nFurnace,大炉,en,ja,true,炉\n');
  assert.equal(ensureAsset(legacy).tbDirectionMode, 'legacy');
  const before = parseGlossaryAsset(legacy);
  assert.deepEqual(matches(before, '大炉', 'ja', 'en'), ['Furnace']);
  const after = parseGlossaryAsset({ ...legacy, tbDirectionMode: 'automatic' });
  assert.deepEqual(matches(after, '大炉', 'ja', 'en'), []);
  assert.deepEqual(matches(after, 'Furnace', 'en', 'ja'), ['大炉']);
  assert.deepEqual(after.entries[0].allowedVariants, ['炉']);
});

test('existing explicit mapping survives reload and requires opt-in for language-neutral preview', (t) => {
  const asset = fixture(t, 'en,ja\nFurnace,大熔炉\n');
  const initial = parseGlossaryAsset(asset);
  asset.tbStructure = initial.parseInfo.tbStructure;
  const cache = new Map();
  const legacy = getParsedAsset(asset, cache);
  const auto = getParsedAsset({ ...asset, tbDirectionMode: 'automatic' }, cache);
  assert.equal(legacy.parseInfo.tbStructure.kind, 'bilingual');
  assert.equal(auto.parseInfo.tbStructure.kind, 'bilingual'); // persisted mapping retains priority
  const service = createRuntimeAssetTbService({ loadState: () => ({ assets: [asset] }), saveState: () => {}, parsedAssetCache: cache });
  service.saveAssetTbConfig(asset.id, { directionMode: 'automatic', languageColumns: [{ columnIndex: 0, language: 'en' }, { columnIndex: 1, language: 'ja' }] });
  assert.equal(parseGlossaryAsset(ensureAsset(asset)).parseInfo.tbStructure.kind, 'multilingual');
});

test('empty and ineffective rule cells do not restrict ordinary multilingual concepts', (t) => {
  const asset = fixture(t, 'en,zh,ja,forbidden,caseSensitive,priority,matchMode,allowedVariants\nsave,保存,保存する,false,false,0,phrase,\n', { tbDirectionMode: 'automatic' });
  const parsed = parseGlossaryAsset(asset);
  assert.equal(parsed.parseInfo.ruleDirectionRequired, false);
  assert.equal(parsed.parseInfo.hasDirectionalRules, false);
  assert.equal(parsed.entries.length, 3);
  assert.deepEqual(matches(parsed, '保存する', 'ja', 'en'), ['save']);
  const service = createRuntimeAssetTbService({ loadState: () => ({ assets: [asset] }), saveState: () => {}, parsedAssetCache: new Map() });
  assert.doesNotThrow(() => service.saveAssetTbConfig(asset.id, { languageColumns: [{ columnIndex: 0, language: 'en' }, { columnIndex: 1, language: 'zh' }, { columnIndex: 2, language: 'ja' }] }));
});

test('directional rows with missing target cells do not produce empty translation rules', (t) => {
  const parsed = parseGlossaryAsset(fixture(t, 'en,ja,forbidden\nFurnace,,true\n', {
    tbDirectionMode: 'automatic', tbRuleLanguagePair: { source: 'en', target: 'ja' }
  }));
  assert.deepEqual(parsed.entries, []);
});

test('memoQ regional language headers can be auto-detected and saved unchanged', (t) => {
  const asset = fixture(t, 'Entry_ID,English_United_States,Portuguese_Brazil,Entry_Note\n1,Save,Salvar,UI command\n', { tbDirectionMode: 'automatic' });
  const preview = parseGlossaryAsset(asset).parseInfo;
  assert.deepEqual(preview.languageColumns.map((column) => column.language), ['en-US', 'pt-BR']);
  const service = createRuntimeAssetTbService({ loadState: () => ({ assets: [asset] }), saveState: () => {}, parsedAssetCache: new Map() });
  assert.doesNotThrow(() => service.saveAssetTbConfig(asset.id, {
    languageColumns: preview.languageColumns.map(({ columnIndex, language }) => ({ columnIndex, language }))
  }));
  assert.deepEqual(matches(parseGlossaryAsset(ensureAsset(asset)), 'Save', 'en-US', 'pt-BR'), ['Salvar']);
});

test('legacy detected Portuguese-Brazil mapping remains editable and saves as pt-BR', (t) => {
  const asset = fixture(t, 'English_United_States,Portuguese_Brazil\nSave,Salvar\n', {
    tbStructure: { kind: 'bilingual', derivedFromSha256: 'test', matchColumnIndex: 0, targetColumnIndex: 1, languagePair: { source: 'en-US', target: 'Portuguese-Brazil' } }, tbDirectionMode: 'automatic'
  });
  const parsed = parseGlossaryAsset(asset);
  const preview = parsed.parseInfo;
  assert.equal(parsed.entries[0].srcLang, 'en-US');
  assert.equal(parsed.entries[0].tgtLang, 'pt-BR');
  assert.equal(preview.languageColumns[1].language, 'pt-BR');
  const service = createRuntimeAssetTbService({ loadState: () => ({ assets: [asset] }), saveState: () => {}, parsedAssetCache: new Map() });
  service.saveAssetTbConfig(asset.id, { languageColumns: preview.languageColumns });
  assert.deepEqual(asset.tbLanguageColumns, [{ columnIndex: 0, language: 'en-US' }, { columnIndex: 1, language: 'pt-BR' }]);
});

test('regional exported names normalize without accepting arbitrary text as a language', () => {
  for (const [raw, expected] of [['Portuguese_Brazil', 'pt-BR'], ['Portuguese-Brazil', 'pt-BR'], ['Portuguese (Brazil)', 'pt-BR'], ['French_Canada', 'fr-CA'], ['Spanish_Mexico', 'es-MX']]) {
    assert.equal(resolveAssetLanguage(raw), expected, raw);
  }
  assert.equal(resolveAssetLanguage('Reviewer_Notes'), '');
});
