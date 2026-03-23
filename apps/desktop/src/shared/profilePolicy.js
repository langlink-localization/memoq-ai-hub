const { listTemplatePlaceholders } = require('./promptTemplate');

const FIRST_RELEASE_FIXED_PROFILE_FIELDS = Object.freeze({
  useUploadedGlossary: true,
  useCustomTm: false,
  useBrief: false,
  useMetadata: true,
  cacheEnabled: true,
  usePreviewContext: true,
  usePreviewFullText: false
});

const FIRST_RELEASE_DISABLED_PLACEHOLDER_TOKENS = new Set([
  'brief-text',
  'custom-tm-source-text',
  'custom-tm-target-text',
  'full-text'
]);

const FIRST_RELEASE_VISIBLE_ASSET_TYPES = new Set([
  'glossary'
]);

function normalizeAssetSelections(assetSelections = {}) {
  const glossaryAssetId = String(assetSelections?.glossaryAssetId || '').trim();
  return glossaryAssetId ? { glossaryAssetId } : {};
}

function normalizeAssetBindings(assetBindings = []) {
  return (Array.isArray(assetBindings) ? assetBindings : [])
    .filter((binding) => FIRST_RELEASE_VISIBLE_ASSET_TYPES.has(String(binding?.purpose || '').trim()))
    .map((binding) => ({
      assetId: String(binding?.assetId || '').trim(),
      purpose: String(binding?.purpose || '').trim()
    }))
    .filter((binding) => binding.assetId && binding.purpose);
}

function applyFirstReleaseProfilePolicy(profile = {}) {
  return {
    ...profile,
    ...FIRST_RELEASE_FIXED_PROFILE_FIELDS,
    assetBindings: normalizeAssetBindings(profile.assetBindings),
    assetSelections: normalizeAssetSelections(profile.assetSelections)
  };
}

function getFirstReleaseVisiblePlaceholders(placeholders = []) {
  return (Array.isArray(placeholders) ? placeholders : [])
    .filter((item) => !FIRST_RELEASE_DISABLED_PLACEHOLDER_TOKENS.has(String(item?.token || '').trim()));
}

function collectDisallowedPlaceholderTokens(template) {
  return listTemplatePlaceholders(template)
    .map((item) => String(item?.token || '').trim())
    .filter((token) => FIRST_RELEASE_DISABLED_PLACEHOLDER_TOKENS.has(token));
}

function collectFirstReleaseProfilePlaceholderViolations(profile = {}) {
  const violations = new Set();
  const templates = [
    profile?.systemPrompt,
    profile?.userPrompt,
    profile?.promptTemplates?.single?.systemPrompt,
    profile?.promptTemplates?.single?.userPrompt,
    profile?.promptTemplates?.batch?.systemPrompt,
    profile?.promptTemplates?.batch?.userPrompt
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
