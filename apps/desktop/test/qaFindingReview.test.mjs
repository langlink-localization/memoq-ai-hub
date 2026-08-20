import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyQaFindingFeedback,
  disableQaRule,
  feedbackMapFromEntries,
  filterQaFindings
} from '../src/renderer/src/pages/quality/qaFindingReview.mjs';

const findings = [
  { id: 'f1', severity: 'major', category: 'accuracy', origin: 'ai' },
  { id: 'f2', severity: 'minor', category: 'style', origin: 'deterministic' },
  { id: 'f3', severity: 'major', category: 'style', origin: 'ai' }
];

test('QA finding feedback mapping keeps the last valid state for each finding', () => {
  assert.deepEqual(feedbackMapFromEntries([
    { findingId: 'f1', state: 'accepted' },
    { findingId: 'f1', state: 'fixed' },
    { findingId: 'f2', state: 'unknown' }
  ]), { f1: 'fixed' });
});

test('QA finding filters cover severity, category, origin, and review state', () => {
  const feedback = { f1: 'accepted', f2: 'false-positive' };
  assert.deepEqual(filterQaFindings(findings, { severity: 'major', origin: 'ai' }, feedback).map((item) => item.id), ['f1', 'f3']);
  assert.deepEqual(filterQaFindings(findings, { category: 'style', reviewState: 'reviewed' }, feedback).map((item) => item.id), ['f2']);
  assert.deepEqual(filterQaFindings(findings, { reviewState: 'unreviewed' }, feedback).map((item) => item.id), ['f3']);
  assert.deepEqual(filterQaFindings(findings, { reviewState: 'accepted' }, feedback).map((item) => item.id), ['f1']);
});

test('disabling a QA rule rejects deleted profiles and rules without saving', async () => {
  let saveCount = 0;
  const api = {
    getAppState: async () => ({ contextBuilder: { profiles: [{ id: 'profile-1', qaRules: [] }] } }),
    saveProfile: async () => { saveCount += 1; }
  };
  await assert.rejects(disableQaRule({ api, profileId: 'missing', ruleId: 'rule-1' }), { code: 'QA_PROFILE_NOT_FOUND' });
  await assert.rejects(disableQaRule({ api, profileId: 'profile-1', ruleId: 'rule-1' }), { code: 'QA_RULE_NOT_FOUND' });
  assert.equal(saveCount, 0);
});

test('disabling a QA rule is idempotent when the latest profile already disabled it', async () => {
  let saveCount = 0;
  const profile = { id: 'profile-1', name: 'Profile', qaRules: [{ id: 'rule-1', enabled: false }] };
  const result = await disableQaRule({
    api: {
      getAppState: async () => ({ contextBuilder: { profiles: [profile] } }),
      saveProfile: async () => { saveCount += 1; }
    },
    profileId: profile.id,
    ruleId: 'rule-1'
  });
  assert.equal(result.alreadyDisabled, true);
  assert.equal(saveCount, 0);
});

test('disabling a QA rule preserves the latest profile and changes only the target rule', async () => {
  const profile = {
    id: 'profile-1',
    name: 'Profile',
    providerId: 'provider-1',
    qaRules: [{ id: 'rule-1', enabled: true }, { id: 'rule-2', enabled: true }]
  };
  let saved;
  const result = await disableQaRule({
    api: {
      getAppState: async () => ({ contextBuilder: { profiles: [profile] } }),
      saveProfile: async (value) => { saved = value; return value; }
    },
    profileId: profile.id,
    ruleId: 'rule-1'
  });
  assert.equal(saved.providerId, 'provider-1');
  assert.equal(saved.qaRules[0].enabled, false);
  assert.equal(saved.qaRules[1].enabled, true);
  assert.equal(result.alreadyDisabled, false);
});

test('rule-disabled feedback saves only after the profile rule is disabled', async () => {
  const calls = [];
  await applyQaFindingFeedback({
    finding: { id: 'finding-1', ruleId: 'rule-1' },
    requestId: 'request-1',
    state: 'rule-disabled',
    onDisableRule: async () => { calls.push('disable'); },
    onSaveFeedback: async (payload) => { calls.push(`feedback:${payload.state}`); return payload; }
  });
  assert.deepEqual(calls, ['disable', 'feedback:rule-disabled']);
});

test('profile save failure prevents feedback and feedback failure reports partial success', async () => {
  let feedbackCount = 0;
  await assert.rejects(applyQaFindingFeedback({
    finding: { id: 'finding-1', ruleId: 'rule-1' },
    requestId: 'request-1',
    state: 'rule-disabled',
    onDisableRule: async () => { throw new Error('save failed'); },
    onSaveFeedback: async () => { feedbackCount += 1; }
  }), /save failed/);
  assert.equal(feedbackCount, 0);

  await assert.rejects(applyQaFindingFeedback({
    finding: { id: 'finding-1', ruleId: 'rule-1' },
    requestId: 'request-1',
    state: 'rule-disabled',
    onDisableRule: async () => {},
    onSaveFeedback: async () => { throw new Error('feedback failed'); }
  }), (error) => error.message === 'feedback failed' && error.ruleDisabled === true);
});
