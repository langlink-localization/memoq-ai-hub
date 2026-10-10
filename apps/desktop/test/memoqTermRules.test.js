const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMemoqTermRules, containsMemoqTerm } = require('../src/asset/memoqTermRules');
const { createTbMatcher, matchTbEntries, evaluateTerminologyQa, createTbFingerprint } = require('../src/asset/assetTerminology');
const rule = (raw) => parseMemoqTermRules({ Term_Info: raw });
const entry = (source, target) => ({ id: 'r', sourceTerm: 'review', targetTerm: 'teste', srcLang: 'en', tgtLang: 'pt', sourceRules: rule(source), targetRules: rule(target) });
for (const [raw, term, text, expected] of [
  ['CaseSense;NoPrefix', 'memoQ', 'memoQ', true],
  ['CaseSense;NoPrefix', 'memoQ', 'MemoQ', false],
  ['CasePermissive;NoPrefix', 'memoQ', 'MEMOQ', true],
  ['CasePermissive;NoPrefix', 'memoQ', 'memoq', false],
  ['CaseInsense;NoPrefix', 'memoQ', 'memoq', true],
  ['CaseInsense;NoPrefix', 'review', 'reviews', false],
  ['CaseInsense;HalfPrefix', 'review', 'reviewing', true],
  ['CaseInsense;HalfPrefix', 'review', 'reviewability', false],
  ['CaseInsense;HalfPrefix', 'review', 'preview', false],
  ['CaseInsense;HalfPrefix', 'project', 'project-specific', false],
  ['CaseInsense;HalfPrefix', 'ação', 'ações', false],
  ['CaseInsense;HalfPrefix', 'ação', 'açãozinha', false],
  ['CaseInsense;HalfPrefix', 'café', 'cafés', true],
  ['CaseInsense;HalfPrefix', 'red car', 'red cars', true],
  ['CaseInsense;NoPrefix', '大熔炉', '在大熔炉3级', true]
]) test(`${raw}: ${term} in ${text}`, () => {
  assert.equal(containsMemoqTerm(text, term, rule(raw)), expected);
  const matcher = createTbMatcher([{ ...entry(raw, 'CaseInsense;NoPrefix'), sourceTerm: term }]);
  const matches = matchTbEntries({ matcher, text, srcLang: 'en', tgtLang: 'pt' });
  assert.equal(matches.length > 0, expected);
  if (expected) assert.equal(matches[0].matchedText, text === '在大熔炉3级' ? '大熔炉' : text);
});
test('rules and defaults are parsed only from dedicated columns', () => {
  assert.equal(parseMemoqTermRules({ note: 'CaseSense' }), null);
  assert.equal(rule('').caseMode, 'permissive');
  assert.equal(rule('').matching, 'half_prefix');
  for (const raw of ['Custom', 'Prefix', 'Fuzzy', 'CaseSense;CaseInsense', 'FutureRule']) {
    assert.equal(rule(raw).status, 'unsupported');
    assert.equal(matchTbEntries({ matcher: createTbMatcher([entry(raw, '')]), text: 'review', srcLang: 'en', tgtLang: 'pt' }).length, 0);
  }
  assert.equal(rule('CaseSensitive;Exact;Noun;Sg').status, 'supported');
});
test('target rules are shared by required checks, forbidden checks and reverse lookup', () => {
  const item = entry('CaseInsense;HalfPrefix', 'CaseSense;NoPrefix');
  const matches = matchTbEntries({ matcher: createTbMatcher([item]), text: 'reviews', srcLang: 'en', tgtLang: 'pt' });
  assert.equal(evaluateTerminologyQa({ translatedText: 'teste', matches }).ok, true);
  for (const translatedText of ['Teste', 'testes', 'preteste']) assert.equal(evaluateTerminologyQa({ translatedText, matches }).ok, false);
  const reverse = matchTbEntries({ matcher: createTbMatcher([item]), text: 'teste', srcLang: 'pt', tgtLang: 'en' });
  assert.equal(evaluateTerminologyQa({ translatedText: 'reviewing', matches: reverse }).ok, true);
  const banned = { ...item, targetRules: rule('CaseInsense;HalfPrefix;NonTerm') };
  const bannedMatches = matchTbEntries({ matcher: createTbMatcher([banned]), text: 'review', srcLang: 'en', tgtLang: 'pt' });
  assert.equal(bannedMatches[0].forbidden, true);
  assert.equal(evaluateTerminologyQa({ translatedText: 'testes', matches: bannedMatches }).ok, false);
  assert.equal(evaluateTerminologyQa({ translatedText: 'alternative', matches: bannedMatches }).ok, true);
  assert.equal(matchTbEntries({ matcher: createTbMatcher([banned]), text: 'teste', srcLang: 'pt', tgtLang: 'en' }).length, 0);
  assert.notEqual(createTbFingerprint([item]), createTbFingerprint([banned]));
});
test('same source keeps both required and forbidden constraints', () => {
  const normal = entry('CaseInsense;NoPrefix', 'CaseInsense;NoPrefix');
  const banned = { ...normal, id: 'bad', targetTerm: 'bad', targetRules: rule('CaseInsense;NoPrefix;NonTerm') };
  const matches = matchTbEntries({ matcher: createTbMatcher([normal, banned]), text: 'review', srcLang: 'en', tgtLang: 'pt' });
  assert.equal(matches.length, 2);
  assert.equal(evaluateTerminologyQa({ translatedText: 'teste bad', matches }).ok, false);
});
test('unsupported rules never report full compliance in evidence', () => {
  const { buildTranslationEvidence } = require('../src/runtime/translationEvidence');
  const evidence = buildTranslationEvidence({ profile: {}, assetContext: { assetSnapshots: [{ id: 'tb', purpose: 'glossary', memoqRules: { unsupportedEntries: 1 } }] }, segment: { index: 0, tbContext: { termHits: [] }, qaSummary: { ok: true } }, hasResult: true });
  assert.equal(evidence.terminologyStatus, 'rules_unsupported');
});
test('local target evidence records outcome without claiming model delivery', () => {
  const { buildTranslationEvidence } = require('../src/runtime/translationEvidence');
  const evidence = buildTranslationEvidence({ profile: {}, assetContext: { assetSnapshots: [{ id: 'tb', purpose: 'glossary' }] }, segment: { index: 0, tbContext: { termHits: [{ assetId: 'tb', sourceTerm: 'review', targetTerm: 'teste' }] }, qaSummary: { ok: true, issues: [] } } });
  assert.equal(evidence.terminologyStatus, 'compliant');
  assert.equal(evidence.assets[0].matches[0].targetCheck, 'compliant');
  assert.equal(evidence.assets[0].sentToModel, false);
  assert.equal(evidence.modelInvoked, false);
});
test('legacy explicit case sensitivity still matches and rejects the wrong case', () => {
  const matcher = createTbMatcher([{ sourceTerm: 'memoQ', targetTerm: 'memoQ', srcLang: 'en', tgtLang: 'pt', caseSensitive: true }]);
  assert.equal(matchTbEntries({ matcher, text: 'Use memoQ', srcLang: 'en', tgtLang: 'pt' }).length, 1);
  assert.equal(matchTbEntries({ matcher, text: 'Use memoq', srcLang: 'en', tgtLang: 'pt' }).length, 0);
});
test('QTerm fields parse independently and retain unsupported values', () => {
  const parsed = parseMemoqTermRules({ Term_CaseSensitivity: 'CaseInsense', Term_PrefixMatching: 'NoPrefix', Term_Forbidden: 'NonTerm' });
  assert.equal(parsed.caseMode, 'insensitive');
  assert.equal(parsed.matching, 'exact');
  assert.equal(parsed.forbidden, true);
  assert.equal(parsed.status, 'supported');
});
test('imported multilingual rules reach local source and target testing without invoking AI', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { createRuntimeTranslationTools } = require('../src/runtime/runtimeTranslationTools');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-rules-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storedPath = path.join(dir, 'terms.csv');
  fs.writeFileSync(storedPath, 'English_United_States,Term_Info,Portuguese_Brazil,Term_Info\nreview,CaseInsense;HalfPrefix,teste,CaseSense;NoPrefix\n');
  const profile = { id: 'p', assetBindings: [{ assetId: 'a', purpose: 'glossary' }] };
  const tools = createRuntimeTranslationTools({ loadState: () => ({ profiles: [profile], assets: [{ id: 'a', type: 'glossary', name: 'terms', fileName: 'terms.csv', storedPath }] }), hasSmartTbParsingCapability: () => true, performTranslation: () => { throw new Error('No AI call allowed'); } });
  const input = { profileId: 'p', sourceLanguage: 'en-US', targetLanguage: 'pt-BR', sourceText: 'reviewing' };
  assert.equal(tools.testAssets(input).evidence.terminologyStatus, 'not_checked');
  const good = tools.testAssets({ ...input, targetText: 'teste' }).evidence;
  assert.equal(good.terminologyStatus, 'compliant');
  assert.equal(good.assets[0].matches[0].sourceRules.matching, 'half_prefix');
  assert.equal(good.assets[0].matches[0].matchText, 'reviewing');
  assert.equal(good.assets[0].sentToModel, false);
  assert.equal(tools.testAssets({ ...input, targetText: 'testes' }).evidence.terminologyStatus, 'violated');
});
