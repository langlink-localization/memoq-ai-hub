const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAssetContext,
  combineParsedEntries,
  getBoundAssetsByPurpose
} = require('../src/asset/assetContextAssembler');

test('asset context assembler keeps bound assets in binding order and purpose scope', () => {
  const entries = getBoundAssetsByPurpose(
    [
      { id: 'glossary-1', type: 'glossary', name: 'glossary.csv' },
      { id: 'brief-1', type: 'brief', name: 'brief.txt' },
      { id: 'tm-1', type: 'custom_tm', name: 'custom-tm.csv' }
    ],
    [
      { assetId: 'brief-1', purpose: 'brief' },
      { assetId: 'glossary-1', purpose: 'glossary' },
      { assetId: 'tm-1', purpose: 'glossary' }
    ]
  );

  assert.deepEqual(
    entries.map((entry) => `${entry.binding.purpose}:${entry.asset.name}`),
    ['brief:brief.txt', 'glossary:glossary.csv']
  );
});

test('asset context assembler combines parsed entry text with stable separators', () => {
  const combined = combineParsedEntries([
    { text: 'first block' },
    { text: '' },
    { text: 'second block' }
  ]);

  assert.equal(combined.text, 'first block\n\n---\n\nsecond block');
  assert.equal(typeof combined.fingerprint, 'string');
  assert.ok(combined.fingerprint.length > 10);
});

test('asset context assembler builds glossary, brief, and tb payloads without changing wire shape', () => {
  const parsedById = new Map([
    ['glossary-1', {
      text: 'Required terminology:\n- "hello" => "bonjour"',
      fingerprint: 'glossary-fingerprint',
      entries: [{ sourceTerm: 'hello', targetTerm: 'bonjour', srcLang: 'en', tgtLang: 'fr' }],
      parseInfo: {
        tbStructure: {
          fingerprint: 'tb-structure-fingerprint',
          summary: 'English -> French',
          sourceOfTruth: 'header_inferred',
          languagePair: { source: 'en', target: 'fr' }
        }
      }
    }],
    ['brief-1', {
      text: 'Use concise tone.',
      fingerprint: 'brief-fingerprint'
    }]
  ]);

  const context = buildAssetContext({
    assets: [
      { id: 'glossary-1', type: 'glossary', name: 'glossary.csv' },
      { id: 'brief-1', type: 'brief', name: 'brief.txt' }
    ],
    assetBindings: [
      { assetId: 'glossary-1', purpose: 'glossary' },
      { assetId: 'brief-1', purpose: 'brief' }
    ],
    profile: { useUploadedGlossary: true, useBrief: true },
    cache: new Map(),
    getParsedAsset(asset) {
      return parsedById.get(asset.id);
    }
  });

  assert.equal(context.glossaryText, 'Required terminology:\n- "hello" => "bonjour"');
  assert.equal(context.briefText, 'Use concise tone.');
  assert.equal(context.tbMetadataText, 'TB language pair: en -> fr');
  assert.equal(context.tb.structureAvailable, true);
  assert.equal(context.tb.structureFingerprint, 'tb-structure-fingerprint');
  assert.equal(context.tb.structuringMode, 'explicitly_inferred');
  assert.deepEqual(context.tb.languagePair, { source: 'en', target: 'fr' });
  assert.deepEqual(context.assetHints, ['glossary:glossary.csv', 'brief:brief.txt']);
});

test('asset context assembler honors disabled glossary and brief toggles', () => {
  const context = buildAssetContext({
    assets: [
      { id: 'glossary-1', type: 'glossary', name: 'glossary.csv' },
      { id: 'brief-1', type: 'brief', name: 'brief.txt' }
    ],
    assetBindings: [
      { assetId: 'glossary-1', purpose: 'glossary' },
      { assetId: 'brief-1', purpose: 'brief' }
    ],
    profile: { useUploadedGlossary: false, useBrief: false },
    cache: new Map(),
    getParsedAsset(asset) {
      return asset.id === 'glossary-1'
        ? {
          text: 'Required terminology:\n- "hello" => "bonjour"',
          fingerprint: 'glossary-fingerprint',
          entries: [],
          parseInfo: {}
        }
        : {
          text: 'Use concise tone.',
          fingerprint: 'brief-fingerprint'
        };
    }
  });

  assert.equal(context.glossaryText, '');
  assert.equal(context.briefText, '');
});
