const crypto = require('crypto');
const { normalizeAssetBinding } = require('../asset/assetRules');
const { applyFirstReleaseProfilePolicy } = require('../shared/profilePolicy');
const { normalizeQaPromptTemplate } = require('../qa/qaPrompt');
const { validateProfileTemplates } = require('../shared/promptTemplate');
const { normalizePromptPresets } = require('../shared/promptPresets');
const {
  isSupportedProviderType,
  sanitizeProvider,
  getDefaultProviderName,
  getDefaultModelName,
  getDefaultRequestPath,
  normalizeResponseFormat,
  normalizeThroughputMode
} = require('../provider/providerRegistry');
const { createInitialState } = require('./runtimePersistence');

const DEFAULT_PROFILE_SYSTEM_PROMPT = 'You are a professional translator working from {{source-language}} to {{target-language}}. Preserve placeholders, tags, formatting, and protected content. Follow the structured segment payload for terminology, memoQ TM hints, uploaded TM matches, and document context.';
const DEFAULT_PROFILE_USER_PROMPT = [
  'Translate the segment below and return only the translation.',
  'Use the segment payload fields for matched terminology, TM hints, and neighboring context whenever they are present.',
  '',
  'Source segment:',
  '{{source-text}}',
  '',
  '[Current target text:',
  ']{{target-text}}[',
  ']',
  '[Above source context:',
  ']{{above-source-text}}[',
  ']',
  '[Below source context:',
  ']{{below-source-text}}[',
  ']'
].join('\n');
const DEFAULT_BATCH_SYSTEM_PROMPT = 'You are translating a batch from {{source-language}} to {{target-language}}. Keep terminology, placeholders, and formatting consistent across every segment. Use each segment payload for matched terminology, memoQ TM hints, uploaded TM matches, and document context.';
const DEFAULT_BATCH_USER_PROMPT = [
  'Translate the segment below and return only the translation for that segment.',
  'Use the segment payload fields for matched terminology and TM hints whenever they are present.',
  '',
  'Source segment:',
  '{{source-text}}'
].join('\n');

/**
 * @param {unknown} prefix
 * @returns {string}
 */
function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

/**
 * @param {Record<string, any>=} template
 * @param {Record<string, any>=} defaults
 */
function normalizeProfilePromptEntry(template = {}, defaults = {}) {
  return {
    systemPrompt: String(template?.systemPrompt || defaults.systemPrompt || DEFAULT_PROFILE_SYSTEM_PROMPT).trim() || DEFAULT_PROFILE_SYSTEM_PROMPT,
    userPrompt: String(template?.userPrompt || defaults.userPrompt || DEFAULT_PROFILE_USER_PROMPT).trim() || DEFAULT_PROFILE_USER_PROMPT
  };
}

/**
 * @param {Record<string, any>=} profile
 * @param {string=} legacySystemPrompt
 * @param {string=} legacyUserPrompt
 * @returns {{ single: { systemPrompt: string, userPrompt: string }, batch: { systemPrompt: string, userPrompt: string }, qa: { systemPrompt: string, userPrompt: string } }}
 */
function normalizeProfilePromptTemplates(profile = {}, legacySystemPrompt = DEFAULT_PROFILE_SYSTEM_PROMPT, legacyUserPrompt = DEFAULT_PROFILE_USER_PROMPT) {
  const rawPromptTemplates = profile?.promptTemplates && typeof profile.promptTemplates === 'object'
    ? profile.promptTemplates
    : {};
  const batchDefaults = {
    systemPrompt: DEFAULT_BATCH_SYSTEM_PROMPT,
    userPrompt: DEFAULT_BATCH_USER_PROMPT
  };
  return {
    single: normalizeProfilePromptEntry(rawPromptTemplates.single, {
      systemPrompt: legacySystemPrompt,
      userPrompt: legacyUserPrompt
    }),
    batch: rawPromptTemplates.batch && typeof rawPromptTemplates.batch === 'object'
      ? normalizeProfilePromptEntry(rawPromptTemplates.batch, batchDefaults)
      : normalizeProfilePromptEntry({}, batchDefaults),
    qa: normalizeQaPromptTemplate(rawPromptTemplates.qa)
  };
}

/**
 * @param {Record<string, any>=} profile
 * @param {string=} mode
 * @param {Record<string, any>=} options
 */
function resolveProfilePromptTemplate(profile = {}, mode = 'single', options = {}) {
  const promptTemplates = options.promptTemplates || normalizeProfilePromptTemplates(
    profile,
    options.defaultSystemPrompt,
    options.defaultUserPrompt
  );
  const single = promptTemplates.single || normalizeProfilePromptEntry({}, {
    systemPrompt: options.defaultSystemPrompt,
    userPrompt: options.defaultUserPrompt
  });

  if (mode === 'batch') {
    return promptTemplates.batch || single;
  }

  return single;
}

/**
 * @param {Record<string, any>=} profile
 * @returns {void}
 */
function validateProfilePromptTemplates(profile = {}) {
  validateProfileTemplates(profile);

  const batchTemplate = profile?.promptTemplates?.batch;
  if (batchTemplate) {
    validateProfileTemplates(batchTemplate);
  }
}

/**
 * @param {unknown} value
 * @returns {any}
 */
function normalizeAssetSelectionIds(value) {
  const items = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const next = [];

  for (const item of items) {
    if (Array.isArray(item)) {
      for (const nested of normalizeAssetSelectionIds(item)) {
        if (!seen.has(nested)) {
          seen.add(nested);
          next.push(nested);
        }
      }
      continue;
    }

    const assetId = typeof item === 'string'
      ? item
      : (item && typeof item === 'object'
        ? String(item.assetId || item.id || item.selectedAssetId || '').trim()
        : '');
    if (!assetId || seen.has(assetId)) {
      continue;
    }
    seen.add(assetId);
    next.push(assetId);
  }

  return next;
}

/**
 * @param {any[]=} assetBindings
 * @returns {Record<string, string>}
 */
function buildAssetSelectionsFromBindings(assetBindings = []) {
  const next = {};

  for (const binding of Array.isArray(assetBindings) ? assetBindings : []) {
    const normalized = normalizeAssetBinding(binding);
    if (!normalized?.assetId || !normalized?.purpose) {
      continue;
    }

    if (normalized.purpose === 'glossary' && !next.glossaryAssetId) {
      next.glossaryAssetId = normalized.assetId;
    }
    if (normalized.purpose === 'custom_tm' && !next.customTmAssetId) {
      next.customTmAssetId = normalized.assetId;
    }
    if (normalized.purpose === 'brief' && !next.briefAssetId) {
      next.briefAssetId = normalized.assetId;
    }
  }

  return next;
}

/**
 * @param {Record<string, any>=} profile
 * @param {any[]=} assetBindings
 * @returns {Record<string, any>}
 */
function normalizeProfileAssetSelections(profile = {}, assetBindings = []) {
  const fallbackSelections = buildAssetSelectionsFromBindings(assetBindings);
  if (!profile?.assetSelections || typeof profile.assetSelections !== 'object' || Array.isArray(profile.assetSelections)) {
    return fallbackSelections;
  }
  const rawSelections = profile.assetSelections;
  const glossaryAssetId = normalizeAssetSelectionIds(
    rawSelections.glossaryAssetId
    ?? rawSelections.glossary
    ?? rawSelections.tb
    ?? rawSelections.termbase
  )[0] || '';
  const customTmAssetId = normalizeAssetSelectionIds(
    rawSelections.customTmAssetId
    ?? rawSelections.customTm
    ?? rawSelections.tm
    ?? rawSelections.translationMemory
  )[0] || '';
  const briefAssetId = normalizeAssetSelectionIds(
    rawSelections.briefAssetId
    ?? rawSelections.brief
    ?? rawSelections.translationBrief
  )[0] || '';
  const next = {
    ...(glossaryAssetId ? { glossaryAssetId } : {}),
    ...(customTmAssetId ? { customTmAssetId } : {}),
    ...(briefAssetId ? { briefAssetId } : {})
  };

  return Object.keys(next).length ? next : fallbackSelections;
}

/**
 * @param {Record<string, any>=} profile
 */
function normalizeProfileAssetBindings(profile = {}) {
  const legacyBindings = Array.isArray(profile.assetBindings)
    ? profile.assetBindings.map((binding) => normalizeAssetBinding(binding)).filter(Boolean)
    : [];
  const hasExplicitAssetBindings = Object.prototype.hasOwnProperty.call(profile, 'assetBindings') && Array.isArray(profile.assetBindings);
  if (hasExplicitAssetBindings) {
    return legacyBindings;
  }
  const assetSelections = normalizeProfileAssetSelections(profile, legacyBindings);
  const hasAssetSelections = profile?.assetSelections && typeof profile.assetSelections === 'object' && !Array.isArray(profile.assetSelections);

  if (!hasAssetSelections) {
    return legacyBindings;
  }

  return [
    normalizeAssetBinding({ assetId: assetSelections.glossaryAssetId || '', purpose: 'glossary' }),
    normalizeAssetBinding({ assetId: assetSelections.customTmAssetId || '', purpose: 'custom_tm' }),
    normalizeAssetBinding({ assetId: assetSelections.briefAssetId || '', purpose: 'brief' })
  ].filter(Boolean);
}

/**
 * @param {Record<string, any>=} profile
 * @returns {Record<string, any>}
 */
function ensureProfile(profile = {}) {
  const providerId = String(
    profile.providerId
    || profile.interactiveProviderId
    || profile.pretranslateProviderId
    || profile.fallbackProviderId
    || ''
  ).trim();
  const legacySystemPrompt = String(profile.systemPrompt || DEFAULT_PROFILE_SYSTEM_PROMPT).trim() || DEFAULT_PROFILE_SYSTEM_PROMPT;
  const legacyUserPrompt = String(profile.userPrompt || DEFAULT_PROFILE_USER_PROMPT).trim() || DEFAULT_PROFILE_USER_PROMPT;
  const promptTemplates = normalizeProfilePromptTemplates(profile, legacySystemPrompt, legacyUserPrompt);
  const hasExplicitAssetBindings = Object.prototype.hasOwnProperty.call(profile, 'assetBindings') && Array.isArray(profile.assetBindings);
  const assetBindings = normalizeProfileAssetBindings(profile);
  const assetSelections = hasExplicitAssetBindings
    ? buildAssetSelectionsFromBindings(assetBindings)
    : normalizeProfileAssetSelections(profile, assetBindings);
  const normalizedProfile = applyFirstReleaseProfilePolicy({
    id: profile.id || createId('profile'),
    name: String(profile.name || 'New Profile').trim() || 'New Profile',
    description: String(profile.description || '').trim(),
    translationStyle: String(profile.translationStyle || '').trim(),
    profilePresetId: String(profile.profilePresetId || '').trim(),
    isPresetDerived: profile.isPresetDerived === true,
    useBestFuzzyTm: profile.useBestFuzzyTm !== false,
    useMetadata: profile.useMetadata !== false,
    useUploadedGlossary: profile.useUploadedGlossary !== false,
    useCustomTm: profile.useCustomTm !== false,
    customTmMatchBuckets: profile.customTmMatchBuckets,
    useBrief: profile.useBrief !== false,
    usePreviewContext: profile.usePreviewContext === true,
    usePreviewFullText: profile.usePreviewFullText === true,
    usePreviewSummary: profile.usePreviewSummary === true,
    usePreviewAboveBelow: profile.usePreviewAboveBelow === true,
    usePreviewTargetText: profile.usePreviewTargetText === true,
    previewAboveSegments: Number.isFinite(Number(profile.previewAboveSegments)) ? Number(profile.previewAboveSegments) : 2,
    previewAboveCharacters: Number.isFinite(Number(profile.previewAboveCharacters)) ? Number(profile.previewAboveCharacters) : 500,
    previewAboveIncludeSource: profile.previewAboveIncludeSource !== false,
    previewAboveIncludeTarget: profile.previewAboveIncludeTarget === true,
    previewBelowSegments: Number.isFinite(Number(profile.previewBelowSegments)) ? Number(profile.previewBelowSegments) : 2,
    previewBelowCharacters: Number.isFinite(Number(profile.previewBelowCharacters)) ? Number(profile.previewBelowCharacters) : 500,
    previewBelowIncludeSource: profile.previewBelowIncludeSource !== false,
    previewBelowIncludeTarget: profile.previewBelowIncludeTarget === true,
    qaRealtimeAiEnabled: profile.qaRealtimeAiEnabled === true,
    qaIncludeSummary: profile.qaIncludeSummary === true,
    qaIncludeFullText: profile.qaIncludeFullText === true,
    promptTemplates: { qa: promptTemplates.qa },
    qaRules: (Array.isArray(profile.qaRules) ? profile.qaRules : []).map((rule, index) => ({
      id: String(rule?.id || `qa-rule-${index + 1}`),
      name: String(rule?.name || `QA rule ${index + 1}`).trim(),
      enabled: rule?.enabled !== false,
      type: ['regex', 'contains', 'not-contains', 'natural-language'].includes(rule?.type) ? rule.type : 'contains',
      scope: rule?.scope === 'source' ? 'source' : 'target',
      pattern: String(rule?.pattern || ''),
      flags: String(rule?.flags || ''),
      value: String(rule?.value || ''),
      instruction: String(rule?.instruction || ''),
      category: String(rule?.category || 'style'),
      severity: ['critical', 'major', 'minor', 'info'].includes(rule?.severity) ? rule.severity : 'minor',
      message: String(rule?.message || ''),
      version: String(rule?.version || '1'),
      lastValidatedAt: String(rule?.lastValidatedAt || '')
    })),
    cacheEnabled: profile.cacheEnabled !== false,
    providerId,
    interactiveProviderId: String(profile.interactiveProviderId || providerId || ''),
    interactiveModelId: String(profile.interactiveModelId || ''),
    pretranslateProviderId: String(profile.pretranslateProviderId || providerId || ''),
    pretranslateModelId: String(profile.pretranslateModelId || ''),
    fallbackProviderId: String(profile.fallbackProviderId || providerId || ''),
    fallbackModelId: String(profile.fallbackModelId || ''),
    assetBindings,
    assetSelections
  });

  validateProfilePromptTemplates({
    ...normalizedProfile,
    systemPrompt: legacySystemPrompt,
    userPrompt: legacyUserPrompt,
    promptTemplates
  });
  return normalizedProfile;
}

/**
 * @param {Record<string, any>=} model
 * @param {string=} providerType
 * @returns {Record<string, any>}
 */
function ensureProviderModel(model = {}, providerType = 'openai') {
  const defaultConcurrency = providerType === 'openai' ? 2 : 1;
  return {
    id: model.id || createId('model'),
    modelName: String(model.modelName || getDefaultModelName(providerType)).trim() || getDefaultModelName(providerType),
    enabled: model.enabled !== false,
    concurrencyLimit: Number.isFinite(Number(model.concurrencyLimit)) && Number(model.concurrencyLimit) > 0
      ? Math.floor(Number(model.concurrencyLimit))
      : defaultConcurrency,
    rateLimitHint: String(model.rateLimitHint || '').trim(),
    retryEnabled: model.retryEnabled !== false,
    retryAttempts: Number.isFinite(Number(model.retryAttempts)) && Number(model.retryAttempts) >= 0
      ? Math.floor(Number(model.retryAttempts))
      : 2,
    promptCacheEnabled: model.promptCacheEnabled === true,
    promptCacheTtlHint: String(model.promptCacheTtlHint || '').trim(),
    responseFormat: normalizeResponseFormat(model.responseFormat, ''),
    throughputMode: normalizeThroughputMode(model.throughputMode, ''),
    maxBatchSegments: Number.isFinite(Number(model.maxBatchSegments)) && Number(model.maxBatchSegments) > 0
      ? Math.floor(Number(model.maxBatchSegments))
      : 0,
    maxBatchCharacters: Number.isFinite(Number(model.maxBatchCharacters)) && Number(model.maxBatchCharacters) > 0
      ? Math.floor(Number(model.maxBatchCharacters))
      : 0,
    providerConcurrency: Number.isFinite(Number(model.providerConcurrency)) && Number(model.providerConcurrency) > 0
      ? Math.floor(Number(model.providerConcurrency))
      : 0,
    contextWindowTokens: Number.isFinite(Number(model.contextWindowTokens)) && Number(model.contextWindowTokens) > 0
      ? Math.floor(Number(model.contextWindowTokens))
      : 0,
    maxOutputTokens: Number.isFinite(Number(model.maxOutputTokens)) && Number(model.maxOutputTokens) > 0
      ? Math.floor(Number(model.maxOutputTokens))
      : 0,
    notes: String(model.notes || '').trim()
  };
}

/**
 * @param {any[]=} models
 * @param {unknown=} requestedId
 * @returns {string}
 */
function resolveProviderDefaultModelId(models = [], requestedId = '') {
  const normalizedModels = Array.isArray(models) ? models : [];
  const explicitId = String(requestedId || '').trim();

  if (explicitId) {
    const explicitModel = normalizedModels.find((model) => model.id === explicitId && model.enabled !== false);
    if (explicitModel) {
      return explicitModel.id;
    }
  }

  return normalizedModels.find((model) => model.enabled !== false)?.id
    || normalizedModels[0]?.id
    || '';
}

/**
 * @param {unknown} status
 * @returns {string}
 */
function normalizeProviderStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'healthy') return 'connected';
  if (normalized === 'needs_attention') return 'failed';
  if (normalized === 'idle') return 'not_tested';
  return ['connected', 'failed', 'testing', 'not_tested'].includes(normalized)
    ? normalized
    : 'not_tested';
}

/**
 * @param {Record<string, any>=} provider
 * @returns {Record<string, any>}
 */
function ensureProvider(provider = {}) {
  const sanitized = sanitizeProvider(provider);
  const models = Array.isArray(sanitized.models) ? sanitized.models : [];
  const normalizedModels = models.length
    ? models.map((model) => ensureProviderModel(model, sanitized.type))
    : (sanitized.type === 'openai-compatible' ? [] : [ensureProviderModel({}, sanitized.type)]);
  const defaultModelId = resolveProviderDefaultModelId(normalizedModels, sanitized.defaultModelId);

  return {
    id: sanitized.id || createId('provider'),
    name: String(sanitized.name || getDefaultProviderName(sanitized.type)).trim(),
    type: sanitized.type,
    baseUrl: sanitized.baseUrl,
    requestPath: sanitized.type === 'openai-compatible'
      ? String(sanitized.requestPath || getDefaultRequestPath(sanitized.type)).trim() || getDefaultRequestPath(sanitized.type)
      : '',
    enabled: sanitized.enabled !== false,
    status: normalizeProviderStatus(sanitized.status),
    lastCheckedAt: sanitized.lastCheckedAt || '',
    lastError: String(sanitized.lastError || ''),
    lastLatencyMs: Number.isFinite(Number(sanitized.lastLatencyMs)) ? Number(sanitized.lastLatencyMs) : null,
    secretRef: String(sanitized.secretRef || `provider-${sanitized.id || createId('secret')}`),
    capabilities: sanitized.capabilities,
    models: normalizedModels,
    defaultModelId
  };
}

/**
 * @param {Record<string, any>=} profile
 * @param {Set<string>=} removedProviderIds
 * @returns {Record<string, any>}
 */
function clearProfileProviderBindings(profile = {}, removedProviderIds = new Set()) {
  const nextProfile = { ...profile };

  const routeFields = [
    { providerField: 'providerId', modelField: '' },
    { providerField: 'interactiveProviderId', modelField: 'interactiveModelId' },
    { providerField: 'pretranslateProviderId', modelField: 'pretranslateModelId' },
    { providerField: 'fallbackProviderId', modelField: 'fallbackModelId' }
  ];

  for (const route of routeFields) {
    const providerId = String(nextProfile[route.providerField] || '').trim();
    if (!providerId || !removedProviderIds.has(providerId)) {
      continue;
    }

    nextProfile[route.providerField] = '';
    if (route.modelField) {
      nextProfile[route.modelField] = '';
    }
  }

  return nextProfile;
}

/**
 * @param {any[]=} providers
 * @returns {{ nextProviders: any[], removedProviderIds: Set<string> }}
 */
function normalizeProvidersForState(providers = []) {
  const nextProviders = [];
  const removedProviderIds = new Set();

  for (const provider of Array.isArray(providers) ? providers : []) {
    if (!isSupportedProviderType(provider?.type)) {
      if (provider?.id) {
        removedProviderIds.add(provider.id);
      }
      continue;
    }

    nextProviders.push(ensureProvider(provider));
  }

  return { nextProviders, removedProviderIds };
}

/**
 * @param {Record<string, any>=} rule
 * @returns {Record<string, any>}
 */
function ensureRule(rule = {}) {
  return {
    id: rule.id || createId('rule'),
    ruleName: String(rule.ruleName || 'New Rule').trim() || 'New Rule',
    enabled: rule.enabled !== false,
    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 99,
    client: String(rule.client || '').trim(),
    domain: String(rule.domain || '').trim(),
    subjectContains: String(rule.subjectContains || '').trim(),
    projectId: String(rule.projectId || '').trim(),
    sourceLanguage: String(rule.sourceLanguage || '').trim(),
    targetLanguage: String(rule.targetLanguage || '').trim(),
    documentIdRegex: String(rule.documentIdRegex || '').trim(),
    segmentStatus: String(rule.segmentStatus || '').trim(),
    profileId: String(rule.profileId || '').trim(),
    hitCount: Number.isFinite(Number(rule.hitCount)) ? Number(rule.hitCount) : 0
  };
}

/**
 * @param {Record<string, any>=} asset
 * @returns {Record<string, any>}
 */
function ensureAsset(asset = {}) {
  const normalized = asset && typeof asset === 'object' ? asset : {};
  const tbStructure = normalized.tbStructure && typeof normalized.tbStructure === 'object'
    ? {
      ...normalized.tbStructure,
      derivedFromSha256: String(normalized.tbStructure.derivedFromSha256 || normalized.sha256 || ''),
      fingerprint: String(normalized.tbStructure.fingerprint || ''),
      summary: String(normalized.tbStructure.summary || '')
    }
    : null;
  const tbManualMapping = normalized.tbManualMapping && typeof normalized.tbManualMapping === 'object'
    ? {
      srcColumn: String(normalized.tbManualMapping.srcColumn || '').trim(),
      tgtColumn: String(normalized.tbManualMapping.tgtColumn || '').trim()
    }
    : null;
  const tbLanguagePair = normalized.tbLanguagePair && typeof normalized.tbLanguagePair === 'object'
    ? {
      source: String(normalized.tbLanguagePair.source || '').trim(),
      target: String(normalized.tbLanguagePair.target || '').trim()
    }
    : { source: '', target: '' };

  return {
    id: String(normalized.id || createId('asset')).trim(),
    type: String(normalized.type || '').trim(),
    name: String(normalized.name || '').trim(),
    fileName: String(normalized.fileName || normalized.name || '').trim(),
    storedPath: String(normalized.storedPath || '').trim(),
    fileSize: Number.isFinite(Number(normalized.fileSize)) ? Number(normalized.fileSize) : 0,
    sha256: String(normalized.sha256 || '').trim(),
    createdAt: String(normalized.createdAt || '').trim(),
    tbStructure,
    tbManualMapping,
    tbLanguagePair,
    tbStructureConfidence: normalized.tbStructureConfidence && typeof normalized.tbStructureConfidence === 'object'
      ? normalized.tbStructureConfidence
      : null,
    tbStructureSource: String(normalized.tbStructureSource || '').trim()
  };
}

/**
 * @param {Record<string, any>=} preferences
 * @returns {Record<string, any>}
 */
function ensureIntegrationPreferences(preferences = {}) {
  return {
    memoqVersion: ['10', '11', '12'].includes(String(preferences.memoqVersion || '').trim())
      ? String(preferences.memoqVersion).trim()
      : '11',
    customInstallDir: String(preferences.customInstallDir || '').trim(),
    selectedInstallDir: String(preferences.selectedInstallDir || '').trim()
  };
}

/**
 * @param {Record<string, any>=} rawState
 * @returns {Record<string, any>}
 */
function normalizeState(rawState) {
  const state = rawState && typeof rawState === 'object' ? rawState : createInitialState();
  const { nextProviders, removedProviderIds } = normalizeProvidersForState(state.providers);
  const profiles = Array.isArray(state.profiles)
    ? state.profiles.map((profile) => clearProfileProviderBindings(ensureProfile(profile), removedProviderIds))
    : [];
  const defaultProfileId = profiles.some((profile) => profile.id === String(state.defaultProfileId || '').trim())
    ? String(state.defaultProfileId || '').trim()
    : '';

  return {
    profiles,
    defaultProfileId,
    assets: Array.isArray(state.assets) ? state.assets.map((asset) => ensureAsset(asset)) : [],
    mappingRules: Array.isArray(state.mappingRules) ? state.mappingRules.map((rule) => ensureRule(rule)) : [],
    providers: nextProviders,
    promptPresets: normalizePromptPresets(state.promptPresets),
    history: Array.isArray(state.history) ? state.history : [],
    translationCache: Array.isArray(state.translationCache) ? state.translationCache : [],
    promptResponseCache: Array.isArray(state.promptResponseCache) ? state.promptResponseCache : [],
    documentSummaryCache: Array.isArray(state.documentSummaryCache) ? state.documentSummaryCache : [],
    integrationPreferences: ensureIntegrationPreferences(state.integrationPreferences)
  };
}

module.exports = {
  DEFAULT_PROFILE_SYSTEM_PROMPT,
  DEFAULT_PROFILE_USER_PROMPT,
  ensureProfile,
  ensureProviderModel,
  resolveProviderDefaultModelId,
  ensureProvider,
  clearProfileProviderBindings,
  normalizeProvidersForState,
  normalizeProviderStatus,
  ensureRule,
  ensureAsset,
  ensureIntegrationPreferences,
  normalizeState,
  __internals: {
    buildAssetSelectionsFromBindings,
    normalizeProfilePromptEntry,
    normalizeProfilePromptTemplates,
    resolveProfilePromptTemplate,
    validateProfilePromptTemplates,
    normalizeAssetSelectionIds,
    normalizeProfileAssetSelections,
    normalizeProfileAssetBindings
  }
};
