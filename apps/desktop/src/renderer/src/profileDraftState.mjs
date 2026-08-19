import {
  DEFAULT_CUSTOM_TM_MATCH_BUCKETS,
  buildDefaultPresetProfile
} from './appShell.mjs';
import { isDraftProvider } from './providerDraftState.mjs';

export function createBlankProfile(t) {
  return buildDefaultPresetProfile({
    name: t('context.defaultPresetName'),
    description: t('context.defaultPresetDescription'),
    translationStyle: t('context.translationStyleInstruction.natural')
  });
}

export function createEmptyProfileDraft(t) {
  return {
    name: t('context.newProfileName'),
    description: '',
    translationStyle: t('context.translationStyleInstruction.natural'),
    useBestFuzzyTm: true,
    useMetadata: true,
    useUploadedGlossary: true,
    useCustomTm: true,
    customTmMatchBuckets: [...DEFAULT_CUSTOM_TM_MATCH_BUCKETS],
    useBrief: true,
    usePreviewContext: true,
    usePreviewFullText: false,
    usePreviewSummary: true,
    usePreviewAboveBelow: true,
    usePreviewTargetText: true,
    previewAboveIncludeSource: true,
    previewAboveIncludeTarget: false,
    previewBelowIncludeSource: true,
    previewBelowIncludeTarget: false,
    providerId: '',
    interactiveProviderId: '',
    interactiveModelId: '',
    pretranslateProviderId: '',
    pretranslateModelId: '',
    fallbackProviderId: '',
    fallbackModelId: '',
    assetBindings: [],
    assetSelections: {}
  };
}

export function getProfileProviderId(profile = {}) {
  return String(
    profile.providerId
    || profile.interactiveProviderId
    || profile.pretranslateProviderId
    || profile.fallbackProviderId
    || ''
  ).trim();
}

export function applyProfileProviderId(profile = {}, providerId = '') {
  const normalized = String(providerId || '').trim();
  return {
    ...profile,
    providerId: normalized,
    interactiveProviderId: normalized,
    pretranslateProviderId: normalized,
    fallbackProviderId: normalized
  };
}

export function buildExecutionOptionValue(providerId, modelId) {
  return `${String(providerId || '').trim()}::${String(modelId || '').trim()}`;
}

export function isSelectableProfileProvider(provider = {}) {
  return Boolean(provider?.id) && !isDraftProvider(provider);
}

export function getProfileExecutionSelection(profile = {}) {
  const providerId = getProfileProviderId(profile);
  const modelId = String(
    profile.interactiveModelId
    || profile.pretranslateModelId
    || profile.fallbackModelId
    || ''
  ).trim();

  if (!providerId || !modelId) {
    return undefined;
  }

  return buildExecutionOptionValue(providerId, modelId);
}

export function applyProfileExecutionSelection(profile = {}, value = '') {
  const [providerId = '', modelId = ''] = String(value || '').split('::');
  const normalizedProviderId = String(providerId || '').trim();
  const normalizedModelId = String(modelId || '').trim();

  return {
    ...applyProfileProviderId(profile, normalizedProviderId),
    interactiveModelId: normalizedModelId,
    pretranslateModelId: normalizedModelId,
    fallbackModelId: normalizedModelId
  };
}

export function buildProfileFingerprint(profile) {
  if (!profile) return '';

  return JSON.stringify({
    name: profile.name || '',
    description: profile.description || '',
    translationStyle: profile.translationStyle || '',
    useBestFuzzyTm: profile.useBestFuzzyTm !== false,
    useMetadata: profile.useMetadata !== false,
    useUploadedGlossary: profile.useUploadedGlossary !== false,
    useCustomTm: profile.useCustomTm !== false,
    customTmMatchBuckets: Array.isArray(profile.customTmMatchBuckets) ? profile.customTmMatchBuckets : DEFAULT_CUSTOM_TM_MATCH_BUCKETS,
    useBrief: profile.useBrief !== false,
    usePreviewContext: profile.usePreviewContext === true,
    usePreviewFullText: profile.usePreviewFullText === true,
    usePreviewSummary: profile.usePreviewSummary === true,
    usePreviewAboveBelow: profile.usePreviewAboveBelow === true,
    usePreviewTargetText: profile.usePreviewTargetText === true,
    previewAboveSegments: profile.previewAboveSegments ?? 0,
    previewAboveCharacters: profile.previewAboveCharacters ?? 0,
    previewAboveIncludeSource: profile.previewAboveIncludeSource === true,
    previewAboveIncludeTarget: profile.previewAboveIncludeTarget !== false,
    previewBelowSegments: profile.previewBelowSegments ?? 0,
    previewBelowCharacters: profile.previewBelowCharacters ?? 0,
    previewBelowIncludeSource: profile.previewBelowIncludeSource === true,
    previewBelowIncludeTarget: profile.previewBelowIncludeTarget !== false,
    cacheEnabled: profile.cacheEnabled !== false,
    providerId: profile.providerId || '',
    interactiveProviderId: profile.interactiveProviderId || '',
    interactiveModelId: profile.interactiveModelId || '',
    pretranslateProviderId: profile.pretranslateProviderId || '',
    pretranslateModelId: profile.pretranslateModelId || '',
    fallbackProviderId: profile.fallbackProviderId || '',
    fallbackModelId: profile.fallbackModelId || '',
    assetBindings: profile.assetBindings || [],
    assetSelections: profile.assetSelections || {}
  });
}

export function buildAssetSelectionsFromBindings(assetBindings = []) {
  const nextSelections = {};
  for (const binding of Array.isArray(assetBindings) ? assetBindings : []) {
    const assetId = String(binding?.assetId || '').trim();
    const purpose = String(binding?.purpose || '').trim();
    if (!assetId || !purpose) {
      continue;
    }
    if (purpose === 'glossary' && !nextSelections.glossaryAssetId) {
      nextSelections.glossaryAssetId = assetId;
    } else if (purpose === 'custom_tm' && !nextSelections.customTmAssetId) {
      nextSelections.customTmAssetId = assetId;
    }
  }
  return nextSelections;
}

export function buildAssetBindingsFromSelections(assetSelections = {}) {
  const nextBindings = [];
  const glossaryAssetId = String(assetSelections?.glossaryAssetId || '').trim();
  const customTmAssetId = String(assetSelections?.customTmAssetId || '').trim();

  if (glossaryAssetId) {
    nextBindings.push({ assetId: glossaryAssetId, purpose: 'glossary' });
  }
  if (customTmAssetId) {
    nextBindings.push({ assetId: customTmAssetId, purpose: 'custom_tm' });
  }

  return nextBindings;
}
