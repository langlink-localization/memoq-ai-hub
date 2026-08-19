const { collectFirstReleaseProfilePlaceholderViolations } = require('../shared/profilePolicy');
const { normalizeMemoQMetadata } = require('../shared/memoqMetadataNormalizer');
const { resolveRuleMatch } = require('./runtimeRuleEngine');
const { ensureProfile, ensureRule } = require('./runtimeState');

function createRuntimeProfileService({
  loadState,
  saveState,
  createId,
  onProfileDeleted = () => {}
}) {
  function resolveProfile(state, metadata = {}, explicitProfileId = '') {
    if (explicitProfileId) {
      return { matchedRule: null, profile: state.profiles.find((item) => item.id === explicitProfileId) || null };
    }

    const match = resolveRuleMatch(state.mappingRules || [], metadata);
    if (!match) {
      return {
        matchedRule: null,
        profile: state.profiles.find((item) => item.id === state.defaultProfileId)
          || state.profiles.find((item) => item.name.toLowerCase() === 'default')
          || state.profiles[0]
          || null
      };
    }

    return {
      matchedRule: match.rule,
      profile: state.profiles.find((item) => item.id === match.rule.profileId) || null
    };
  }

  function saveProfile(profile) {
    const state = loadState();
    const blockedTokens = collectFirstReleaseProfilePlaceholderViolations(profile);
    if (blockedTokens.length) {
      throw new Error(`First-release profiles cannot use these placeholders: ${blockedTokens.map((token) => `{{${token}}}`).join(', ')}.`);
    }

    const nextProfile = ensureProfile(profile);
    const index = state.profiles.findIndex((item) => item.id === nextProfile.id);
    if (index >= 0) state.profiles[index] = nextProfile;
    else state.profiles.push(nextProfile);
    saveState(state);
    return nextProfile;
  }

  function setDefaultProfile(profileId) {
    const state = loadState();
    const normalizedProfileId = String(profileId || '').trim();
    if (normalizedProfileId && !state.profiles.some((item) => item.id === normalizedProfileId)) {
      throw new Error(`Profile ${normalizedProfileId} not found`);
    }
    state.defaultProfileId = normalizedProfileId;
    saveState(state);
    return { ok: true, defaultProfileId: state.defaultProfileId };
  }

  function duplicateProfile(profileId) {
    const state = loadState();
    const source = state.profiles.find((item) => item.id === profileId);
    if (!source) throw new Error(`Profile ${profileId} not found`);
    const copy = ensureProfile({ ...source, id: createId('profile'), name: `${source.name} Copy` });
    state.profiles.push(copy);
    saveState(state);
    return copy;
  }

  function deleteProfile(profileId) {
    const state = loadState();
    const profile = state.profiles.find((item) => item.id === profileId);
    if (!profile) throw new Error(`Profile ${profileId} not found`);

    const ruleReferences = state.mappingRules
      .filter((rule) => rule.profileId === profileId)
      .map((rule) => rule.ruleName);
    if (ruleReferences.length) {
      throw new Error(`Profile "${profile.name}" is still used by mapping rules: ${ruleReferences.join(', ')}.`);
    }

    state.profiles = state.profiles.filter((item) => item.id !== profileId);
    onProfileDeleted(profileId);
    if (state.defaultProfileId === profileId) {
      state.defaultProfileId = '';
    }
    saveState(state);
    return { ok: true };
  }

  function saveMappingRule(rule) {
    const state = loadState();
    const nextRule = ensureRule(rule);
    const index = state.mappingRules.findIndex((item) => item.id === nextRule.id);
    if (index >= 0) state.mappingRules[index] = nextRule;
    else state.mappingRules.push(nextRule);
    saveState(state);
    return nextRule;
  }

  function deleteMappingRule(ruleId) {
    const state = loadState();
    state.mappingRules = state.mappingRules.filter((item) => item.id !== ruleId);
    saveState(state);
    return { ok: true };
  }

  function testMapping(metadata) {
    const state = loadState();
    const normalized = normalizeMemoQMetadata(metadata || {});
    const resolved = resolveProfile(state, normalized);
    return { matched: Boolean(resolved.profile), profile: resolved.profile, rule: resolved.matchedRule };
  }

  return Object.freeze({
    deleteMappingRule,
    deleteProfile,
    duplicateProfile,
    resolveProfile,
    saveMappingRule,
    saveProfile,
    setDefaultProfile,
    testMapping
  });
}

module.exports = {
  createRuntimeProfileService
};
