export const APP_SECTIONS = [
  { key: 'dashboard', navKey: 'dashboard' },
  { key: 'builder', navKey: 'builder' },
  { key: 'assets', navKey: 'assets' },
  { key: 'providers', navKey: 'providers' },
  { key: 'logs', navKey: 'logs' },
  { key: 'history', navKey: 'history' }
];

export const DEFAULT_PRESET_SINGLE_SYSTEM_PROMPT = 'You are a professional translator working from {{source-language}} to {{target-language}}. Preserve placeholders, tags, formatting, and protected content. Follow the structured segment payload for terminology, TM hints, and document context.';
export const DEFAULT_PRESET_SINGLE_USER_PROMPT = [
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
export const DEFAULT_PRESET_BATCH_SYSTEM_PROMPT = 'You are translating a batch from {{source-language}} to {{target-language}}. Keep terminology, placeholders, and formatting consistent across every segment. Use each segment payload for matched terminology, TM hints, and document context.';
export const DEFAULT_PRESET_BATCH_USER_PROMPT = [
  'Translate the segment below and return only the translation for that segment.',
  'Use the segment payload fields for matched terminology and TM hints whenever they are present.',
  '',
  'Source segment:',
  '{{source-text}}'
].join('\n');

const EXPANDED_PANEL_SPAN = 6;
const COLLAPSED_PANEL_SPAN = 4;

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function buildDefaultPresetProfile() {
  return {
    name: 'Default Translation Ops',
    description: 'Preset profile with TB, memoQ TM hints, summary, and preview context enabled.',
    translationStyle: 'Prefer natural, concise, production-ready translations that stay consistent with product terminology.',
    profilePresetId: 'default-translation-ops',
    isPresetDerived: true,
    useBestFuzzyTm: true,
    useMetadata: true,
    useUploadedGlossary: true,
    useCustomTm: true,
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

function getInitials(label = '') {
  const tokens = String(label || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!tokens.length) {
    return '?';
  }

  return tokens
    .slice(0, 2)
    .map((token) => token[0]?.toUpperCase() || '')
    .join('') || '?';
}

export function getPanelColumnSpan(collapsed = false) {
  return collapsed ? COLLAPSED_PANEL_SPAN : EXPANDED_PANEL_SPAN;
}

export function getPanelContentSpan(collapsed = false) {
  return 24 - getPanelColumnSpan(collapsed);
}

export function buildCollapsiblePanelEntries(records = [], options = {}) {
  const selectedId = String(options.selectedId || '').trim();
  const emptyLabel = String(options.emptyLabel || 'Untitled').trim() || 'Untitled';
  const getLabel = typeof options.getLabel === 'function'
    ? options.getLabel
    : (record) => String(record?.name || record?.label || emptyLabel).trim() || emptyLabel;
  const getDescription = typeof options.getDescription === 'function'
    ? options.getDescription
    : null;
  const getTags = typeof options.getTags === 'function'
    ? options.getTags
    : null;

  return normalizeArray(records).map((record) => {
    const id = String(record?.id || '').trim();
    const label = getLabel(record);
    const description = getDescription ? String(getDescription(record) || '').trim() : '';
    const tags = getTags ? normalizeArray(getTags(record)).filter((tag) => tag?.label) : [];

    return {
      id,
      label,
      description,
      tags,
      avatarLabel: getInitials(label),
      isSelected: id === selectedId
    };
  });
}

export function buildPromptResources(profiles = []) {
  return normalizeArray(profiles).map((profile) => ({
    id: `prompt:${String(profile?.id || '').trim()}`,
    profileId: String(profile?.id || '').trim(),
    name: String(profile?.name || 'Untitled Profile').trim() || 'Untitled Profile',
    systemPrompt: String(profile?.systemPrompt || ''),
    userPrompt: String(profile?.userPrompt || '')
  }));
}

export function getHistoryPromptView(record) {
  return record?.promptView && typeof record.promptView === 'object' ? record.promptView : {};
}

export function getHistoryAssembledPrompt(record) {
  return record?.assembledPrompt && typeof record.assembledPrompt === 'object' ? record.assembledPrompt : {};
}

export function getHistoryContextSources(record) {
  return record?.contextSources && typeof record.contextSources === 'object' ? record.contextSources : {};
}

export function getHistoryRenderedSystemPrompt(record) {
  const assembledPrompt = getHistoryAssembledPrompt(record);
  if (assembledPrompt?.systemPrompt) {
    return String(assembledPrompt.systemPrompt);
  }
  const promptView = getHistoryPromptView(record);
  return String(
    promptView?.single?.systemPrompt
    || promptView?.batch?.systemPrompt
    || ''
  );
}

export function getHistoryRenderedUserPrompt(record) {
  const assembledPrompt = getHistoryAssembledPrompt(record);
  if (assembledPrompt?.userPrompt) {
    return String(assembledPrompt.userPrompt);
  }
  const promptView = getHistoryPromptView(record);

  if (promptView?.single?.userPrompt) {
    return String(promptView.single.userPrompt);
  }

  if (promptView?.batch?.userPrompt) {
    return String(promptView.batch.userPrompt);
  }

  if (Array.isArray(promptView?.batch?.items) && promptView.batch.items.some((item) => String(item?.userPrompt || '').trim())) {
    return 'Per-segment prompt instructions are shown below for batch requests.';
  }

  return '';
}

export function buildHistoryPromptItems(record, segments = []) {
  const assembledPrompt = getHistoryAssembledPrompt(record);
  if (Array.isArray(assembledPrompt?.items) && assembledPrompt.items.length) {
    return assembledPrompt.items.map((item, index) => ({
      key: `assembled-${item.segmentIndex ?? item.index ?? index}`,
      segmentIndex: item.segmentIndex ?? item.index ?? index,
      sourceText: String(item.sourceText || item.source || ''),
      promptInstructions: String(item.promptInstructions || item.userPrompt || item.content || '')
    }));
  }
  const promptView = getHistoryPromptView(record);
  const normalizedSegments = normalizeArray(segments).length
    ? normalizeArray(segments)
    : normalizeArray(record?.segments).map((segment, index) => ({
      segmentIndex: segment?.segmentIndex ?? index,
      source: segment?.source || segment?.sourceText || ''
    }));

  if (Array.isArray(promptView?.batch?.items) && promptView.batch.items.length) {
    return promptView.batch.items.map((item, index) => ({
      key: `batch-${item.segmentIndex ?? item.index ?? index}`,
      segmentIndex: item.segmentIndex ?? item.index ?? index,
      sourceText: String(item.sourceText || item.source || ''),
      promptInstructions: String(item.promptInstructions || item.userPrompt || item.content || '')
    }));
  }

  if (promptView?.single?.userPrompt || promptView?.single?.sourceText) {
    const segmentIndex = Number(normalizedSegments?.[0]?.segmentIndex ?? 0);
    return [{
      key: `single-${segmentIndex}`,
      segmentIndex,
      sourceText: String(promptView.single.sourceText || normalizedSegments?.[0]?.source || ''),
      promptInstructions: String(promptView.single.userPrompt || '')
    }];
  }

  return normalizedSegments.map((segment) => ({
    key: `segment-${segment.segmentIndex}`,
    segmentIndex: segment.segmentIndex,
    sourceText: String(segment.source || ''),
    promptInstructions: ''
  }));
}

export function shouldShowHistoryActualSentContent(record, segments = []) {
  const items = buildHistoryPromptItems(record, segments);
  if (!items.length) {
    return false;
  }

  if (String(record?.requestMode || '').trim().toLowerCase() === 'batch') {
    return true;
  }

  if (Array.isArray(record?.assembledPrompt?.items) && record.assembledPrompt.items.length > 1) {
    return true;
  }

  if (Array.isArray(record?.promptView?.batch?.items) && record.promptView.batch.items.length > 0) {
    return true;
  }

  return false;
}

export function buildAssetLibraryEntries(assets = [], profiles = []) {
  const bindingsByAssetId = new Map();

  for (const profile of normalizeArray(profiles)) {
    for (const binding of normalizeArray(profile?.assetBindings)) {
      const assetId = String(binding?.assetId || '').trim();
      if (!assetId) continue;
      const boundProfileNames = bindingsByAssetId.get(assetId) || [];
      boundProfileNames.push(String(profile?.name || 'Untitled Profile').trim() || 'Untitled Profile');
      bindingsByAssetId.set(assetId, boundProfileNames);
    }
  }

  return normalizeArray(assets).map((asset) => {
    const boundProfileNames = (bindingsByAssetId.get(String(asset?.id || '').trim()) || []).sort((left, right) => left.localeCompare(right));
    return {
      ...asset,
      usageCount: boundProfileNames.length,
      boundProfileNames
    };
  });
}

export function buildAdvancedModelRows(providers = []) {
  return normalizeArray(providers).flatMap((provider) => normalizeArray(provider?.models).map((model) => ({
    providerId: String(provider?.id || '').trim(),
    providerName: String(provider?.name || '').trim(),
    modelId: String(model?.id || '').trim(),
    modelName: String(model?.modelName || '').trim(),
    enabled: model?.enabled !== false,
    concurrencyLimit: model?.concurrencyLimit ?? 1,
    retryEnabled: model?.retryEnabled !== false,
    retryAttempts: model?.retryAttempts ?? 2,
    rateLimitHint: String(model?.rateLimitHint || ''),
    promptCacheEnabled: model?.promptCacheEnabled === true,
    promptCacheTtlHint: String(model?.promptCacheTtlHint || ''),
    responseFormat: String(model?.responseFormat || ''),
    notes: String(model?.notes || '')
  })));
}

export function buildProviderModelTableRows(provider = {}) {
  const defaultModelId = String(provider?.defaultModelId || '').trim();

  return normalizeArray(provider?.models).map((model) => ({
    ...model,
    isDefault: String(model?.id || '').trim() === defaultModelId
  }));
}
