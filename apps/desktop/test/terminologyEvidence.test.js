const test = require('node:test');
const assert = require('node:assert/strict');
const { createTbMatcher, matchTbEntries } = require('../src/asset/assetTerminology');
const { buildAssetContext } = require('../src/asset/assetContextAssembler');

test('phrase boundaries follow term edges across CJK, levels and identifiers', () => {
  for (const matchMode of ['phrase', 'normalized']) {
    for (const [term, text, expected] of [
      ['大熔炉', '大熔炉3级解锁交易', 1],
      ['大型炉', '大型炉Lv8解放', 1],
      ['大熔炉', '在大熔炉3级即可解锁交易', 1],
      ['大熔炉', '大熔炉 3级解锁交易', 1],
      ['cat', '猫cat2', 0],
      ['cat', 'cat_name', 0],
      ['cat', 'cat,', 1],
      ['VIP礼包', 'SVIP礼包', 0],
      ['土松犬1', '土松犬12', 0]
    ]) {
      const matcher = createTbMatcher([{ sourceTerm: term, targetTerm: 'target', srcLang: 'zh', tgtLang: 'ja', matchMode }]);
      assert.equal(matchTbEntries({ matcher, text, srcLang: 'zh', tgtLang: 'ja' }).length, expected, `${matchMode}: ${text}`);
    }
  }
  const matcher = createTbMatcher([{ sourceTerm: '大熔炉', targetTerm: '大型炉', srcLang: 'zh', tgtLang: 'ja' }]);
  assert.equal(matchTbEntries({ matcher, text: '大型炉Lv8解放', srcLang: 'ja', tgtLang: 'zh' })[0].targetTerm, '大熔炉');
});

test('disabled glossary has no terminology matcher entries', () => {
  const input = { assets: [{ id: 'tb', type: 'glossary', name: 'Terms' }], assetBindings: [{ assetId: 'tb', purpose: 'glossary' }], getParsedAsset: () => ({ text: '大熔炉 => 大型炉', entries: [{ sourceTerm: '大熔炉', targetTerm: '大型炉', srcLang: 'zh', tgtLang: 'ja' }] }) };
  assert.equal(buildAssetContext(input).tb.entries.length, 1);
  const context = buildAssetContext({ ...input, profile: { useUploadedGlossary: false } });
  assert.deepEqual(context.tb.entries, []);
  assert.deepEqual(matchTbEntries({ matcher: context.tb.matcher, text: '大熔炉3级', srcLang: 'zh', tgtLang: 'ja' }), []);
});

const { buildTranslationEvidence } = require('../src/runtime/translationEvidence');
test('evidence separates no match, wrong language, failure and cached provenance', () => {
  const profile = { id: 'p', name: 'Profile', terminologyMode: 'strict' };
  const assetContext = { assetSnapshots: [{ id: 'tb', name: 'Terms', purpose: 'glossary', fingerprint: 'v1', languagePairs: ['zh|ja'] }] };
  const segment = { index: 0, tbContext: { sourceLanguage: 'zh', targetLanguage: 'ja', termHits: [] }, qaSummary: { ok: true } };
  assert.equal(buildTranslationEvidence({ profile, assetContext, segment, hasResult: true }).terminologyStatus, 'no_match');
  assert.equal(buildTranslationEvidence({ profile, assetContext, segment: { ...segment, tbContext: { sourceLanguage: 'en', targetLanguage: 'fr' } } }).terminologyStatus, 'language_mismatch');
  const cached = buildTranslationEvidence({ profile, assetContext, segment, hasResult: true, attempts: [{ success: true, providerId: 'cache', cacheKind: 'exact', segmentIndexes: [0] }] });
  assert.equal(cached.resultSource, 'cache');
  assert.equal(cached.provider, null);
  assert.equal(cached.assets[0].sentToModel, false);
  assert.equal(cached.originalGeneration, 'not_recorded');
  const failed = buildTranslationEvidence({ profile, assetContext, segment, attempts: [{ success: false, providerId: 'p', segmentIndexes: [0], requestMetadata: {} }] });
  assert.equal(failed.modelAttempted, true);
  assert.equal(failed.resultSource, 'none');
  assert.equal(buildTranslationEvidence({ profile, assetContext: { ...assetContext, assetError: 'Read failed' }, segment }).terminologyStatus, 'asset_error');
});

test('disabled assets never parse files or leak terminology metadata', () => {
  const context = buildAssetContext({ assets: [{ id: 'tb', type: 'glossary', name: 'Terms' }], assetBindings: [{ assetId: 'tb', purpose: 'glossary' }], profile: { useUploadedGlossary: false }, getParsedAsset: () => { throw new Error('Must not parse disabled asset'); } });
  assert.equal(context.tbMetadataText || '', '');
  assert.equal(context.tb.structureAvailable, false);
  assert.equal(context.tb.entries.length, 0);
});

test('disabled and unmatched segment prompts contain no terminology metadata', () => {
  const { buildSegmentTbContext } = require('../src/runtime/runtimePromptSupport');
  const assetContext = buildAssetContext({ profile: { useUploadedGlossary: false }, getParsedAsset: () => ({}) });
  const context = buildSegmentTbContext({ assetContext, segment: { plainText: 'Text' }, payload: { sourceLanguage: 'en', targetLanguage: 'fr' }, metadata: {} });
  assert.equal(context.glossaryText, '');
  assert.equal(context.tbMetadataText, '');
});

test('fresh retranslation blocks duplicate work and preserves original segment metadata', async () => {
  const { createRuntimeTranslationTools } = require('../src/runtime/runtimeTranslationTools');
  let release;
  let payload;
  const original = { id: 'h', profileId: 'p', sourceLanguage: 'zh', targetLanguage: 'ja', requestType: 'BothFormattingAndTags', metadata: { documentId: 'doc' }, segments: [{ segmentIndex: 7, segmentId: 'source-id', segmentStatus: 2, sourceText: '<b>大熔炉</b>', plainText: '大熔炉', targetText: 'old', tmDiagnostics: { tmHintsRequested: true } }] };
  const tools = createRuntimeTranslationTools({ loadState: () => ({ profiles: [{ id: 'p' }] }), loadHistoryEntry: () => original, loadHistoryEntries: () => [], createId: (prefix) => prefix, hasSmartTbParsingCapability: () => false,
    performTranslation: (value) => { payload = value; return new Promise((resolve) => { release = resolve; }); }
  });
  const first = tools.retranslateHistory({ historyId: 'h', segmentIndex: 7 });
  await assert.rejects(tools.retranslateHistory({ historyId: 'h', segmentIndex: 7 }), /already running/);
  assert.equal(payload.bypassTranslationCache, true);
  assert.equal(payload.requestType, 'BothFormattingAndTags');
  assert.equal(payload.parentSegmentIndex, 7);
  assert.equal(payload.segments[0].text, '<b>大熔炉</b>');
  assert.deepEqual(payload.metadata.segmentLevelMetadata, [{ segmentId: 'source-id', segmentStatus: 2, segmentIndex: 0 }]);
  assert.deepEqual(payload.segments[0].tmDiagnostics, { tmHintsRequested: true });
  release({ statusCode: 200, body: { translations: [{ index: 0, text: 'new' }] } });
  assert.equal((await first).translatedText, 'new');
  assert.equal(original.segments[0].targetText, 'old');
});

test('evidence respects forward-only rules and distinguishes missing configuration from no match', () => {
  const profile = { id: 'p' };
  const segment = { index: 0, tbContext: { sourceLanguage: 'ja', targetLanguage: 'zh', termHits: [] } };
  const snapshot = { id: 'tb', purpose: 'glossary', languagePairs: ['zh|ja'], languageDirections: ['zh|ja'] };
  const evidence = (asset) => buildTranslationEvidence({ profile, segment, assetContext: { assetSnapshots: [asset] } });
  assert.equal(evidence(snapshot).terminologyStatus, 'language_mismatch');
  assert.equal(evidence({ ...snapshot, languageDirections: ['zh|ja', 'ja|zh'] }).terminologyStatus, 'no_match');
  const pending = evidence({ ...snapshot, ruleDirectionRequired: true, languageDirections: [], languagePairs: [] });
  assert.equal(pending.terminologyStatus, 'configuration_required');
  assert.equal(pending.assets[0].ruleDirectionRequired, true);
});

test('term evidence records the requested direction and identifies forward-only rules', () => {
  const { buildSegmentTbContext } = require('../src/runtime/runtimePromptSupport');
  const entries = [{ sourceTerm: 'Furnace', targetTerm: '大熔炉', srcLang: 'en', tgtLang: 'ja', assetId: 'tb' }];
  const assetContext = { tb: { matcher: createTbMatcher(entries) } };
  const reversed = buildSegmentTbContext({ assetContext, segment: { plainText: '大熔炉' }, payload: { sourceLanguage: 'ja', targetLanguage: 'en' }, metadata: {} });
  assert.equal(reversed.termHits[0].sourceLanguage, 'ja');
  assert.equal(reversed.termHits[0].targetLanguage, 'en');
  assert.equal(reversed.termHits[0].direction, 'reverse');
  const forwardOnly = { tb: { matcher: createTbMatcher([{ ...entries[0], forbidden: true, allowReverse: false }]) } };
  const forward = buildSegmentTbContext({ assetContext: forwardOnly, segment: { plainText: 'Furnace' }, payload: { sourceLanguage: 'en', targetLanguage: 'ja' }, metadata: {} });
  assert.equal(forward.termHits[0].directionalRule, true);
});
