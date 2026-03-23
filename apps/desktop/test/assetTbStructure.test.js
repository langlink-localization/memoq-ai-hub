const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEntriesFromTbStructure,
  buildManualTbStructure,
  deriveTbStructureFromRows,
  inferExplicitTbStructure,
  isValidTbStructure
} = require('../src/asset/assetTbStructure');

test('asset tb structure infers explicit bilingual headers', () => {
  const rows = [
    ['English_United_States', 'English_United_States_Def', 'Chinese_PRC', 'Chinese_PRC_Def', 'Entry_Subject'],
    ['save', 'button label', '保存', '按钮标签', 'UI']
  ];

  const structure = inferExplicitTbStructure(rows, { sha256: 'sha-explicit' });

  assert.equal(structure.kind, 'bilingual');
  assert.equal(structure.matchColumnName, 'English_United_States');
  assert.equal(structure.targetColumnName, 'Chinese_PRC');
  assert.deepEqual(structure.languagePair, { source: 'en-US', target: 'zh-CN' });
  assert.equal(structure.sourceOfTruth, 'header_inferred');
});

test('asset tb structure builds manual mapping when language pair is provided', () => {
  const rows = [
    ['Source', 'Target'],
    ['open', '打开']
  ];

  const structure = buildManualTbStructure(rows, {
    sha256: 'sha-manual',
    tbManualMapping: { srcColumn: 'Source', tgtColumn: 'Target' },
    tbLanguagePair: { source: 'en', target: 'zh' }
  });

  assert.equal(structure.matchColumnIndex, 0);
  assert.equal(structure.targetColumnIndex, 1);
  assert.deepEqual(structure.languagePair, { source: 'en', target: 'zh' });
  assert.equal(structure.sourceOfTruth, 'manual_mapping');
});

test('asset tb structure derives fallback match and target columns from schema-like headers', () => {
  const rows = [
    ['entry_id', 'source_term', 'target_term', 'entry_note'],
    ['1', 'save', '保存', 'UI']
  ];

  const structure = deriveTbStructureFromRows(rows, { sha256: 'sha-derived' });

  assert.equal(structure.kind, 'bilingual');
  assert.equal(structure.matchColumnName, 'source_term');
  assert.equal(structure.targetColumnName, 'target_term');
  assert.deepEqual(structure.noteColumnNames, ['entry_note']);
});

test('asset tb structure validates persisted structures and renders entries', () => {
  const structure = {
    derivedFromSha256: 'sha-persisted',
    matchColumnIndex: 0,
    targetColumnIndex: 1,
    languagePair: { source: 'en', target: 'zh' },
    noteColumnIndexes: [2],
    entryMetaColumns: [],
    sourceMetaColumns: [],
    targetMetaColumns: []
  };
  const rows = [
    ['Source', 'Target', 'Note'],
    ['save', '保存', 'UI label']
  ];

  assert.equal(isValidTbStructure(structure, { sha256: 'sha-persisted' }), true);

  const entries = buildEntriesFromTbStructure(rows, structure);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceTerm, 'save');
  assert.equal(entries[0].targetTerm, '保存');
  assert.equal(entries[0].note, 'UI label');
});
