export const QA_FEEDBACK_STATES = Object.freeze([
  'accepted',
  'false-positive',
  'fixed',
  'ignored',
  'rule-disabled'
]);

export function feedbackMapFromEntries(entries = []) {
  return Object.fromEntries((Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.findingId && QA_FEEDBACK_STATES.includes(entry.state))
    .map((entry) => [String(entry.findingId), entry.state]));
}

export function filterQaFindings(findings = [], filters = {}, feedbackByFinding = {}) {
  return (Array.isArray(findings) ? findings : []).filter((finding) => {
    const feedbackState = feedbackByFinding?.[finding.id] || '';
    if (filters.severity && finding.severity !== filters.severity) return false;
    if (filters.category && finding.category !== filters.category) return false;
    if (filters.origin && finding.origin !== filters.origin) return false;
    if (filters.reviewState === 'reviewed' && !feedbackState) return false;
    if (filters.reviewState === 'unreviewed' && feedbackState) return false;
    if (filters.reviewState && !['reviewed', 'unreviewed'].includes(filters.reviewState) && feedbackState !== filters.reviewState) return false;
    return true;
  });
}

function qaRuleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function disableQaRule({ api, profileId, ruleId }) {
  const normalizedProfileId = String(profileId || '').trim();
  const normalizedRuleId = String(ruleId || '').trim();
  if (!normalizedProfileId || !normalizedRuleId) {
    throw qaRuleError('QA_RULE_UNAVAILABLE', 'This finding is not linked to a saved profile rule.');
  }

  const state = await api.getAppState();
  const profiles = state?.contextBuilder?.profiles || [];
  const profile = profiles.find((item) => item.id === normalizedProfileId);
  if (!profile) {
    throw qaRuleError('QA_PROFILE_NOT_FOUND', 'The profile used by this quality result is no longer available.');
  }

  const rules = Array.isArray(profile.qaRules) ? profile.qaRules : [];
  const rule = rules.find((item) => item.id === normalizedRuleId);
  if (!rule) {
    throw qaRuleError('QA_RULE_NOT_FOUND', 'The quality rule used by this finding is no longer available.');
  }
  if (rule.enabled === false) {
    return { profile, rule, alreadyDisabled: true };
  }

  const savedProfile = await api.saveProfile({
    ...profile,
    qaRules: rules.map((item) => item.id === normalizedRuleId ? { ...item, enabled: false } : item)
  });
  if (!savedProfile?.id) {
    throw qaRuleError('QA_PROFILE_SAVE_FAILED', 'The profile could not be saved after disabling the quality rule.');
  }
  return {
    profile: savedProfile,
    rule: savedProfile.qaRules?.find((item) => item.id === normalizedRuleId) || { ...rule, enabled: false },
    alreadyDisabled: false
  };
}

export async function applyQaFindingFeedback({ finding, requestId, state, onDisableRule, onSaveFeedback }) {
  if (!finding?.id || !QA_FEEDBACK_STATES.includes(state) || typeof onSaveFeedback !== 'function') {
    throw qaRuleError('QA_FEEDBACK_INVALID', 'The quality feedback request is incomplete.');
  }
  let ruleDisabled = false;
  if (state === 'rule-disabled') {
    if (typeof onDisableRule !== 'function') {
      throw qaRuleError('QA_RULE_UNAVAILABLE', 'This finding cannot disable a profile rule.');
    }
    await onDisableRule(finding);
    ruleDisabled = true;
  }
  try {
    const feedback = await onSaveFeedback({
      requestId,
      findingId: finding.id,
      ruleId: finding.ruleId || '',
      state
    });
    return { feedback, ruleDisabled };
  } catch (error) {
    if (ruleDisabled) error.ruleDisabled = true;
    throw error;
  }
}
