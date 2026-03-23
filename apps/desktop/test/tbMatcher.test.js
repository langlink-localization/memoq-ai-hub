const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTbMatcher,
  matchTbEntries,
  normalizeTermMatchText,
  renderMatchedTerminologyBlock
} = require('../src/asset/assetTerminology');

test('tb matcher prefers leftmost-longest matches and avoids substring false positives', () => {
  const entries = [
    {
      id: 'memory',
      sourceTerm: 'memory',
      targetTerm: 'memoire',
      srcLang: 'EN',
      tgtLang: 'FR',
      matchMode: 'whole_word',
      priority: 1
    },
    {
      id: 'translation-memory',
      sourceTerm: 'translation memory',
      targetTerm: 'memoire de traduction',
      srcLang: 'EN',
      tgtLang: 'FR',
      matchMode: 'phrase',
      priority: 1
    },
    {
      id: 'cat',
      sourceTerm: 'cat',
      targetTerm: 'chat',
      srcLang: 'EN',
      tgtLang: 'FR',
      matchMode: 'whole_word',
      priority: 1
    }
  ];

  const matches = matchTbEntries({
    matcher: createTbMatcher(entries),
    text: 'The translation memory must not match concatenate or catapult.',
    srcLang: 'EN',
    tgtLang: 'FR'
  });

  assert.deepEqual(matches.map((item) => item.entry.id), ['translation-memory']);
});

test('tb matcher resolves ties by priority and scope specificity', () => {
  const entries = [
    {
      id: 'generic-workspace',
      sourceTerm: 'workspace',
      targetTerm: 'espace de travail',
      srcLang: 'EN',
      tgtLang: 'FR',
      matchMode: 'whole_word',
      priority: 1
    },
    {
      id: 'client-workspace',
      sourceTerm: 'workspace',
      targetTerm: 'zone client',
      srcLang: 'EN',
      tgtLang: 'FR',
      client: 'Acme',
      matchMode: 'whole_word',
      priority: 5
    }
  ];

  const matches = matchTbEntries({
    matcher: createTbMatcher(entries),
    text: 'Open the workspace.',
    srcLang: 'EN',
    tgtLang: 'FR',
    metadata: { client: 'Acme' }
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].entry.id, 'client-workspace');
});

test('tb matcher does not filter uploaded terminology by request metadata', () => {
  const matches = matchTbEntries({
    matcher: createTbMatcher([{
      id: 'project-scoped-hero',
      sourceTerm: 'hero',
      targetTerm: 'hero-power-term',
      srcLang: 'EN',
      tgtLang: 'FR',
      project: 'PRJ-123',
      client: 'Acme',
      domain: 'Gaming',
      matchMode: 'whole_word'
    }]),
    text: 'hero',
    srcLang: 'EN',
    tgtLang: 'FR',
    metadata: { projectId: 'DIFFERENT', client: 'Other', domain: 'Legal' }
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].entryId, 'project-scoped-hero');
});

test('tb matcher renders required and forbidden terminology blocks', () => {
  const text = renderMatchedTerminologyBlock([
    {
      entry: {
        sourceTerm: 'workspace',
        targetTerm: 'workspace-zh',
        forbidden: false,
        note: 'UI label'
      }
    },
    {
      entry: {
        sourceTerm: 'sign in',
        targetTerm: 'signin-bad',
        forbidden: true,
        note: ''
      }
    }
  ]);

  assert.match(text, /Required terminology:/);
  assert.match(text, /"workspace" => "workspace-zh"/);
  assert.match(text, /Forbidden terminology:/);
  assert.match(text, /Do not translate "sign in" as "signin-bad"/);
  assert.match(text, /UI label/);
});

test('tb matcher normalizes separators, width, and tags before matching', () => {
  const matches = matchTbEntries({
    matcher: createTbMatcher([{
      id: 'api-key',
      sourceTerm: 'API Key',
      targetTerm: 'api-key-zh',
      srcLang: 'EN',
      tgtLang: 'ZH',
      matchMode: 'normalized'
    }]),
    text: 'Use the <b>ＡＰＩ-Key</b> here.',
    srcLang: 'EN',
    tgtLang: 'ZH'
  });

  assert.equal(normalizeTermMatchText(' <b>ＡＰＩ-Key</b> ', { matchMode: 'normalized' }), 'api key');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].entryId, 'api-key');
  assert.equal(matches[0].targetTerm, 'api-key-zh');
});

test('tb matcher normalizes regional language aliases across tb headers and memoq requests', () => {
  const matches = matchTbEntries({
    matcher: createTbMatcher([{
      id: 'hero',
      sourceTerm: 'hero',
      targetTerm: 'hero-zh',
      srcLang: 'English (United States)',
      tgtLang: 'Chinese (PRC)',
      matchMode: 'whole_word'
    }]),
    text: 'hero',
    srcLang: 'en-US',
    tgtLang: 'zh-CN'
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].entryId, 'hero');
});

test('tb matcher falls back to base language pairs when region tags differ', () => {
  const matches = matchTbEntries({
    matcher: createTbMatcher([{
      id: 'save',
      sourceTerm: 'save',
      targetTerm: 'save-zh',
      srcLang: 'en_US',
      tgtLang: 'zh_CN',
      matchMode: 'whole_word'
    }]),
    text: 'save now',
    srcLang: 'en',
    tgtLang: 'zh'
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].entryId, 'save');
});

test('tb matcher falls back to wildcard language pairs when no direct pair matches', () => {
  const matches = matchTbEntries({
    matcher: createTbMatcher([{
      id: 'brand',
      sourceTerm: 'Codex',
      targetTerm: 'Codex',
      srcLang: '*',
      tgtLang: '*',
      matchMode: 'whole_word'
    }]),
    text: 'Codex desktop',
    srcLang: 'ja-JP',
    tgtLang: 'fr-FR'
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].entryId, 'brand');
});

test('tb matcher supports reverse direction lookups for bilingual terminology entries', () => {
  const matches = matchTbEntries({
    matcher: createTbMatcher([{
      id: 'tower-defense',
      sourceTerm: 'Tower Defense',
      targetTerm: '塔防',
      srcLang: 'en-US',
      tgtLang: 'zh-CN',
      matchMode: 'phrase'
    }]),
    text: '塔防暴击提升',
    srcLang: 'zh-CN',
    tgtLang: 'en-US'
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].entryId, 'tower-defense');
  assert.equal(matches[0].sourceTerm, '塔防');
  assert.equal(matches[0].targetTerm, 'Tower Defense');
  assert.equal(matches[0].entry.matchDirection, 'reverse');
});

test('tb matcher prefers forward-direction entries over reverse lookups when both match', () => {
  const matches = matchTbEntries({
    matcher: createTbMatcher([
      {
        id: 'reverse-tower-defense',
        sourceTerm: 'Tower Defense',
        targetTerm: '塔防',
        srcLang: 'en-US',
        tgtLang: 'zh-CN',
        matchMode: 'phrase'
      },
      {
        id: 'forward-tower-defense',
        sourceTerm: '塔防',
        targetTerm: 'Tower Defense',
        srcLang: 'zh-CN',
        tgtLang: 'en-US',
        matchMode: 'phrase'
      }
    ]),
    text: '塔防暴击提升',
    srcLang: 'zh-CN',
    tgtLang: 'en-US'
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].entryId, 'forward-tower-defense');
  assert.equal(matches[0].entry.matchDirection, 'forward');
});

test('tb matcher supports memoQ ISO-3 language aliases for reverse bilingual lookups', () => {
  const matches = matchTbEntries({
    matcher: createTbMatcher([{
      id: 'tower-defense-iso3',
      sourceTerm: 'Tower Defense',
      targetTerm: '塔防',
      srcLang: 'en-US',
      tgtLang: 'zh-CN',
      matchMode: 'phrase'
    }]),
    text: '塔防攻速提升',
    srcLang: 'zho-CN',
    tgtLang: 'eng-US'
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].entryId, 'tower-defense-iso3');
  assert.equal(matches[0].sourceTerm, '塔防');
  assert.equal(matches[0].targetTerm, 'Tower Defense');
});
