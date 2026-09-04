const { listTemplatePlaceholders } = require('./promptTemplate');
const {
  normalizeCustomTmMatchBuckets
} = require('../asset/assetTmMatcher');

const FIRST_RELEASE_FIXED_PROFILE_FIELDS = Object.freeze({});

const FIRST_RELEASE_DISABLED_PLACEHOLDER_TOKENS = new Set([
  'brief-text',
  'full-text'
]);

const FIRST_RELEASE_VISIBLE_ASSET_TYPES = new Set([
  'glossary',
  'custom_tm'
]);

/**
 * @param {Record<string, unknown>=} assetSelections
 * @returns {{ glossaryAssetId?: string, customTmAssetId?: string }}
 */
function normalizeAssetSelections(assetSelections = {}) {
  const glossaryAssetId = String(assetSelections?.glossaryAssetId || '').trim();
  const customTmAssetId = String(assetSelections?.customTmAssetId || assetSelections?.customTm || '').trim();
  return {
    ...(glossaryAssetId ? { glossaryAssetId } : {}),
    ...(customTmAssetId ? { customTmAssetId } : {})
  };
}

/**
 * @param {unknown=} assetBindings
 * @returns {Array<{ assetId: string, purpose: string }>}
 */
function normalizeAssetBindings(assetBindings = []) {
  return (Array.isArray(assetBindings) ? assetBindings : [])
    .filter((binding) => FIRST_RELEASE_VISIBLE_ASSET_TYPES.has(String(binding?.purpose || '').trim()))
    .map((binding) => ({
      assetId: String(binding?.assetId || '').trim(),
      purpose: String(binding?.purpose || '').trim()
    }))
    .filter((binding) => binding.assetId && binding.purpose);
}

/**
 * @typedef {Object} ProfilePolicyInput
 * @property {unknown=} assetBindings
 * @property {Record<string, unknown>=} assetSelections
 * @property {unknown=} customTmMatchBuckets
 */

/**
 * @param {ProfilePolicyInput=} profile
 */
function applyFirstReleaseProfilePolicy(profile = {}) {
  return {
    ...profile,
    assetBindings: normalizeAssetBindings(profile.assetBindings),
    assetSelections: normalizeAssetSelections(profile.assetSelections),
    customTmMatchBuckets: normalizeCustomTmMatchBuckets(profile.customTmMatchBuckets)
  };
}

/**
 * @param {unknown=} placeholders
 * @returns {unknown[]}
 */
function getFirstReleaseVisiblePlaceholders(placeholders = []) {
  return (Array.isArray(placeholders) ? placeholders : [])
    .filter((item) => !FIRST_RELEASE_DISABLED_PLACEHOLDER_TOKENS.has(String(item?.token || '').trim()));
}

/**
 * @param {unknown} template
 * @returns {string[]}
 */
function collectDisallowedPlaceholderTokens(template) {
  return listTemplatePlaceholders(template)
    .map((item) => String(item?.token || '').trim())
    .filter((token) => FIRST_RELEASE_DISABLED_PLACEHOLDER_TOKENS.has(token));
}

/**
 * @param {import('./promptTemplate').ProfilePromptTemplatesInput=} profile
 * @returns {string[]}
 */
function collectFirstReleaseProfilePlaceholderViolations(profile = {}) {
  const violations = new Set();
  const templates = [
    profile?.systemPrompt,
    profile?.userPrompt,
    profile?.promptTemplates?.single?.systemPrompt,
    profile?.promptTemplates?.single?.userPrompt,
    profile?.promptTemplates?.batch?.systemPrompt,
    profile?.promptTemplates?.batch?.userPrompt,
    profile?.promptTemplates?.qa?.systemPrompt,
    profile?.promptTemplates?.qa?.userPrompt
  ];

  for (const template of templates) {
    for (const token of collectDisallowedPlaceholderTokens(template)) {
      violations.add(token);
    }
  }

  return [...violations];
}

module.exports = {
  FIRST_RELEASE_DISABLED_PLACEHOLDER_TOKENS,
  FIRST_RELEASE_FIXED_PROFILE_FIELDS,
  FIRST_RELEASE_VISIBLE_ASSET_TYPES,
  applyFirstReleaseProfilePolicy,
  collectFirstReleaseProfilePlaceholderViolations,
  getFirstReleaseVisiblePlaceholders
};
