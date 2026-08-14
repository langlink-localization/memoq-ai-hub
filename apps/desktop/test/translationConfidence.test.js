const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateStructuralValidity,
  calculateTranslationConfidence,
  createTranslationInfo,
  enrichTranslationResult
} = require('../src/runtime/translationConfidence');

test('translation confidence requires structure and an independent signal', () => {
  assert.deepEqual(calculateTranslationConfidence({ structuralValidity: 1 }), {
    confidence: 0,
    signals: {
      structuralValidity: 1,
      terminologyCompliance: null,
      tmSupport: null,
      providerScore: null,
      repairApplied: false,
      fallbackApplied: false
    }
  });
});

test('translation confidence applies normalized weights and fixed penalties', () => {
  const result = calculateTranslationConfidence({
    structuralValidity: 1,
    terminologyCompliance: 0.5,
    tmSupport: 0.8,
    providerScore: 0.9,
    providerScoreComparable: true,
    repairApplied: true,
    fallbackApplied: true
  });
  assert.equal(result.confidence, 0.455);
});

test('structural validity compares tags and placeholders independent of order', () => {
  assert.equal(calculateStructuralValidity('Hello {0} <b>', '<b> Bonjour {0}'), 1);
  assert.equal(calculateStructuralValidity('Hello {0}', 'Bonjour'), 0);
});

test('translation info is deterministic and bounded', () => {
  const info = createTranslationInfo({
    signals: { structuralValidity: 1, terminologyCompliance: 1, tmSupport: 0.91 },
    terminologyMatchCount: 2
  });
  assert.equal(info, 'Terminology 2/2; structure valid; TM 91%');
  assert.ok(info.length <= 120);
});

test('translation info localizes deterministic labels for Chinese target content', () => {
  assert.match(createTranslationInfo({ signals: { structuralValidity: 1, fallbackApplied: true }, locale: 'zh-CN' }), /结构有效.*已使用回退/);
});

test('translation enrichment exposes optional confidence fields without source text', () => {
  const result = enrichTranslationResult({
    segment: {
      sourceText: 'Restart {0}',
      qaSummary: { ok: true, issues: [] },
      tbContext: { matches: [{ entry: { targetTerm: 'redemarrer' } }] },
      customTmMatches: [{ score: 95 }]
    },
    translation: { index: 3, text: 'Redemarrer {0}' }
  });
  assert.equal(result.index, 3);
  assert.equal(result.confidence, 0.9844);
  assert.equal(result.confidenceSignals.tmSupport, 0.95);
  assert.equal(Object.hasOwn(result, 'sourceText'), false);
});
