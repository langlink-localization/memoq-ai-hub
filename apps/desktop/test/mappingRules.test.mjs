import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMappingRuleConditionSummary,
  buildMappingRulePayload,
  createMappingRuleDraft,
  createMappingTestInput,
  findNextRulePriority,
  getMappingTestResultKind,
  hasDuplicateRulePriority,
  hasMappingRuleConditions,
  sortMappingRules,
  validateDocumentIdRegex
} from '../src/renderer/src/pages/mapping/mappingRules.mjs';

test('mapping rule drafts preserve the persisted flat contract and copies get a clean identity', () => {
  const source = { id: 'rule-1', ruleName: 'Acme', priority: 20, profileId: 'profile-1', client: 'Acme', hitCount: 8 };
  assert.deepEqual(createMappingRuleDraft(source), {
    id: 'rule-1', ruleName: 'Acme', enabled: true, priority: 20, profileId: 'profile-1', hitCount: 8,
    client: 'Acme', domain: '', subjectContains: '', projectId: '', sourceLanguage: '', targetLanguage: '', documentIdRegex: '', segmentStatus: ''
  });
  const copy = createMappingRuleDraft(source, { copy: true, priority: 30 });
  assert.equal(copy.id, '');
  assert.equal(copy.hitCount, 0);
  assert.equal(buildMappingRulePayload(copy).hitCount, undefined);
});

test('mapping rules keep stable priority order and allocate an unused default priority', () => {
  const rules = [
    { id: 'later', priority: 20 },
    { id: 'first-same', priority: 10 },
    { id: 'second-same', priority: 10 }
  ];
  assert.deepEqual(sortMappingRules(rules).map((rule) => rule.id), ['first-same', 'second-same', 'later']);
  assert.equal(findNextRulePriority(rules), 30);
  assert.equal(hasDuplicateRulePriority(rules, { id: 'new', priority: 10 }), true);
  assert.equal(hasDuplicateRulePriority(rules, { id: 'first-same', priority: 10 }), true);
});

test('mapping condition summaries expose catch-all, matcher semantics, and regex validation', () => {
  const t = (key, values = {}) => key === 'mapping.conditionSummary'
    ? `${values.field}|${values.matcher}|${values.value}`
    : key;
  assert.equal(hasMappingRuleConditions({}), false);
  assert.equal(buildMappingRuleConditionSummary({}, t), 'mapping.matchAll');
  assert.equal(buildMappingRuleConditionSummary({ client: 'Acme', domain: 'Legal' }, t), 'context.matchClient|mapping.matcher.equals|Acme · context.matchDomain|mapping.matcher.includes|Legal');
  assert.equal(validateDocumentIdRegex('^DOC-\\d+$'), true);
  assert.equal(validateDocumentIdRegex('['), false);
});

test('mapping match test inputs normalize supported metadata and classify result paths', () => {
  const input = createMappingTestInput({ client: ' Acme ', sourceLanguage: 'DE', targetLanguage: 'EN' });
  assert.equal(input.client, 'Acme');
  assert.equal(input.sourceLanguage, 'DE');
  assert.equal(input.targetLanguage, 'EN');
  assert.equal(getMappingTestResultKind({ profile: { id: 'p' }, rule: { id: 'r' } }), 'rule');
  assert.equal(getMappingTestResultKind({ rule: { id: 'stale' }, profile: null }), 'missing');
  assert.equal(getMappingTestResultKind({ profile: { id: 'p' } }), 'default');
  assert.equal(getMappingTestResultKind({}), 'none');
});
