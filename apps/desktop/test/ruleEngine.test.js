const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRule, resolveRuleMatch } = require('../src/runtime/runtimeRuleEngine');

test('evaluateRule matches exact and contains conditions', () => {
  const result = evaluateRule(
    {
      enabled: true,
      client: 'ABC',
      domain: 'IT',
      subjectContains: 'restart',
      projectId: 'PRJ-123',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      documentIdRegex: 'DOC-\\d+',
      segmentStatus: ''
    },
    {
      client: 'ABC',
      domain: 'IT Infrastructure',
      subject: 'IT Restart',
      projectId: 'PRJ-123',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      documentId: 'DOC-1',
      segmentStatus: ''
    }
  );

  assert.equal(result.matched, true);
});

test('resolveRuleMatch returns the highest-priority matching rule', () => {
  const match = resolveRuleMatch(
    [
      { id: 'rule_default', enabled: true, priority: 99, client: '', domain: '', subjectContains: '', projectId: '', sourceLanguage: '', targetLanguage: '', documentIdRegex: '', segmentStatus: '' },
      { id: 'rule_abc', enabled: true, priority: 1, client: 'ABC', domain: '', subjectContains: '', projectId: '', sourceLanguage: '', targetLanguage: '', documentIdRegex: '', segmentStatus: '' }
    ],
    { client: 'ABC' }
  );

  assert.equal(match.rule.id, 'rule_abc');
});
