import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppstoreOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FileSearchOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Dropdown,
  Drawer,
  Empty,
  Input,
  Layout,
  List,
  message,
  Menu,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd';
import {
  createDraftEntry,
  discardDraftEntry,
  getResolvedRecords,
  hasDraftChanges,
  rebaseDraftEntries,
  updateDraftEntry
} from './editorDrafts.mjs';
import {
  buildDefaultPresetProfile,
  buildHistoryPromptItems,
  getHistoryContextSources,
  getHistoryRenderedSystemPrompt,
  getHistoryRenderedUserPrompt,
  shouldShowHistoryActualSentContent
} from './appShell.mjs';
import {
  formatTimestampForLocalDisplay,
  parseDateInputToEpochMs
} from './timeFormatting.mjs';
import { useI18n } from './i18n';
import { ProvidersPage } from './pages/providers';
import { BuilderPage } from './pages/builder';
import AssetsPage from './pages/assets/AssetsPage.jsx';

const { Content, Header, Sider } = Layout;
const { Text, Title } = Typography;
const DEFAULT_MEMOQ_VERSIONS = ['10', '11', '12'];
const EMPTY_HISTORY_FILTERS = {
  search: '',
  projectId: '',
  subject: '',
  provider: '',
  model: '',
  status: '',
  dateFrom: '',
  dateTo: ''
};
const DEFAULT_PROVIDER_TEST_STATE = {
  fingerprint: '',
  status: 'not_tested',
  message: '',
  testedAt: '',
  latencyMs: null
};
const CONNECTION_SENSITIVE_PROVIDER_FIELDS = new Set(['apiKey', 'baseUrl', 'requestPath', 'type']);
const CONNECTION_INVALIDATING_PROVIDER_FIELDS = new Set(['apiKey', 'baseUrl', 'requestPath', 'type', 'modelsConnection']);
const TEMPLATE_PLACEHOLDER_PATTERN = /{{\s*([a-z-]+)(!)?\s*}}/g;
const WIDE_SIDE_DRAWER_WIDTH = '68vw';
const TRANSLATION_STYLE_PRESETS = [
  {
    key: 'natural',
    text: 'Prefer natural, concise, production-ready translations that stay consistent with product terminology.'
  },
  {
    key: 'formal',
    text: 'Prefer formal, precise wording with a professional tone and stable terminology.'
  },
  {
    key: 'technical',
    text: 'Prefer technically accurate, explicit phrasing that preserves instructions, constraints, and domain terminology.'
  },
  {
    key: 'marketing',
    text: 'Prefer fluent, appealing copy that reads naturally to end users while keeping required terms intact.'
  },
  {
    key: 'ui',
    text: 'Prefer short, clear UI-style wording suitable for buttons, menus, labels, and product microcopy.'
  }
];

function useDesktopApi() {
  return window.memoqDesktop;
}

function createFallbackAppState() {
  return {
    productName: 'memoQ AI Hub',
    contractVersion: '1',
    gatewayBaseUrl: '',
    startup: { status: 'starting', message: '' },
    dashboard: {
      checklist: [],
      runtimeStatus: {
        memoqInstallPath: '',
        pluginStatus: '',
        connectionStatus: 'Disconnected',
        previewStatus: {
          status: 'disconnected',
          statusMessage: '',
          serviceBaseUrl: '',
          sessionId: '',
          callbackAddress: '',
          connectedAt: '',
          lastUpdatedAt: '',
          lastError: '',
          activePreviewPartId: '',
          activePreviewPartCount: 0,
          cachedPreviewPartCount: 0,
          sourceDocumentName: '',
          sourceDocumentGuid: ''
        }
      },
      notices: []
    },
    integration: {
      memoqVersion: '11',
      customInstallDir: '',
      selectedInstallDir: '',
      status: 'not_installed',
      installations: []
    },
    previewBridge: {
      status: 'disconnected',
      statusMessage: '',
      serviceBaseUrl: '',
      sessionId: '',
      callbackAddress: '',
      connectedAt: '',
      lastUpdatedAt: '',
      lastError: '',
      activePreviewPartId: '',
      activePreviewPartCount: 0,
      cachedPreviewPartCount: 0,
      sourceDocumentName: '',
      sourceDocumentGuid: ''
    },
    contextBuilder: { profiles: [], defaultProfileId: '', assets: [], supportedPlaceholders: [], assetImportRules: {} },
    memoqMetadataMapping: { rules: [] },
    providerHub: { providers: [], summary: { enabled: 0, healthy: 0 } },
    historyExplorer: { items: [] }
  };
}

function normalizeAppStatePayload(data = {}) {
  const fallback = createFallbackAppState();
  const nextState = data && typeof data === 'object' ? data : {};

  return {
    ...fallback,
    ...nextState,
    startup: {
      ...fallback.startup,
      ...(nextState.startup || {})
    },
    dashboard: {
      ...fallback.dashboard,
      ...(nextState.dashboard || {}),
      checklist: Array.isArray(nextState.dashboard?.checklist) ? nextState.dashboard.checklist : fallback.dashboard.checklist,
      notices: Array.isArray(nextState.dashboard?.notices) ? nextState.dashboard.notices : fallback.dashboard.notices,
      runtimeStatus: {
        ...fallback.dashboard.runtimeStatus,
        ...(nextState.dashboard?.runtimeStatus || {}),
        previewStatus: {
          ...fallback.dashboard.runtimeStatus.previewStatus,
          ...(nextState.dashboard?.runtimeStatus?.previewStatus || {})
        }
      }
    },
    integration: {
      ...fallback.integration,
      ...(nextState.integration || {}),
      installations: Array.isArray(nextState.integration?.installations) ? nextState.integration.installations : fallback.integration.installations
    },
    previewBridge: {
      ...fallback.previewBridge,
      ...(nextState.previewBridge || {})
    },
    contextBuilder: {
      ...fallback.contextBuilder,
      ...(nextState.contextBuilder || {}),
      profiles: Array.isArray(nextState.contextBuilder?.profiles) ? nextState.contextBuilder.profiles : fallback.contextBuilder.profiles,
      defaultProfileId: String(nextState.contextBuilder?.defaultProfileId || ''),
      assets: Array.isArray(nextState.contextBuilder?.assets) ? nextState.contextBuilder.assets : fallback.contextBuilder.assets,
      supportedPlaceholders: Array.isArray(nextState.contextBuilder?.supportedPlaceholders)
        ? nextState.contextBuilder.supportedPlaceholders
        : fallback.contextBuilder.supportedPlaceholders,
      assetImportRules: nextState.contextBuilder?.assetImportRules && typeof nextState.contextBuilder.assetImportRules === 'object'
        ? nextState.contextBuilder.assetImportRules
        : fallback.contextBuilder.assetImportRules
    },
    memoqMetadataMapping: {
      ...fallback.memoqMetadataMapping,
      ...(nextState.memoqMetadataMapping || {}),
      rules: Array.isArray(nextState.memoqMetadataMapping?.rules) ? nextState.memoqMetadataMapping.rules : fallback.memoqMetadataMapping.rules
    },
    providerHub: {
      ...fallback.providerHub,
      ...(nextState.providerHub || {}),
      providers: Array.isArray(nextState.providerHub?.providers) ? nextState.providerHub.providers : fallback.providerHub.providers,
      summary: {
        ...fallback.providerHub.summary,
        ...(nextState.providerHub?.summary || {})
      }
    },
    historyExplorer: {
      ...fallback.historyExplorer,
      ...(nextState.historyExplorer || {}),
      items: Array.isArray(nextState.historyExplorer?.items) ? nextState.historyExplorer.items : fallback.historyExplorer.items
    }
  };
}

function createBlankProfile() {
  return buildDefaultPresetProfile();
}

function createEmptyProfileDraft() {
  return {
    name: 'New Profile',
    description: '',
    translationStyle: 'Prefer natural, concise, production-ready translations that stay consistent with product terminology.',
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

function resolveSelectedRecordId(items = [], currentId = '', fallbackId = '') {
  const normalizedCurrentId = String(currentId || '').trim();
  if (items.some((item) => item.id === normalizedCurrentId)) {
    return normalizedCurrentId;
  }

  const normalizedFallbackId = String(fallbackId || '').trim();
  if (items.some((item) => item.id === normalizedFallbackId)) {
    return normalizedFallbackId;
  }

  return items[0]?.id || '';
}

function createProviderDraft(type) {
  const drafts = {
    openai: {
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [createDraftProviderModel('gpt-4.1-mini')]
    },
    'openai-compatible': {
      name: 'OpenAI Compatible',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      requestPath: '/responses',
      models: [createDraftProviderModel('gpt-4.1-mini')]
    }
  };

  return {
    ...(drafts[type] || drafts.openai),
    enabled: true
  };
}

function getRuntimeConnectionColor(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'connected') return 'green';
  if (normalized === 'starting' || normalized === 'connecting') return 'gold';
  if (normalized === 'error') return 'red';
  if (normalized === 'idle' || normalized === 'missing' || normalized === 'disconnected') return 'default';
  return 'default';
}

function getRuntimeConnectionLabel(status, t) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'connected') return t('dashboard.connectionConnected');
  if (normalized === 'starting' || normalized === 'connecting') return t('dashboard.connectionStarting');
  if (normalized === 'error') return t('dashboard.connectionError');
  if (normalized === 'idle' || normalized === 'missing' || normalized === 'disconnected') return t('dashboard.connectionDisconnected');
  if (normalized === 'disconnected') return t('dashboard.connectionDisconnected');
  return t('dashboard.connectionUnknown');
}

function normalizeProviderStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'connected' || normalized === 'failed' || normalized === 'testing' || normalized === 'not_tested') {
    return normalized;
  }
  if (normalized === 'healthy') return 'connected';
  if (normalized === 'needs_attention') return 'failed';
  if (normalized === 'idle') return 'not_tested';
  return 'not_tested';
}

function getPresetInstallDir(version) {
  return `C:\\Program Files\\memoQ\\memoQ-${version}`;
}

function normalizeInstallOption(option = {}) {
  const versionCandidate = String(option.memoqVersion || option.version || '').trim();
  const versionMatch = versionCandidate.match(/\d+/)?.[0] || '';
  const selectedInstallDir = String(option.selectedInstallDir || option.installDir || option.rootDir || option.path || '').trim();
  const version = DEFAULT_MEMOQ_VERSIONS.includes(versionCandidate)
    ? versionCandidate
    : (DEFAULT_MEMOQ_VERSIONS.includes(versionMatch) ? versionMatch : versionCandidate);

  return {
    version,
    selectedInstallDir: selectedInstallDir || (version ? getPresetInstallDir(version) : ''),
    label: option.label || (version ? `memoQ ${version}` : selectedInstallDir || '')
  };
}

function buildInstallOptions(integration = {}) {
  const remoteOptions = Array.isArray(integration.defaultInstallOptions)
    ? integration.defaultInstallOptions.map(normalizeInstallOption).filter((option) => option.version || option.selectedInstallDir)
    : [];

  if (remoteOptions.length) {
    return remoteOptions;
  }

  return DEFAULT_MEMOQ_VERSIONS.map((version) => ({
    version,
    selectedInstallDir: getPresetInstallDir(version),
    label: `memoQ ${version}`
  }));
}

function buildInstallDraft(integration = {}) {
  const installOptions = buildInstallOptions(integration);
  const selectedInstallDir = String(integration.selectedInstallDir || '').trim();
  const customInstallDir = String(integration.customInstallDir || '').trim();
  const versionCandidate = String(integration.memoqVersion || '').trim();
  const matchedOption = installOptions.find((option) => option.selectedInstallDir === selectedInstallDir || option.version === versionCandidate);
  const version = matchedOption?.version || (DEFAULT_MEMOQ_VERSIONS.includes(versionCandidate) ? versionCandidate : '11');
  const presetInstallDir = getPresetInstallDir(version);
  const isCustom = Boolean(customInstallDir) || (selectedInstallDir && selectedInstallDir !== presetInstallDir);
  const finalSelectedInstallDir = isCustom ? (selectedInstallDir || customInstallDir || '') : presetInstallDir;

  return {
    mode: isCustom ? 'custom' : 'preset',
    memoqVersion: version,
    selectedInstallDir: finalSelectedInstallDir,
    customInstallDir: isCustom ? (customInstallDir || selectedInstallDir || finalSelectedInstallDir) : ''
  };
}

function getStatusTagMeta(status, t) {
  const normalized = normalizeProviderStatus(status);
  switch (normalized) {
    case 'connected':
      return { color: 'green', label: t('providers.statusConnected') };
    case 'failed':
      return { color: 'red', label: t('providers.statusFailed') };
    case 'testing':
      return { color: 'gold', label: t('providers.statusTesting') };
    default:
      return { color: 'default', label: t('providers.statusNotTested') };
  }
}

function getProviderTypeLabel(type, t) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'openai-compatible') return t('providers.typeOpenAICompatible');
  if (normalized === 'openai') return t('providers.typeOpenAI');
  return t('providers.typeCustom');
}

function getProviderModelCount(provider) {
  return Array.isArray(provider?.models) ? provider.models.length : 0;
}

function getEnabledModelCount(provider) {
  return Array.isArray(provider?.models)
    ? provider.models.filter((model) => model?.enabled !== false).length
    : 0;
}

function createDraftModelId() {
  return `draft_model_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createDraftProviderModel(modelName = 'gpt-4.1-mini') {
  return {
    id: createDraftModelId(),
    modelName: String(modelName || 'gpt-4.1-mini').trim() || 'gpt-4.1-mini',
    enabled: true,
    concurrencyLimit: 1,
    rateLimitHint: '',
    retryEnabled: true,
    retryAttempts: 2,
    promptCacheEnabled: false,
    promptCacheTtlHint: '',
    notes: ''
  };
}

function getPreferredProviderModel(provider, preferredModelId = '') {
  const models = Array.isArray(provider?.models) ? provider.models : [];
  const preferredId = String(preferredModelId || provider?.defaultModelId || '').trim();

  if (preferredId) {
    const explicit = models.find((model) => model?.id === preferredId && model?.enabled !== false);
    if (explicit) {
      return explicit;
    }
  }

  return models.find((model) => model?.enabled !== false)
    || models[0]
    || null;
}

function buildProviderModelCatalog(provider = {}, discoveredModels = []) {
  const discoveredNames = Array.isArray(discoveredModels)
    ? discoveredModels.map((model) => String(model?.modelName || model || '').trim()).filter(Boolean)
    : [];
  const configuredNames = Array.isArray(provider?.models)
    ? provider.models.map((model) => String(model?.modelName || '').trim()).filter(Boolean)
    : [];

  return Array.from(new Set([...configuredNames, ...discoveredNames]))
    .sort((left, right) => left.localeCompare(right));
}

function buildProviderRequestPreview(provider = {}) {
  const normalized = String(provider.baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalized) {
    return '';
  }
  const type = String(provider.type || '').trim().toLowerCase();
  if (type === 'openai-compatible') {
    const requestPath = String(provider.requestPath || '/responses').trim().replace(/^\/+/, '');
    return requestPath ? `${normalized}/${requestPath}` : normalized;
  }
  return `${normalized}/responses`;
}

function createEmptyHistoryFilters() {
  return { ...EMPTY_HISTORY_FILTERS };
}

function normalizeFilterText(value) {
  return String(value || '').trim().toLowerCase();
}

function getProfileProviderId(profile = {}) {
  return String(
    profile.providerId
    || profile.interactiveProviderId
    || profile.pretranslateProviderId
    || profile.fallbackProviderId
    || ''
  ).trim();
}

function applyProfileProviderId(profile = {}, providerId = '') {
  const normalized = String(providerId || '').trim();
  return {
    ...profile,
    providerId: normalized,
    interactiveProviderId: normalized,
    pretranslateProviderId: normalized,
    fallbackProviderId: normalized
  };
}

function buildExecutionOptionValue(providerId, modelId) {
  return `${String(providerId || '').trim()}::${String(modelId || '').trim()}`;
}

function isSelectableProfileProvider(provider = {}) {
  return Boolean(provider?.id) && !isDraftProvider(provider);
}

function getProfileExecutionSelection(profile = {}) {
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

function applyProfileExecutionSelection(profile = {}, value = '') {
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

function parseFilterDate(value, endOfDay = false) {
  return parseDateInputToEpochMs(value, { endOfDay });
}

function formatLocalTimestamp(value, fallback = '-') {
  return formatTimestampForLocalDisplay(value, { fallback });
}

function filterHistoryItems(items = [], filters = {}) {
  const search = normalizeFilterText(filters.search);
  const projectId = normalizeFilterText(filters.projectId);
  const subject = normalizeFilterText(filters.subject);
  const provider = normalizeFilterText(filters.provider);
  const model = normalizeFilterText(filters.model);
  const status = normalizeFilterText(filters.status);
  const dateFrom = parseFilterDate(filters.dateFrom);
  const dateTo = parseFilterDate(filters.dateTo, true);

  return items.filter((item) => {
    const searchableText = JSON.stringify({
      requestId: item.requestId || '',
      projectId: item.projectId || '',
      subject: item.subject || '',
      providerName: item.providerName || '',
      model: item.model || '',
      status: item.status || '',
      segments: item.segments || []
    }).toLowerCase();

    if (search && !searchableText.includes(search)) {
      return false;
    }

    if (projectId && !String(item.projectId || '').toLowerCase().includes(projectId)) {
      return false;
    }

    if (subject && !String(item.subject || '').toLowerCase().includes(subject)) {
      return false;
    }

    if (provider && !String(item.providerName || item.providerId || '').toLowerCase().includes(provider)) {
      return false;
    }

    if (model && !String(item.model || '').toLowerCase().includes(model)) {
      return false;
    }

    if (status && String(item.status || '').toLowerCase() !== status) {
      return false;
    }

    const submittedAtTime = new Date(item.submittedAt || '').getTime();
    if (dateFrom && Number.isFinite(submittedAtTime) && submittedAtTime < dateFrom) {
      return false;
    }

    if (dateTo && Number.isFinite(submittedAtTime) && submittedAtTime > dateTo) {
      return false;
    }

    return true;
  });
}

function isDraftProvider(provider) {
  return String(provider?.id || '').startsWith('draft_provider_');
}

function buildProviderFingerprint(provider) {
  if (!provider) return '';

  return JSON.stringify({
    name: provider.name || '',
    type: provider.type || '',
    baseUrl: provider.baseUrl || '',
    requestPath: provider.requestPath || '',
    defaultModelId: provider.defaultModelId || '',
    enabled: provider.enabled !== false,
    apiKey: provider.apiKey || '',
    models: (provider.models || []).map((model) => ({
      id: model.id || '',
      modelName: model.modelName || '',
      enabled: model.enabled !== false,
      concurrencyLimit: model.concurrencyLimit ?? 1,
      rateLimitHint: model.rateLimitHint || '',
      retryEnabled: model.retryEnabled !== false,
      retryAttempts: model.retryAttempts ?? 2,
      promptCacheEnabled: model.promptCacheEnabled === true,
      promptCacheTtlHint: model.promptCacheTtlHint || '',
      notes: model.notes || ''
    }))
  });
}

function buildProfileFingerprint(profile) {
  if (!profile) return '';

  return JSON.stringify({
    name: profile.name || '',
    description: profile.description || '',
    translationStyle: profile.translationStyle || '',
    useBestFuzzyTm: profile.useBestFuzzyTm !== false,
    useMetadata: profile.useMetadata !== false,
    useUploadedGlossary: profile.useUploadedGlossary !== false,
    useCustomTm: profile.useCustomTm !== false,
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

function buildAssetSelectionsFromBindings(assetBindings = []) {
  const nextSelections = {};
  for (const binding of Array.isArray(assetBindings) ? assetBindings : []) {
    const assetId = String(binding?.assetId || '').trim();
    const purpose = String(binding?.purpose || '').trim();
    if (!assetId || !purpose) {
      continue;
    }
    if (purpose === 'glossary' && !nextSelections.glossaryAssetId) {
      nextSelections.glossaryAssetId = assetId;
    }
  }
  return nextSelections;
}

function buildAssetBindingsFromSelections(assetSelections = {}) {
  const nextBindings = [];
  const glossaryAssetId = String(assetSelections?.glossaryAssetId || '').trim();

  if (glossaryAssetId) {
    nextBindings.push({ assetId: glossaryAssetId, purpose: 'glossary' });
  }

  return nextBindings;
}

function buildHistorySegments(record) {
  if (Array.isArray(record?.segments) && record.segments.length) {
    return record.segments.map((segment, index) => ({
      segmentIndex: segment.segmentIndex ?? index,
      segmentId: segment.segmentId || '',
      segmentStatus: segment.segmentStatus ?? '',
      source: segment.sourceText || segment.source || '',
      target: segment.targetText || segment.target || '',
      tmSource: segment.tmSource || '',
      tmTarget: segment.tmTarget || ''
    }));
  }

  const metadataSegments = record?.metadata?.segmentLevelMetadata || [];
  const translations = record?.result?.translations || [];

  return metadataSegments.map((segment, index) => ({
    segmentIndex: segment.segmentIndex ?? index,
    segmentId: segment.segmentId || '',
    segmentStatus: segment.segmentStatus ?? '',
    source: segment.source || '',
    target: translations.find((translation) => Number(translation.index) === index)?.text || '',
    tmSource: segment.tmSource || '',
    tmTarget: segment.tmTarget || ''
  }));
}

function buildAssetPreviewRows(preview) {
  if (!Array.isArray(preview?.rows)) {
    return [];
  }

  return preview.rows.map((row, index) => ({ key: row?.id || `row-${index}`, ...row }));
}

function formatAssetPreviewMapping(mapping = {}) {
  return Object.entries(mapping)
    .map(([role, meta]) => ({
      key: role,
      role,
      columnName: meta?.columnName || '-',
      confidence: meta?.confidence || 'low'
    }));
}

function getAssetPreviewConfidenceLabel(t, confidence = {}) {
  const level = String(confidence?.level || 'low');
  return t(`context.assetPreviewConfidence.${level}`);
}

function hasTbStructurePreview(preview = {}) {
  return preview?.assetType === 'glossary' && preview?.tbStructureAvailable === true;
}

function canApplyTbStructurePreview(preview = {}) {
  return hasTbStructurePreview(preview)
    && preview?.tbStructureApplied !== true
    && String(preview?.tbStructuringMode || '').trim() !== 'manual_mapping';
}

function getLocalizedPlaceholderText(t, item, kind) {
  const key = `context.placeholder${kind}.${item.token}`;
  const localized = t(key);
  return localized === key ? item[kind.toLowerCase()] : localized;
}

function EditableProfileForm({
  profile,
  providers,
  assets,
  assetImportRules,
  supportedPlaceholders,
  templateIssues,
  onChange,
  onSave,
  onDiscard,
  onDuplicate,
  onDelete,
  onInsertPlaceholder,
  onImportAsset,
  onDeleteAsset,
  onToggleAssetBinding
}) {
  const { t } = useI18n();
  const providerOptions = providers
    .filter((provider) => isSelectableProfileProvider(provider))
    .map((provider) => ({ label: provider.name, value: provider.id }));
  const selectedProviderId = getProfileProviderId(profile);
  const executionSelection = getProfileExecutionSelection(profile);
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId && isSelectableProfileProvider(provider)) || null;
  const preferredExecutionModel = getPreferredProviderModel(selectedProvider);
  const selectedExecutionModelId = executionSelection?.split('::')[1] || '';
  const visibleExecutionModelId = (selectedProvider?.models || []).some((model) => model.id === selectedExecutionModelId && model.enabled !== false)
    ? selectedExecutionModelId
    : (preferredExecutionModel?.id || undefined);
  const executionModelOptions = (selectedProvider?.models || [])
    .filter((model) => model?.enabled !== false)
    .map((model) => ({ label: model.modelName, value: model.id }));
  const boundAssetIds = new Set((profile?.assetBindings || []).map((binding) => binding.assetId));
  const assetRows = Array.isArray(assets) ? assets : [];
  const toggleItems = [
    { field: 'useBestFuzzyTm', label: t('context.bestFuzzyLabel'), hint: t('context.bestFuzzyHint'), checked: profile?.useBestFuzzyTm },
    { field: 'useMetadata', label: t('context.metadataLabel'), hint: t('context.metadataHint'), checked: profile?.useMetadata },
    { field: 'cacheEnabled', label: t('context.cacheLabel'), hint: t('context.cacheHint'), checked: profile?.cacheEnabled !== false },
    { field: 'usePreviewContext', label: t('context.previewContextLabel'), hint: t('context.previewContextToggleHint'), checked: profile?.usePreviewContext === true },
    { field: 'usePreviewFullText', label: t('context.previewFullTextLabel'), hint: t('context.previewFullTextHint'), checked: profile?.usePreviewFullText === true, disabled: profile?.usePreviewContext !== true },
    { field: 'usePreviewSummary', label: t('context.previewSummaryLabel'), hint: t('context.previewSummaryHint'), checked: profile?.usePreviewSummary === true, disabled: profile?.usePreviewContext !== true },
    { field: 'usePreviewAboveBelow', label: t('context.previewWindowLabel'), hint: t('context.previewWindowHint'), checked: profile?.usePreviewAboveBelow === true, disabled: profile?.usePreviewContext !== true },
    { field: 'usePreviewTargetText', label: t('context.currentTargetLabel'), hint: t('context.currentTargetHint'), checked: profile?.usePreviewTargetText === true, disabled: profile?.usePreviewContext !== true }
  ];

  return (
    <Card
      className="page-card"
      title={t('context.profileEditor')}
      extra={(
        <Space>
          <Button onClick={onDuplicate}>{t('common.duplicate')}</Button>
          <Button onClick={onDiscard}>{t('context.discardChanges')}</Button>
          <Button danger onClick={onDelete}>{t('context.deleteProfile')}</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={onSave}>{t('context.saveProfile')}</Button>
        </Space>
      )}
    >
      <Space direction="vertical" size={18} style={{ display: 'flex' }}>
        <Row gutter={16}>
          <Col span={12}>
            <Input addonBefore={t('context.name')} value={profile?.name} onChange={(event) => onChange('name', event.target.value)} />
          </Col>
          <Col span={12}>
            <Input addonBefore={t('context.description')} value={profile?.description} onChange={(event) => onChange('description', event.target.value)} />
          </Col>
        </Row>

        <Space direction="vertical" size={8} style={{ display: 'flex' }}>
          <Text strong>{t('context.executionProvider')}</Text>
          <Select
            style={{ width: '100%' }}
            value={selectedProviderId || undefined}
            options={providerOptions}
            onChange={(value) => onChange('providerId', value)}
            placeholder={t('context.executionProviderPlaceholder')}
          />
          <Text strong>{t('context.executionModel')}</Text>
          <Select
            style={{ width: '100%' }}
            value={visibleExecutionModelId}
            options={executionModelOptions}
            onChange={(modelId) => onChange('executionSelection', buildExecutionOptionValue(selectedProviderId, modelId))}
            placeholder={t('context.executionModelPlaceholder')}
            disabled={!selectedProviderId}
          />
          <Text type="secondary">{t('context.executionProviderHint')}</Text>
        </Space>

        <Alert
          type="info"
          showIcon
          message={t('context.promptManagedTitle')}
          description={t('context.promptManagedDescription')}
        />
        <Space direction="vertical" size={8} style={{ display: 'flex' }}>
          <Text strong>{t('context.translationStyleTitle')}</Text>
          <Text type="secondary">{t('context.translationStyleHint')}</Text>
          <Select
            style={{ width: '100%' }}
            allowClear
            value={TRANSLATION_STYLE_PRESETS.find((item) => item.text === String(profile?.translationStyle || ''))?.key}
            options={TRANSLATION_STYLE_PRESETS.map((item) => ({
              value: item.key,
              label: t(`context.translationStylePreset.${item.key}`)
            }))}
            placeholder={t('context.translationStylePresetPlaceholder')}
            onChange={(value) => {
              const selected = TRANSLATION_STYLE_PRESETS.find((item) => item.key === value);
              if (selected) {
                onChange('translationStyle', selected.text);
              }
            }}
            onClear={() => onChange('translationStyle', '')}
          />
          <Input.TextArea
            rows={4}
            value={profile?.translationStyle || ''}
            onChange={(event) => onChange('translationStyle', event.target.value)}
            placeholder={t('context.translationStylePlaceholder')}
          />
        </Space>
        <Card size="small" title={t('context.promptIncludedTitle')}>
          <Space direction="vertical" size={12} style={{ display: 'flex' }}>
            <Text type="secondary">{t('context.promptIncludedHint')}</Text>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>{t('context.promptIncludedItems.role')}</li>
              <li>{t('context.promptIncludedItems.format')}</li>
              <li>{t('context.promptIncludedItems.terminology')}</li>
              <li>{t('context.promptIncludedItems.metadata')}</li>
              <li>{t('context.promptIncludedItems.summary')}</li>
              <li>{t('context.promptIncludedItems.segmentPayload')}</li>
            </ul>
          </Space>
        </Card>
        <Card size="small" title={t('context.advancedPromptTemplatesLabel')}>
          <Space direction="vertical" size={12} style={{ display: 'flex' }}>
            <Text type="secondary">{t('context.advancedPromptTemplatesHint')}</Text>
            <Alert
              type="info"
              showIcon
              message={t('context.promptManagedTitle')}
              description={t('context.advancedPromptTemplatesHint')}
            />
          </Space>
        </Card>
        <Card size="small" title={t('context.placeholderPanelTitle')}>
          <Space direction="vertical" size={12} style={{ display: 'flex' }}>
            <Text type="secondary">{t('context.placeholderPanelHint')}</Text>
            <List
              size="small"
              dataSource={supportedPlaceholders || []}
              renderItem={(item) => (
                <List.Item>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Text strong>{`{{${item.token}}}`}</Text>
                    <Text>{getLocalizedPlaceholderText(t, item, 'Label')}</Text>
                    <Text type="secondary">{getLocalizedPlaceholderText(t, item, 'Description')}</Text>
                  </Space>
                </List.Item>
              )}
            />
            <Text type="secondary">{t('context.placeholderRequiredHint')}</Text>
            <Text type="secondary">{t('context.placeholderWrapperHint')}</Text>
          </Space>
        </Card>
        <Card size="small" title={t('context.assetLibraryTitle')}>
          <Space direction="vertical" size={12} style={{ display: 'flex' }}>
            <Text type="secondary">{t('context.assetBindingHint')}</Text>
            <Space wrap>
              <Button onClick={() => onImportAsset('glossary')}>{t('context.uploadGlossary')}</Button>
              <Button onClick={() => onImportAsset('custom_tm')}>{t('context.uploadCustomTm')}</Button>
              <Button onClick={() => onImportAsset('brief')}>{t('context.uploadBrief')}</Button>
            </Space>
            <Text type="secondary">
              {t('context.assetAllowedExtensions', {
                glossary: (assetImportRules?.glossary?.extensions || []).join(', '),
                customTm: (assetImportRules?.customTm?.extensions || []).join(', '),
                brief: (assetImportRules?.brief?.extensions || []).join(', ')
              })}
            </Text>
            {assetRows.length === 0 ? (
              <Text type="secondary">{t('context.noAssets')}</Text>
            ) : (
              <List
                size="small"
                dataSource={assetRows}
                renderItem={(asset) => (
                  <List.Item
                    actions={[
                      <Switch
                        key={`bind-${asset.id}`}
                        checked={boundAssetIds.has(asset.id)}
                        onChange={(checked) => onToggleAssetBinding(asset, checked)}
                      />,
                      <Button key={`delete-${asset.id}`} danger type="text" onClick={() => onDeleteAsset(asset.id)}>
                        {t('common.delete')}
                      </Button>
                    ]}
                  >
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Text strong>{asset.name}</Text>
                      <Text type="secondary">{t(`context.assetType.${asset.type}`)}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </Space>
        </Card>

        <Row gutter={[16, 16]}>
          {toggleItems.map((item) => (
            <Col span={12} key={item.field}>
              <div className="profile-toggle-card">
                <div className="profile-toggle-head">
                  <Text strong>{item.label}</Text>
                  <Switch checked={item.checked} disabled={item.disabled} onChange={(checked) => onChange(item.field, checked)} />
                </div>
                <Text type="secondary">{item.hint}</Text>
              </div>
            </Col>
          ))}
        </Row>
        {profile?.usePreviewContext === true && profile?.usePreviewAboveBelow === true && (
          <>
            <Text type="secondary">{t('context.previewContextHint')}</Text>
            <Row gutter={16}>
              <Col span={6}><Input addonBefore={t('context.previewAboveSegments')} value={profile?.previewAboveSegments} onChange={(event) => onChange('previewAboveSegments', Number(event.target.value || 0))} /></Col>
              <Col span={6}><Input addonBefore={t('context.previewAboveCharacters')} value={profile?.previewAboveCharacters} onChange={(event) => onChange('previewAboveCharacters', Number(event.target.value || 0))} /></Col>
              <Col span={6}><Switch checked={profile?.previewAboveIncludeSource === true} onChange={(checked) => onChange('previewAboveIncludeSource', checked)} /> <Text style={{ marginLeft: 8 }}>{t('context.previewAboveIncludeSource')}</Text></Col>
              <Col span={6}><Switch checked={profile?.previewAboveIncludeTarget !== false} onChange={(checked) => onChange('previewAboveIncludeTarget', checked)} /> <Text style={{ marginLeft: 8 }}>{t('context.previewAboveIncludeTarget')}</Text></Col>
            </Row>
            <Row gutter={16}>
              <Col span={6}><Input addonBefore={t('context.previewBelowSegments')} value={profile?.previewBelowSegments} onChange={(event) => onChange('previewBelowSegments', Number(event.target.value || 0))} /></Col>
              <Col span={6}><Input addonBefore={t('context.previewBelowCharacters')} value={profile?.previewBelowCharacters} onChange={(event) => onChange('previewBelowCharacters', Number(event.target.value || 0))} /></Col>
              <Col span={6}><Switch checked={profile?.previewBelowIncludeSource === true} onChange={(checked) => onChange('previewBelowIncludeSource', checked)} /> <Text style={{ marginLeft: 8 }}>{t('context.previewBelowIncludeSource')}</Text></Col>
              <Col span={6}><Switch checked={profile?.previewBelowIncludeTarget !== false} onChange={(checked) => onChange('previewBelowIncludeTarget', checked)} /> <Text style={{ marginLeft: 8 }}>{t('context.previewBelowIncludeTarget')}</Text></Col>
            </Row>
          </>
        )}

      </Space>
    </Card>
  );
}

export default function App() {
  const api = useDesktopApi();
  const { t, locale, setLocale } = useI18n();
  const [activePage, setActivePage] = useState('dashboard');
  const [state, setState] = useState(null);
  const [profileId, setProfileId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [selectedHistoryIds, setSelectedHistoryIds] = useState([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState('');
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState(false);
  const [handshaking, setHandshaking] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const [testingProvider, setTestingProvider] = useState(false);
  const [discoveringProviderModels, setDiscoveringProviderModels] = useState(false);
  const [providerDraftsById, setProviderDraftsById] = useState({});
  const [profileDraftsById, setProfileDraftsById] = useState({});
  const [providerTestStatesById, setProviderTestStatesById] = useState({});
  const [installDraft, setInstallDraft] = useState(() => buildInstallDraft());
  const [installDraftDirty, setInstallDraftDirty] = useState(false);
  const [providerSearch, setProviderSearch] = useState('');
  const [providerModelManagerOpen, setProviderModelManagerOpen] = useState(false);
  const [providerModelSearch, setProviderModelSearch] = useState('');
  const [providerModelSelection, setProviderModelSelection] = useState([]);
  const [discoveredProviderModels, setDiscoveredProviderModels] = useState({});
  const [historyFilterDraft, setHistoryFilterDraft] = useState(() => createEmptyHistoryFilters());
  const [historyFilters, setHistoryFilters] = useState(() => createEmptyHistoryFilters());
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [assetPreviewOpen, setAssetPreviewOpen] = useState(false);
  const [assetPreviewLoading, setAssetPreviewLoading] = useState(false);
  const [assetPreviewRecord, setAssetPreviewRecord] = useState(null);
  const [assetPreviewData, setAssetPreviewData] = useState(null);
  const [assetPreviewManualDraft, setAssetPreviewManualDraft] = useState({
    srcColumn: '',
    tgtColumn: '',
    sourceLanguage: '',
    targetLanguage: ''
  });
  const [assetPreviewSaving, setAssetPreviewSaving] = useState(false);
  const providerDraftsRef = useRef(providerDraftsById);
  const profileDraftsRef = useRef(profileDraftsById);

  providerDraftsRef.current = providerDraftsById;
  profileDraftsRef.current = profileDraftsById;

  const navItems = [
    { key: 'dashboard', label: <span className="app-nav-label">{t('nav.dashboard')}</span>, title: t('nav.dashboard'), icon: <AppstoreOutlined className="app-nav-icon" /> },
    { key: 'builder', label: <span className="app-nav-label">{t('nav.builder')}</span>, title: t('nav.builder'), icon: <DeploymentUnitOutlined className="app-nav-icon" /> },
    { key: 'assets', label: <span className="app-nav-label">{t('nav.assets')}</span>, title: t('nav.assets'), icon: <DatabaseOutlined className="app-nav-icon" /> },
    { key: 'providers', label: <span className="app-nav-label">{t('nav.providers')}</span>, title: t('nav.providers'), icon: <CloudServerOutlined className="app-nav-icon" /> },
    { key: 'history', label: <span className="app-nav-label">{t('nav.history')}</span>, title: t('nav.history'), icon: <FileSearchOutlined className="app-nav-icon" /> }
  ];

  function notifyError(loadError, fallback = t('feedback.actionFailed')) {
    const text = String(loadError?.message || fallback || t('feedback.actionFailed'));
    setError(text);
    message.error(text);
  }

  async function refresh(filters = {}) {
    try {
      setError('');
      if (!api?.getAppState) {
        throw new Error('Desktop bridge is not available yet.');
      }

      const remoteData = normalizeAppStatePayload(await api.getAppState(filters));
      const providerRebase = rebaseDraftEntries(providerDraftsRef.current, remoteData?.providerHub?.providers || [], buildProviderFingerprint);
      const profileRebase = rebaseDraftEntries(profileDraftsRef.current, remoteData?.contextBuilder?.profiles || [], buildProfileFingerprint);

      setProviderDraftsById(providerRebase.draftsById);
      setProfileDraftsById(profileRebase.draftsById);
      setState(remoteData);

      const resolvedProviders = getResolvedRecords(remoteData?.providerHub?.providers || [], providerRebase.draftsById);
      const resolvedProfiles = getResolvedRecords(remoteData?.contextBuilder?.profiles || [], profileRebase.draftsById);

      setProfileId((current) => resolveSelectedRecordId(
        resolvedProfiles,
        current,
        remoteData?.contextBuilder?.defaultProfileId || ''
      ));
      setProviderId((current) => resolvedProviders.some((item) => item.id === current) ? current : (resolvedProviders[0]?.id || ''));
      setSelectedHistoryId((current) => remoteData?.historyExplorer?.items?.some((item) => item.id === current) ? current : '');

      if (providerRebase.removedIds.length) {
        setProviderTestStatesById((current) => {
          const nextState = { ...current };
          for (const removedId of providerRebase.removedIds) {
            delete nextState[removedId];
          }
          return nextState;
        });
        message.warning(t('feedback.providerDraftRemoved'));
      }

      if (profileRebase.removedIds.length) {
        message.warning(t('feedback.profileDraftRemoved'));
      }
    } catch (loadError) {
      setState((current) => current || normalizeAppStatePayload());
      notifyError(loadError);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (activePage === 'mapping') {
      setActivePage('dashboard');
    }
  }, [activePage]);

  useEffect(() => {
    if (state?.startup?.status !== 'starting') {
      return undefined;
    }

    const timer = window.setInterval(() => {
      refresh();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [state?.startup?.status]);

  useEffect(() => {
    if (state?.startup?.status !== 'ready' || activePage !== 'dashboard') {
      return undefined;
    }

    const timer = window.setInterval(() => {
      refresh();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [state?.startup?.status, activePage]);

  const profileItems = useMemo(
    () => getResolvedRecords(state?.contextBuilder?.profiles || [], profileDraftsById),
    [state?.contextBuilder?.profiles, profileDraftsById],
  );
  const defaultProfileId = String(state?.contextBuilder?.defaultProfileId || '').trim();
  const providerItems = useMemo(
    () => getResolvedRecords(state?.providerHub?.providers || [], providerDraftsById),
    [state?.providerHub?.providers, providerDraftsById],
  );
  const currentProfile = useMemo(
    () => profileItems.find((item) => item.id === resolveSelectedRecordId(profileItems, profileId, defaultProfileId)) || null,
    [defaultProfileId, profileItems, profileId],
  );
  const supportedPlaceholders = state?.contextBuilder?.supportedPlaceholders || [];
  const assetImportRules = state?.contextBuilder?.assetImportRules || {};
  const assets = state?.contextBuilder?.assets || [];
  const currentProfileTemplateIssues = useMemo(() => [], []);
  const currentProvider = useMemo(
    () => providerItems.find((item) => item.id === providerId) || providerItems[0] || null,
    [providerItems, providerId],
  );
  const currentProviderModelCatalog = useMemo(
    () => buildProviderModelCatalog(currentProvider, discoveredProviderModels[currentProvider?.id] || []),
    [currentProvider, discoveredProviderModels],
  );
  const filteredCurrentProviderModelCatalog = useMemo(() => {
    const keyword = normalizeFilterText(providerModelSearch);
    if (!keyword) {
      return currentProviderModelCatalog;
    }

    return currentProviderModelCatalog.filter((modelName) => modelName.toLowerCase().includes(keyword));
  }, [currentProviderModelCatalog, providerModelSearch]);
  const filteredProviders = useMemo(() => {
    const keyword = normalizeFilterText(providerSearch);
    if (!keyword) {
      return providerItems;
    }

    return providerItems.filter((provider) => JSON.stringify({
      name: provider.name || '',
      type: provider.type || '',
      baseUrl: provider.baseUrl || '',
      requestPath: provider.requestPath || '',
      status: provider.status || '',
      models: (provider.models || []).map((model) => model.modelName || '')
    }).toLowerCase().includes(keyword));
  }, [providerItems, providerSearch]);
  const groupedProviders = useMemo(() => {
    const groups = [
      { key: 'openai', label: getProviderTypeLabel('openai', t), items: [] },
      { key: 'openai-compatible', label: getProviderTypeLabel('openai-compatible', t), items: [] }
    ];

    for (const provider of filteredProviders) {
      const group = groups.find((item) => item.key === provider.type) || groups[0];
      group.items.push(provider);
    }

    return groups.filter((group) => group.items.length);
  }, [filteredProviders, t]);
  const currentProviderFingerprint = useMemo(() => buildProviderFingerprint(currentProvider), [currentProvider]);
  const currentProviderDraft = currentProvider ? providerDraftsById[currentProvider.id] : null;
  const currentProviderTestState = currentProvider ? (providerTestStatesById[currentProvider.id] || DEFAULT_PROVIDER_TEST_STATE) : DEFAULT_PROVIDER_TEST_STATE;
  const currentProviderConnectionStatus = useMemo(() => {
    if (!currentProvider) {
      return 'not_tested';
    }

    if (currentProviderDraft && hasDraftChanges(providerDraftsById, currentProvider.id)) {
      if (currentProviderTestState.fingerprint === currentProviderFingerprint) {
        return normalizeProviderStatus(currentProviderTestState.status);
      }

      const invalidatesConnection = (currentProviderDraft.dirtyFields || []).some((field) => CONNECTION_INVALIDATING_PROVIDER_FIELDS.has(field));
      if (invalidatesConnection) {
        return 'not_tested';
      }

      if (currentProviderTestState.status && currentProviderTestState.status !== 'not_tested') {
        return normalizeProviderStatus(currentProviderTestState.status);
      }

      return normalizeProviderStatus(currentProvider.status);
    }

    return normalizeProviderStatus(currentProvider.status);
  }, [currentProvider, currentProviderDraft, currentProviderFingerprint, currentProviderTestState, providerDraftsById]);
  const currentProviderConnectionMeta = getStatusTagMeta(currentProviderConnectionStatus, t);
  const currentHistoryRecord = useMemo(
    () => state?.historyExplorer?.items?.find((item) => item.id === selectedHistoryId) || null,
    [state, selectedHistoryId],
  );
  const installOptions = useMemo(() => buildInstallOptions(state?.integration || {}), [state]);
  const installPreviewPath = installDraft.mode === 'custom'
    ? installDraft.customInstallDir
    : getPresetInstallDir(installDraft.memoqVersion);
  const visibleDashboardNotices = useMemo(
    () => ((state?.dashboard?.notices) || []).filter((notice) => notice !== 'No mapping rule has been configured yet.'),
    [state]
  );
  const visibleHistoryItems = useMemo(
    () => filterHistoryItems(state?.historyExplorer?.items || [], historyFilters),
    [state, historyFilters]
  );
  const historyFilterProviderOptions = useMemo(() => {
    const values = Array.from(new Set((state?.historyExplorer?.items || []).map((item) => String(item.providerName || '').trim()).filter(Boolean)));
    return values.map((value) => ({ label: value, value }));
  }, [state]);
  const historyFilterModelOptions = useMemo(() => {
    const values = Array.from(new Set((state?.historyExplorer?.items || []).map((item) => String(item.model || '').trim()).filter(Boolean)));
    return values.map((value) => ({ label: value, value }));
  }, [state]);

  useEffect(() => {
    if (!installDraftDirty) {
      setInstallDraft(buildInstallDraft(state?.integration || {}));
    }
  }, [state?.integration, installDraftDirty]);

  useEffect(() => {
    setProviderModelSelection([]);
    setProviderModelSearch('');
  }, [currentProvider?.id]);

  function clearProviderTestState(providerEntryId) {
    const normalizedId = String(providerEntryId || '').trim();
    if (!normalizedId) return;
    setProviderTestStatesById((current) => {
      if (!current[normalizedId]) {
        return current;
      }

      const nextState = { ...current };
      delete nextState[normalizedId];
      return nextState;
    });
  }

  async function patchCurrentProfile(field, value) {
    let nextProfile;
    let dirtyFields = [field];
    if (field === 'providerId') {
      const provider = providerItems.find((item) => item.id === value && isSelectableProfileProvider(item));
      if (!provider) {
        message.error(t('context.executionProviderUnavailable'));
        return;
      }
      const preferredModel = getPreferredProviderModel(provider);
      nextProfile = applyProfileExecutionSelection(currentProfile, buildExecutionOptionValue(value, preferredModel?.id || ''));
      dirtyFields = ['providerId', 'interactiveProviderId', 'interactiveModelId', 'pretranslateProviderId', 'pretranslateModelId', 'fallbackProviderId', 'fallbackModelId'];
    } else if (field === 'executionSelection') {
      nextProfile = applyProfileExecutionSelection(currentProfile, value);
      dirtyFields = ['providerId', 'interactiveProviderId', 'interactiveModelId', 'pretranslateProviderId', 'pretranslateModelId', 'fallbackProviderId', 'fallbackModelId'];
    } else if (['interactiveProviderId', 'pretranslateProviderId', 'fallbackProviderId'].includes(field)) {
      const provider = providerItems.find((item) => item.id === value && isSelectableProfileProvider(item));
      if (!provider) {
        message.error(t('context.executionProviderUnavailable'));
        return;
      }

      const routeModelField = field === 'interactiveProviderId'
        ? 'interactiveModelId'
        : field === 'pretranslateProviderId'
          ? 'pretranslateModelId'
          : 'fallbackModelId';
      const preferredModel = getPreferredProviderModel(provider, currentProfile?.[routeModelField]);
      nextProfile = {
        ...currentProfile,
        [field]: value,
        [routeModelField]: preferredModel?.id || '',
        ...(field === 'interactiveProviderId' || !currentProfile?.providerId ? { providerId: String(value || '').trim() } : {})
      };
      dirtyFields = [field, routeModelField, ...(field === 'interactiveProviderId' || !currentProfile?.providerId ? ['providerId'] : [])];
    } else if (['interactiveModelId', 'pretranslateModelId', 'fallbackModelId'].includes(field)) {
      nextProfile = {
        ...currentProfile,
        [field]: value,
        ...(field === 'interactiveModelId' && currentProfile?.interactiveProviderId ? { providerId: currentProfile.interactiveProviderId } : {})
      };
      dirtyFields = [field, ...(field === 'interactiveModelId' && currentProfile?.interactiveProviderId ? ['providerId'] : [])];
    } else if (field === 'assetBindings') {
      const nextBindings = Array.isArray(value) ? value : [];
      nextProfile = {
        ...currentProfile,
        assetBindings: nextBindings,
        assetSelections: buildAssetSelectionsFromBindings(nextBindings)
      };
      dirtyFields = ['assetBindings', 'assetSelections'];
    } else if (field === 'assetSelections') {
      const nextSelections = value && typeof value === 'object' ? value : {};
      nextProfile = {
        ...currentProfile,
        assetSelections: nextSelections,
        assetBindings: buildAssetBindingsFromSelections(nextSelections)
      };
      dirtyFields = ['assetSelections', 'assetBindings'];
    } else {
      nextProfile = { ...currentProfile, [field]: value };
    }

    setProfileDraftsById((current) => updateDraftEntry(
      current,
      currentProfile,
      () => nextProfile,
      { fingerprintFn: buildProfileFingerprint, dirtyFields }
    ));
  }

  async function saveCurrentProfile() {
    if (!currentProfile) return;
    try {
      const selectedProvider = providerItems.find((provider) => (
        provider.id === getProfileProviderId(currentProfile) && isSelectableProfileProvider(provider)
      ));
      if (getProfileProviderId(currentProfile) && !selectedProvider) {
        throw new Error(t('context.executionProviderUnavailable'));
      }
      const preferredModel = getPreferredProviderModel(selectedProvider);
      const currentExecutionSelection = getProfileExecutionSelection(currentProfile);
      const executionModelId = String(currentExecutionSelection?.split('::')[1] || '').trim();
      const hasValidExecutionModel = selectedProvider && (selectedProvider.models || []).some((model) => model.id === executionModelId && model.enabled !== false);
      const profileToSave = ((!currentExecutionSelection || !hasValidExecutionModel) && selectedProvider && preferredModel)
        ? applyProfileExecutionSelection(currentProfile, buildExecutionOptionValue(selectedProvider.id, preferredModel.id))
        : currentProfile;
      await api.saveProfile(applyProfileProviderId(profileToSave, getProfileProviderId(profileToSave)));
      setProfileDraftsById((current) => discardDraftEntry(current, currentProfile.id));
      message.success(t('feedback.actionSucceeded'));
      await refresh();
    } catch (saveError) {
      notifyError(saveError);
    }
  }

  function discardCurrentProfileChanges() {
    if (!currentProfile) return;
    setProfileDraftsById((current) => discardDraftEntry(current, currentProfile.id));
  }

  async function duplicateCurrentProfile() {
    if (!currentProfile) return;
    try {
      await api.duplicateProfile(currentProfile.id);
      await refresh();
    } catch (duplicateError) {
      notifyError(duplicateError);
    }
  }

  async function setCurrentProfileAsDefault() {
    if (!currentProfile || !api?.setDefaultProfile) return;
    try {
      await api.setDefaultProfile(currentProfile.id);
      await refresh();
      setProfileId(currentProfile.id);
      message.success(t('feedback.actionSucceeded'));
    } catch (setDefaultError) {
      notifyError(setDefaultError);
    }
  }

  async function importAsset(type) {
    try {
      const importedAsset = await api.importAsset(type);
      await refresh();
      setActivePage('assets');
      if (importedAsset?.id) {
        void openAssetPreview(importedAsset.id, { fallbackAsset: importedAsset });
      }
    } catch (assetError) {
      notifyError(assetError);
    }
  }

  async function openAssetPreview(assetId, options = {}) {
    const normalizedAssetId = String(assetId || '').trim();
    if (!normalizedAssetId) {
      return;
    }

    const fallbackAsset = options.fallbackAsset || assets.find((asset) => asset.id === normalizedAssetId) || null;
    setAssetPreviewOpen(true);
    setAssetPreviewRecord(fallbackAsset);
    setAssetPreviewData(null);
    setAssetPreviewManualDraft({
      srcColumn: '',
      tgtColumn: '',
      sourceLanguage: '',
      targetLanguage: ''
    });

    if (typeof api?.getAssetPreview !== 'function') {
      setAssetPreviewData({ unsupported: true });
      return;
    }

    setAssetPreviewLoading(true);
    try {
      const preview = await api.getAssetPreview(normalizedAssetId);
      setAssetPreviewRecord((current) => current || assets.find((asset) => asset.id === normalizedAssetId) || fallbackAsset);
      setAssetPreviewData(preview || {});
      setAssetPreviewManualDraft({
        srcColumn: String(preview?.manualMapping?.srcColumn || ''),
        tgtColumn: String(preview?.manualMapping?.tgtColumn || ''),
        sourceLanguage: String(preview?.languagePair?.source || ''),
        targetLanguage: String(preview?.languagePair?.target || '')
      });
    } catch (previewError) {
      notifyError(previewError);
      setAssetPreviewData({ error: String(previewError?.message || '') });
    } finally {
      setAssetPreviewLoading(false);
    }
  }

  function toggleAssetBinding(asset, checked) {
    if (!currentProfile || !asset?.id) {
      return;
    }

    const existing = Array.isArray(currentProfile.assetBindings) ? currentProfile.assetBindings : [];
    const nextBindings = checked
      ? [...existing.filter((binding) => binding.assetId !== asset.id), { assetId: asset.id, purpose: asset.type }]
      : existing.filter((binding) => binding.assetId !== asset.id);

    void patchCurrentProfile('assetBindings', nextBindings);
  }

  async function saveAssetPreviewTbConfig() {
    if (!assetPreviewRecord?.id || typeof api?.saveAssetTbConfig !== 'function') {
      return;
    }

    setAssetPreviewSaving(true);
    try {
      await api.saveAssetTbConfig(assetPreviewRecord.id, {
        manualMapping: {
          srcColumn: assetPreviewManualDraft.srcColumn,
          tgtColumn: assetPreviewManualDraft.tgtColumn
        },
        languagePair: {
          source: assetPreviewManualDraft.sourceLanguage,
          target: assetPreviewManualDraft.targetLanguage
        }
      });
      message.success(t('feedback.actionSucceeded'));
      await refresh();
      await openAssetPreview(assetPreviewRecord.id, { fallbackAsset: assetPreviewRecord });
    } catch (saveError) {
      notifyError(saveError);
    } finally {
      setAssetPreviewSaving(false);
    }
  }

  async function applyDetectedAssetPreviewTbStructure() {
    if (!assetPreviewRecord?.id || typeof api?.applyAssetTbStructure !== 'function' || !assetPreviewData?.tbStructure) {
      return;
    }

    setAssetPreviewSaving(true);
    try {
      await api.applyAssetTbStructure(assetPreviewRecord.id, {
        tbStructure: assetPreviewData.tbStructure,
        tbStructureFingerprint: assetPreviewData.tbStructureFingerprint,
        tbStructureSummary: assetPreviewData.tbStructureSummary,
        tbStructureSource: assetPreviewData.tbStructureSource,
        languagePair: assetPreviewData.languagePair,
        tbStructureConfidence: assetPreviewData.tbStructureConfidence
      });
      message.success(t('feedback.actionSucceeded'));
      await refresh();
      await openAssetPreview(assetPreviewRecord.id, { fallbackAsset: assetPreviewRecord });
    } catch (saveError) {
      notifyError(saveError);
    } finally {
      setAssetPreviewSaving(false);
    }
  }

  async function saveCurrentProvider() {
    if (!currentProvider || currentProviderConnectionMeta.color !== 'green') return;
    setSavingProvider(true);
    try {
      const draftProviderId = isDraftProvider(currentProvider) ? currentProvider.id : '';
      const providerPayload = isDraftProvider(currentProvider)
        ? {
          ...currentProvider,
          id: undefined,
          models: currentProvider.models || []
        }
        : currentProvider;
      const savedProvider = await api.saveProvider(providerPayload);
      setProviderDraftsById((current) => discardDraftEntry(current, currentProvider.id));
      clearProviderTestState(currentProvider.id);
      if (draftProviderId) {
        setDiscoveredProviderModels((current) => {
          const nextState = { ...current };
          if (nextState[draftProviderId] && !nextState[savedProvider.id]) {
            nextState[savedProvider.id] = nextState[draftProviderId];
          }
          delete nextState[draftProviderId];
          return nextState;
        });
      }
      setProviderId(savedProvider.id);
      message.success(t('feedback.actionSucceeded'));
      await refresh();
    } catch (saveError) {
      notifyError(saveError);
    } finally {
      setSavingProvider(false);
    }
  }

  async function testProvider() {
    if (!currentProvider) return;
    setTestingProvider(true);
    setProviderTestStatesById((current) => ({
      ...current,
      [currentProvider.id]: {
        fingerprint: currentProviderFingerprint,
        status: 'testing',
        message: '',
        testedAt: '',
        latencyMs: null
      }
    }));
    try {
      const result = await api.testProviderDraft(currentProvider);
      const status = normalizeProviderStatus(result?.status || (result?.ok ? 'connected' : 'failed'));
      setProviderTestStatesById((current) => ({
        ...current,
        [currentProvider.id]: {
          fingerprint: currentProviderFingerprint,
          status,
          message: result?.message || '',
          testedAt: result?.testedAt || '',
          latencyMs: Number.isFinite(result?.latencyMs) ? result.latencyMs : null
        }
      }));
      if (status === 'connected') {
        message.success(result?.message || t('providers.connectionSucceeded'));
      } else {
        message.error(result?.message || t('feedback.actionFailed'));
      }
    } catch (providerError) {
      setProviderTestStatesById((current) => ({
        ...current,
        [currentProvider.id]: {
          fingerprint: currentProviderFingerprint,
          status: 'failed',
          message: String(providerError?.message || t('feedback.actionFailed')),
          testedAt: '',
          latencyMs: null
        }
      }));
      notifyError(providerError);
    } finally {
      setTestingProvider(false);
    }
  }

  async function discoverProviderModels() {
    if (!currentProvider) return;
    setDiscoveringProviderModels(true);
    try {
      const result = await api.discoverProviderModels(currentProvider);
      if (!result?.ok) {
        throw new Error(result?.message || t('providers.modelDiscoveryFailed'));
      }

      const nextModels = (result.models || []).map((model) => String(model?.modelName || model?.id || model || '').trim()).filter(Boolean);
      setDiscoveredProviderModels((current) => ({
        ...current,
        [currentProvider.id]: nextModels
      }));
      message.success(t('providers.modelDiscoverySucceeded', { value: nextModels.length }));
    } catch (discoveryError) {
      notifyError(discoveryError, t('providers.modelDiscoveryFailed'));
    } finally {
      setDiscoveringProviderModels(false);
    }
  }

  async function chooseInstallDirectory() {
    try {
      const directory = await api.pickDirectory();
      if (!directory) {
        return;
      }

      setInstallDraftDirty(true);
      setInstallDraft((current) => ({
        ...current,
        mode: 'custom',
        customInstallDir: directory,
        selectedInstallDir: directory
      }));
    } catch (pickError) {
      notifyError(pickError);
    }
  }

  async function confirmInstallIntegration() {
    const selectedInstallDir = installDraft.mode === 'custom'
      ? String(installDraft.customInstallDir || '').trim()
      : getPresetInstallDir(installDraft.memoqVersion);

    if (!selectedInstallDir) {
      message.error(t('dashboard.installDirectoryRequired'));
      return;
    }

    setInstalling(true);
    try {
      await api.installIntegration({
        memoqVersion: installDraft.memoqVersion,
        selectedInstallDir,
        customInstallDir: installDraft.mode === 'custom' ? selectedInstallDir : ''
      });
      message.success(t('dashboard.installSuccess'));
      setInstallDraftDirty(false);
      await refresh();
    } catch (installError) {
      notifyError(installError);
    } finally {
      setInstalling(false);
    }
  }

  async function testHandshake() {
    setHandshaking(true);
    try {
      const version = await api.testHandshake();
      message.success(`${t('dashboard.handshakeSuccess')} ${version.productName} (${version.contractVersion})`);
      await refresh();
    } catch (handshakeError) {
      notifyError(handshakeError);
    } finally {
      setHandshaking(false);
    }
  }

  const runtimeConnectionStatus = state?.dashboard?.runtimeStatus?.connectionStatus || '';
  const connectionStatusLabel = getRuntimeConnectionLabel(runtimeConnectionStatus, t);
  const connectionStatusColor = getRuntimeConnectionColor(runtimeConnectionStatus);
  const previewBridgeStatus = state?.dashboard?.runtimeStatus?.previewStatus || {};
  const previewBridgeStatusLabel = getRuntimeConnectionLabel(previewBridgeStatus.status, t);
  const selectedInstallVersionOptions = installOptions.map((option) => ({
    label: option.label || `memoQ ${option.version}`,
    value: option.version,
    path: option.selectedInstallDir
  }));

  async function exportHistory(format, scope) {
    try {
      const result = await api.exportHistory({
        format,
        scope,
        selectedIds: selectedHistoryIds,
        filters: scope === 'filtered' ? historyFilters : {}
      });
      message.success(t('history.exportSuccess', { count: result.count, path: result.path }));
    } catch (exportError) {
      notifyError(exportError);
    }
  }

  async function applyHistoryFilters() {
    setHistoryFilters(historyFilterDraft);
    setSelectedHistoryIds([]);
    setSelectedHistoryId('');
    await refresh(historyFilterDraft);
  }

  async function resetHistoryFilters() {
    const emptyFilters = createEmptyHistoryFilters();
    setHistoryFilterDraft(emptyFilters);
    setHistoryFilters(emptyFilters);
    setSelectedHistoryIds([]);
    setSelectedHistoryId('');
    await refresh(emptyFilters);
  }

  function updateCurrentProviderDraft(updater, options = {}) {
    if (!currentProvider) return;
    setProviderDraftsById((current) => updateDraftEntry(
      current,
      currentProvider,
      updater,
      {
        fingerprintFn: buildProviderFingerprint,
        dirtyFields: Array.isArray(options.dirtyFields) ? options.dirtyFields : []
      }
    ));
  }

  function patchCurrentProvider(field, value) {
    if (!currentProvider) return;
    updateCurrentProviderDraft((provider) => {
      const nextProvider = {
        ...provider,
        [field]: value
      };

      if (!CONNECTION_SENSITIVE_PROVIDER_FIELDS.has(field)) {
        return nextProvider;
      }

      return {
        ...nextProvider,
        status: 'not_tested',
        lastError: '',
        lastCheckedAt: '',
        lastLatencyMs: null
      };
    }, { dirtyFields: [field] });

    if (CONNECTION_SENSITIVE_PROVIDER_FIELDS.has(field)) {
      clearProviderTestState(currentProvider.id);
      return;
    }
  }

  function patchCurrentModel(modelId, field, value) {
    if (!currentProvider) return;
    updateCurrentProviderDraft((provider) => ({
      ...provider,
      models: (provider.models || []).map((model) => (
        model.id === modelId ? { ...model, [field]: value } : model
      ))
    }), { dirtyFields: field === 'modelName' ? ['models', 'modelsConnection'] : ['models'] });

    if (field === 'modelName') {
      clearProviderTestState(currentProvider.id);
    }
  }

  function addModelToCurrentProvider(modelName = '') {
    if (!currentProvider) return;
    const normalizedModelName = String(modelName || '').trim() || createProviderDraft(currentProvider.type).models[0]?.modelName || 'gpt-4.1-mini';

    updateCurrentProviderDraft((provider) => {
      const existingModel = (provider.models || []).find((model) => String(model.modelName || '').trim().toLowerCase() === normalizedModelName.toLowerCase());
      if (existingModel) {
        return provider;
      }

      const nextModels = [...(provider.models || []), createDraftProviderModel(normalizedModelName)];
      const nextDefaultModelId = provider.defaultModelId || nextModels[0]?.id || '';

      return {
        ...provider,
        models: nextModels,
        defaultModelId: nextDefaultModelId
      };
    }, { dirtyFields: ['models', 'defaultModelId', 'modelsConnection'] });
    clearProviderTestState(currentProvider.id);
  }

  function removeModelsFromCurrentProvider(modelIds = []) {
    if (!currentProvider) return;
    const normalizedIds = Array.from(new Set((Array.isArray(modelIds) ? modelIds : []).map((item) => String(item || '').trim()).filter(Boolean)));
    if (!normalizedIds.length) {
      return;
    }

    updateCurrentProviderDraft((provider) => {
      const currentModels = Array.isArray(provider.models) ? provider.models : [];
      if (currentModels.length - normalizedIds.length < 1) {
        throw new Error(t('providers.keepOneModel'));
      }

      const nextModels = currentModels.filter((model) => !normalizedIds.includes(model.id));
      const nextDefaultModel = getPreferredProviderModel({ ...provider, models: nextModels }, normalizedIds.includes(provider.defaultModelId) ? '' : provider.defaultModelId);

      return {
        ...provider,
        models: nextModels,
        defaultModelId: nextDefaultModel?.id || ''
      };
    }, { dirtyFields: ['models', 'defaultModelId', 'modelsConnection'] });
    setProviderModelSelection((current) => current.filter((item) => !normalizedIds.includes(item)));
    clearProviderTestState(currentProvider.id);
  }

  function setCurrentProviderDefaultModel(modelId) {
    if (!currentProvider) return;
    updateCurrentProviderDraft((provider) => ({
      ...provider,
      defaultModelId: modelId
    }), { dirtyFields: ['defaultModelId'] });
  }

  function discardCurrentProviderChanges() {
    if (!currentProvider) return;
    const currentProviderId = currentProvider.id;
    const nextProviders = providerItems.filter((item) => item.id !== currentProviderId);

    setProviderDraftsById((current) => discardDraftEntry(current, currentProviderId));
    clearProviderTestState(currentProviderId);
    setDiscoveredProviderModels((current) => {
      if (!current[currentProviderId] || !isDraftProvider(currentProvider)) {
        return current;
      }

      const nextState = { ...current };
      delete nextState[currentProviderId];
      return nextState;
    });

    if (isDraftProvider(currentProvider)) {
      setProviderId(nextProviders[0]?.id || '');
    }
  }

  async function createNewProfile() {
    try {
      const created = await api.saveProfile(createBlankProfile());
      await refresh();
      setProfileId(created.id);
      message.success(t('feedback.profileCreatedFromPreset'));
    } catch (createError) {
      notifyError(createError);
    }
  }

  async function createEmptyProfile() {
    try {
      const created = await api.saveProfile(createEmptyProfileDraft());
      await refresh();
      setProfileId(created.id);
      message.success(t('feedback.actionSucceeded'));
    } catch (createError) {
      notifyError(createError);
    }
  }

  function insertPlaceholderIntoProfile(field, token) {
    if (!currentProfile) {
      return;
    }

    const existing = String(currentProfile[field] || '');
    const needsSpacer = existing && !existing.endsWith('\n') && !existing.endsWith(' ');
    const nextValue = `${existing}${needsSpacer ? '\n' : ''}${token}`;
    void patchCurrentProfile(field, nextValue);
  }

  async function createProvider(type) {
    try {
      const draft = createProviderDraft(type);
      const nextProvider = {
        ...draft,
        id: `draft_provider_${Date.now()}`,
        status: 'not_tested',
        lastCheckedAt: '',
        lastError: '',
        lastLatencyMs: null,
        models: (draft.models || []).map((model, index) => ({
          ...createDraftProviderModel(model.modelName),
          ...model,
          id: `draft_model_${Date.now()}_${index}`
        }))
      };
      nextProvider.defaultModelId = nextProvider.models[0]?.id || '';

      setProviderSearch('');
      setProviderDraftsById((current) => ({
        ...current,
        [nextProvider.id]: createDraftEntry(nextProvider, buildProviderFingerprint, {
          isNew: true,
          dirtyFields: ['name', 'type', 'baseUrl', 'requestPath', 'models', 'defaultModelId', 'enabled']
        })
      }));
      setProviderId(nextProvider.id);
      clearProviderTestState(nextProvider.id);
      message.success(t('providers.providerDraftCreated'));
    } catch (createError) {
      notifyError(createError);
    }
  }

  function handleChecklistAction(key) {
    if (key === 'install-plugin') {
      setActivePage('dashboard');
      return;
    }

    if (key === 'context-builder') {
      setActivePage('builder');
      return;
    }

    if (key === 'provider-hub') {
      setActivePage('providers');
      return;
    }

    setActivePage('history');
  }

  function confirmDeleteProfile() {
    if (!currentProfile) return;
    Modal.confirm({
      title: t('context.deleteProfile'),
      content: t('context.confirmDeleteProfile', { name: currentProfile.name }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.deleteProfile(currentProfile.id);
          message.success(t('context.profileDeleted'));
          await refresh();
        } catch (deleteError) {
          notifyError(deleteError, t('feedback.blockedDelete'));
        }
      }
    });
  }

  function confirmDeleteAsset(assetId) {
    const asset = state?.contextBuilder?.assets?.find((item) => item.id === assetId);
    if (!asset) return;
    Modal.confirm({
      title: t('context.deleteAsset'),
      content: t('context.confirmDeleteAsset', { name: asset.name }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.deleteAsset(assetId);
          message.success(t('context.assetDeleted'));
          await refresh();
        } catch (deleteError) {
          notifyError(deleteError, t('feedback.blockedDelete'));
        }
      }
    });
  }

  function confirmDeleteProvider() {
    if (!currentProvider) return;
    Modal.confirm({
      title: t('providers.deleteProvider'),
      content: t('providers.confirmDeleteProvider', { name: currentProvider.name }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        if (isDraftProvider(currentProvider)) {
          discardCurrentProviderChanges();
          message.success(t('providers.providerDeleted'));
          return;
        }

        try {
          await api.deleteProvider(currentProvider.id);
          message.success(t('providers.providerDeleted'));
          await refresh();
        } catch (deleteError) {
          notifyError(deleteError, t('feedback.blockedDelete'));
        }
      }
    });
  }

  function confirmDeleteModel(model) {
    Modal.confirm({
      title: t('providers.deleteModel'),
      content: t('providers.confirmDeleteModel', { name: model.modelName }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          removeModelsFromCurrentProvider([model.id]);
          message.success(t('providers.modelDeleted'));
        } catch (deleteError) {
          notifyError(deleteError, t('feedback.blockedDelete'));
        }
      }
    });
  }

  function confirmBulkDeleteModels() {
    if (!currentProvider || !providerModelSelection.length) return;
    Modal.confirm({
      title: t('providers.deleteModel'),
      content: t('providers.confirmDeleteModels', { count: providerModelSelection.length }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          removeModelsFromCurrentProvider(providerModelSelection);
          message.success(t('providers.modelsDeleted', { count: providerModelSelection.length }));
        } catch (deleteError) {
          notifyError(deleteError, t('feedback.blockedDelete'));
        }
      }
    });
  }

  if (!state) {
    return <div style={{ padding: 32 }}>{error || t('app.loading')}</div>;
  }

  return (
    <Layout className="app-shell">
      <Sider
        className={`app-sider ${navCollapsed ? 'app-sider-collapsed' : ''}`}
        width={248}
        collapsedWidth={72}
        collapsed={navCollapsed}
        trigger={null}
        theme="light"
        style={{ background: '#ffffff', borderRight: '1px solid #e5e5e5' }}
      >
        <div className={`brand-block ${navCollapsed ? 'brand-block-collapsed' : ''}`}>
          <div className="brand-block-top">
            {!navCollapsed ? <span /> : null}
            <Tooltip title={navCollapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}>
              <Button
                type="text"
                className="app-nav-toggle"
                icon={navCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                aria-label={navCollapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}
                onClick={() => setNavCollapsed((current) => !current)}
              />
            </Tooltip>
          </div>
        </div>
        <Menu
          className="app-nav-menu"
          theme="light"
          mode="inline"
          inlineCollapsed={navCollapsed}
          selectedKeys={[activePage]}
          items={navItems}
          onClick={({ key }) => setActivePage(key)}
          style={{ background: 'transparent' }}
        />
      </Sider>
      <Layout>
        <Header className="app-header" style={{ background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #e5e5e5' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space>
              <Title level={3} style={{ margin: 0 }}>{t('app.title')}</Title>
            </Space>
            <Space>
              <Select
                size="small"
                style={{ width: 110 }}
                value={locale}
                options={[{ value: 'en', label: 'English' }, { value: 'zh-CN', label: '中文' }]}
                onChange={setLocale}
              />
              <Button icon={<ReloadOutlined />} onClick={() => refresh()} disabled={state?.startup?.status === 'starting'}>{t('app.refresh')}</Button>
              <Tag color={connectionStatusColor}>{connectionStatusLabel}</Tag>
            </Space>
          </Space>
        </Header>
        <Content className="content-wrap">
          {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

          {activePage === 'dashboard' && (
            <Space direction="vertical" size={18} style={{ display: 'flex' }}>
              <Row gutter={16}>
                {state.dashboard.checklist.map((item) => (
                  <Col span={6} key={item.key}>
                    <Card className="page-card">
                      <Statistic title={item.title} value={item.subtitle} valueStyle={{ fontSize: 18 }} />
                      <Button type="link" style={{ paddingInline: 0 }} onClick={() => handleChecklistAction(item.key)}>{item.actionLabel}</Button>
                    </Card>
                  </Col>
                ))}
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Card className="page-card" title={t('dashboard.runtimeStatus')}>
                    <Descriptions column={1}>
                      <Descriptions.Item label={t('dashboard.memoqPath')}>{state.dashboard.runtimeStatus.memoqInstallPath}</Descriptions.Item>
                      <Descriptions.Item label={t('dashboard.pluginStatus')}>{state.dashboard.runtimeStatus.pluginStatus}</Descriptions.Item>
                      <Descriptions.Item label={t('dashboard.connectionStatus')}>{connectionStatusLabel}</Descriptions.Item>
                      <Descriptions.Item label={t('dashboard.previewStatus')}>{previewBridgeStatusLabel}</Descriptions.Item>
                      <Descriptions.Item label={t('dashboard.previewLastError')}>{previewBridgeStatus.lastError || '-'}</Descriptions.Item>
                    </Descriptions>
                    <Space style={{ marginTop: 16 }}>
                      <Button loading={handshaking} onClick={testHandshake} disabled={state?.startup?.status !== 'ready'}>{t('dashboard.testConnection')}</Button>
                    </Space>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card className="page-card" title={t('dashboard.installConfig')}>
                    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
                      <Alert type="info" showIcon message={t('dashboard.installDialogHint')} />
                      <Row gutter={12}>
                        <Col span={12}>
                          <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                            <Text strong>{t('dashboard.installMemoqVersion')}</Text>
                            <Select
                              value={installDraft.memoqVersion}
                              options={selectedInstallVersionOptions.map((option) => ({
                                value: option.value,
                                label: option.label
                              }))}
                              onChange={(value) => {
                                setInstallDraftDirty(true);
                                setInstallDraft((current) => ({
                                  ...current,
                                  memoqVersion: value,
                                  selectedInstallDir: current.mode === 'preset' ? getPresetInstallDir(value) : current.selectedInstallDir
                                }));
                              }}
                            />
                          </Space>
                        </Col>
                        <Col span={12}>
                          <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                            <Text strong>{t('dashboard.installMode')}</Text>
                            <Radio.Group
                              value={installDraft.mode}
                              onChange={(event) => {
                                const mode = event.target.value;
                                setInstallDraftDirty(true);
                                setInstallDraft((current) => ({
                                  ...current,
                                  mode,
                                  customInstallDir: mode === 'preset' ? '' : current.customInstallDir,
                                  selectedInstallDir: mode === 'preset'
                                    ? getPresetInstallDir(current.memoqVersion)
                                    : current.selectedInstallDir
                                }));
                              }}
                            >
                              <Radio value="preset">{t('dashboard.installPreset')}</Radio>
                              <Radio value="custom">{t('dashboard.installCustom')}</Radio>
                            </Radio.Group>
                          </Space>
                        </Col>
                      </Row>
                      {installDraft.mode === 'preset' ? (
                        <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                          <Text strong>{t('dashboard.installTargetDir')}</Text>
                          <div className="install-path-preview">{installPreviewPath}</div>
                        </Space>
                      ) : (
                        <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                          <Text strong>{t('dashboard.installTargetDir')}</Text>
                          <Input
                            value={installDraft.customInstallDir}
                            onChange={(event) => {
                              const directory = event.target.value;
                              setInstallDraftDirty(true);
                              setInstallDraft((current) => ({ ...current, customInstallDir: directory, selectedInstallDir: directory }));
                            }}
                            addonAfter={<Button onClick={chooseInstallDirectory}>{t('dashboard.browseDirectory')}</Button>}
                          />
                          <Text type="secondary">{t('dashboard.installCustomHint')}</Text>
                        </Space>
                      )}
                      <Space>
                        <Button loading={installing} type="primary" icon={<DeploymentUnitOutlined />} onClick={confirmInstallIntegration}>
                          {t('dashboard.installReinstall')}
                        </Button>
                      </Space>
                    </Space>
                  </Card>
                </Col>
              </Row>
              <Card className="page-card" title={t('dashboard.notices')}>
                {visibleDashboardNotices.length ? (
                  <List size="small" dataSource={visibleDashboardNotices} renderItem={(item) => <List.Item>{item}</List.Item>} />
                ) : (
                  <Empty description={t('dashboard.noNotices')} />
                )}
              </Card>
            </Space>
          )}

          {activePage === 'builder' && (
            <BuilderPage
              profileItems={profileItems}
              defaultProfileId={defaultProfileId}
              currentProfile={currentProfile}
              providers={providerItems}
              assets={assets}
              supportedPlaceholders={supportedPlaceholders}
              templateIssues={currentProfileTemplateIssues}
              onSelectProfile={setProfileId}
              onCreateBlankProfile={createEmptyProfile}
              onCreatePresetProfile={createNewProfile}
              onChangeProfile={patchCurrentProfile}
              onSaveProfile={saveCurrentProfile}
              onSetDefaultProfile={setCurrentProfileAsDefault}
              onDiscardProfile={discardCurrentProfileChanges}
              onDuplicateProfile={duplicateCurrentProfile}
              onDeleteProfile={confirmDeleteProfile}
              onInsertPlaceholder={insertPlaceholderIntoProfile}
            />
          )}

          {activePage === 'assets' && (
            <AssetsPage
              profileItems={profileItems}
              assets={assets}
              assetImportRules={assetImportRules}
              onImportAsset={importAsset}
              onDeleteAsset={confirmDeleteAsset}
              onPreviewAsset={openAssetPreview}
            />
          )}

          {activePage === 'providers' && (
            <ProvidersPage
              providerItems={providerItems}
              filteredProviders={filteredProviders}
              groupedProviders={groupedProviders}
              currentProvider={currentProvider}
              providerSearch={providerSearch}
              providerModelSelection={providerModelSelection}
              providerModelManagerOpen={providerModelManagerOpen}
              providerModelSearch={providerModelSearch}
              filteredCurrentProviderModelCatalog={filteredCurrentProviderModelCatalog}
              currentProviderConnectionMeta={currentProviderConnectionMeta}
              currentProviderConnectionStatus={currentProviderConnectionStatus}
              savingProvider={savingProvider}
              testingProvider={testingProvider}
              discoveringProviderModels={discoveringProviderModels}
              onCreateProvider={createProvider}
              onSelectProvider={setProviderId}
              onProviderSearchChange={setProviderSearch}
              onPatchProvider={patchCurrentProvider}
              onDiscardProviderChanges={discardCurrentProviderChanges}
              onDeleteProvider={confirmDeleteProvider}
              onSaveProvider={saveCurrentProvider}
              onTestProvider={testProvider}
              onOpenProviderModelManager={() => setProviderModelManagerOpen(true)}
              onCloseProviderModelManager={() => setProviderModelManagerOpen(false)}
              onProviderModelSearchChange={setProviderModelSearch}
              onDiscoverProviderModels={discoverProviderModels}
              onAddModelToCurrentProvider={addModelToCurrentProvider}
              onRemoveModelFromCurrentProvider={(existingModel) => removeModelsFromCurrentProvider([existingModel.id])}
              onProviderModelSelectionChange={setProviderModelSelection}
              onConfirmBulkDeleteModels={confirmBulkDeleteModels}
              onPatchModel={patchCurrentModel}
              onSetCurrentProviderDefaultModel={setCurrentProviderDefaultModel}
              onConfirmDeleteModel={confirmDeleteModel}
              getEnabledModelCount={getEnabledModelCount}
              getProviderModelCount={getProviderModelCount}
              getStatusTagMeta={getStatusTagMeta}
              isDraftProvider={isDraftProvider}
              getProviderTypeLabel={getProviderTypeLabel}
              buildProviderRequestPreview={buildProviderRequestPreview}
              formatLocalTimestamp={formatLocalTimestamp}
            />
          )}

          {activePage === 'history' && (
            <Space direction="vertical" size={18} style={{ display: 'flex' }}>
              <Card
                className="page-card"
                title={t('history.title')}
                extra={<Space><Button onClick={() => exportHistory('csv', 'selected')}>{t('history.exportCsv')}</Button><Button onClick={() => exportHistory('xlsx', 'filtered')}>{t('history.exportXlsx')}</Button></Space>}
              >
                <Space direction="vertical" size={16} style={{ display: 'flex', marginBottom: 16 }}>
                  <Row gutter={12}>
                    <Col span={12}>
                      <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                        <Text strong>{t('history.search')}</Text>
                        <Input.Search
                          allowClear
                          value={historyFilterDraft.search}
                          onChange={(event) => setHistoryFilterDraft((current) => ({ ...current, search: event.target.value }))}
                          onSearch={applyHistoryFilters}
                          placeholder={t('history.searchPlaceholder')}
                        />
                      </Space>
                    </Col>
                    <Col span={6}>
                      <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                        <Text strong>{t('history.providerFilter')}</Text>
                        <Select
                          allowClear
                          showSearch
                          value={historyFilterDraft.provider || undefined}
                          options={historyFilterProviderOptions}
                          onChange={(value) => setHistoryFilterDraft((current) => ({ ...current, provider: value || '' }))}
                          placeholder={t('history.providerPlaceholder')}
                        />
                      </Space>
                    </Col>
                    <Col span={6}>
                      <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                        <Text strong>{t('history.modelFilter')}</Text>
                        <Select
                          allowClear
                          showSearch
                          value={historyFilterDraft.model || undefined}
                          options={historyFilterModelOptions}
                          onChange={(value) => setHistoryFilterDraft((current) => ({ ...current, model: value || '' }))}
                          placeholder={t('history.modelPlaceholder')}
                        />
                      </Space>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col span={6}>
                      <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                        <Text strong>{t('history.projectIdFilter')}</Text>
                        <Input
                          allowClear
                          value={historyFilterDraft.projectId}
                          onChange={(event) => setHistoryFilterDraft((current) => ({ ...current, projectId: event.target.value }))}
                          placeholder={t('history.projectIdPlaceholder')}
                        />
                      </Space>
                    </Col>
                    <Col span={6}>
                      <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                        <Text strong>{t('history.subjectFilter')}</Text>
                        <Input
                          allowClear
                          value={historyFilterDraft.subject}
                          onChange={(event) => setHistoryFilterDraft((current) => ({ ...current, subject: event.target.value }))}
                          placeholder={t('history.subjectPlaceholder')}
                        />
                      </Space>
                    </Col>
                    <Col span={4}>
                      <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                        <Text strong>{t('history.statusFilter')}</Text>
                        <Select
                          allowClear
                          value={historyFilterDraft.status || undefined}
                          options={[
                            { value: 'success', label: t('history.statusSuccess') },
                            { value: 'failed', label: t('history.statusFailed') }
                          ]}
                          onChange={(value) => setHistoryFilterDraft((current) => ({ ...current, status: value || '' }))}
                          placeholder={t('history.statusPlaceholder')}
                        />
                      </Space>
                    </Col>
                    <Col span={4}>
                      <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                        <Text strong>{t('history.dateFrom')}</Text>
                        <Input
                          allowClear
                          value={historyFilterDraft.dateFrom}
                          onChange={(event) => setHistoryFilterDraft((current) => ({ ...current, dateFrom: event.target.value }))}
                          placeholder="YYYY-MM-DD"
                        />
                      </Space>
                    </Col>
                    <Col span={4}>
                      <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                        <Text strong>{t('history.dateTo')}</Text>
                        <Input
                          allowClear
                          value={historyFilterDraft.dateTo}
                          onChange={(event) => setHistoryFilterDraft((current) => ({ ...current, dateTo: event.target.value }))}
                          placeholder="YYYY-MM-DD"
                        />
                      </Space>
                    </Col>
                  </Row>
                  <Space>
                    <Button type="primary" onClick={applyHistoryFilters}>{t('history.applyFilters')}</Button>
                    <Button onClick={resetHistoryFilters}>{t('history.resetFilters')}</Button>
                    <Button onClick={() => refresh(historyFilters)}>{t('app.refresh')}</Button>
                  </Space>
                </Space>
                <Table
                  rowKey="id"
                  rowSelection={{ selectedRowKeys: selectedHistoryIds, onChange: setSelectedHistoryIds }}
                  dataSource={visibleHistoryItems}
                  onRow={(record) => ({
                    onClick: () => setSelectedHistoryId(record.id),
                    style: { cursor: 'pointer' }
                  })}
                  columns={[
                    { title: t('history.submittedId'), dataIndex: 'requestId' },
                    { title: t('common.provider'), dataIndex: 'providerName' },
                    { title: t('history.model'), dataIndex: 'model' },
                    { title: t('history.segmentCount'), dataIndex: 'segmentCount', width: 120 },
                    {
                      title: t('history.status'),
                      dataIndex: 'status',
                      width: 120,
                      render: (value) => <Tag color={value === 'success' ? 'green' : 'red'}>{value === 'success' ? t('history.statusSuccess') : t('history.statusFailed')}</Tag>
                    },
                    {
                      title: t('history.submittedAt'),
                      dataIndex: 'submittedAt',
                      render: (value) => formatLocalTimestamp(value)
                    }
                  ]}
                />
              </Card>
            </Space>
          )}
        </Content>
      </Layout>

      <Drawer
        title={t('history.details')}
        open={Boolean(currentHistoryRecord)}
        onClose={() => setSelectedHistoryId('')}
        width={WIDE_SIDE_DRAWER_WIDTH}
        destroyOnClose
      >
        {currentHistoryRecord ? (
          <Space direction="vertical" size={16} style={{ display: 'flex' }}>
            <Descriptions bordered column={1} size="small">
              <Descriptions.Item label={t('history.submittedId')}>{currentHistoryRecord.requestId || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('history.projectId')}>{currentHistoryRecord.projectId || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('history.client')}>{currentHistoryRecord.client || currentHistoryRecord.metadata?.client || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('history.domain')}>{currentHistoryRecord.domain || currentHistoryRecord.metadata?.domain || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('history.subject')}>{currentHistoryRecord.subject || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('history.documentId')}>{currentHistoryRecord.documentId || currentHistoryRecord.metadata?.documentId || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('history.projectGuid')}>{currentHistoryRecord.projectGuid || currentHistoryRecord.metadata?.projectGuid || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('history.model')}>{currentHistoryRecord.model || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('common.provider')}>{currentHistoryRecord.providerName || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('history.submittedAt')}>{formatLocalTimestamp(currentHistoryRecord.submittedAt)}</Descriptions.Item>
              <Descriptions.Item label={t('history.completedAt')}>{formatLocalTimestamp(currentHistoryRecord.completedAt)}</Descriptions.Item>
              <Descriptions.Item label={t('history.segmentCount')}>{currentHistoryRecord.segmentCount ?? buildHistorySegments(currentHistoryRecord).length}</Descriptions.Item>
              <Descriptions.Item label={t('history.segmentSummary')}>{currentHistoryRecord.segmentSummary || '-'}</Descriptions.Item>
            </Descriptions>
            <Card size="small" title={t('history.promptViewTitle')}>
              <Space direction="vertical" size={12} style={{ display: 'flex' }}>
                <div>
                  <Text strong>{t('history.renderedSystemPrompt')}</Text>
                  <pre className="history-json">
                    {String(
                      getHistoryRenderedSystemPrompt(currentHistoryRecord)
                      || t('history.promptUnavailable')
                    )}
                  </pre>
                </div>
                <div>
                  <Text strong>{t('history.renderedUserPrompt')}</Text>
                  <pre className="history-json">
                    {String(
                      getHistoryRenderedUserPrompt(currentHistoryRecord)
                      || t('history.promptUnavailable')
                    )}
                  </pre>
                </div>
              </Space>
            </Card>
            <Card size="small" title={t('history.contextSourcesTitle')}>
              <Descriptions bordered column={1} size="small">
                <Descriptions.Item label={t('history.contextSourceTranslationStyle')}>
                  {getHistoryContextSources(currentHistoryRecord).translationStyle || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={t('history.contextSourceDocumentSummary')}>
                  {getHistoryContextSources(currentHistoryRecord).documentSummary || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={t('history.contextSourceTerminology')}>
                  {getHistoryContextSources(currentHistoryRecord).terminology || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={t('history.contextSourceTmHints')}>
                  {getHistoryContextSources(currentHistoryRecord).tmHints || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={t('history.contextSourceTmDiagnostics')}>
                  {getHistoryContextSources(currentHistoryRecord).tmDiagnostics || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={t('history.contextSourceProjectMetadata')}>
                  {getHistoryContextSources(currentHistoryRecord).projectMetadata || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={t('history.contextSourcePreviewContext')}>
                  {getHistoryContextSources(currentHistoryRecord).previewContext || '-'}
                </Descriptions.Item>
              </Descriptions>
            </Card>
            {shouldShowHistoryActualSentContent(currentHistoryRecord, buildHistorySegments(currentHistoryRecord)) ? (
              <Card size="small" title={t('history.actualSentContent')}>
                <List
                  size="small"
                  dataSource={buildHistoryPromptItems(currentHistoryRecord, buildHistorySegments(currentHistoryRecord))}
                  renderItem={(item) => (
                    <List.Item>
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        <Text strong>{t('history.batchItemLabel', { index: item.segmentIndex })}</Text>
                        <div>
                          <Text strong>{t('history.sentSourceText')}</Text>
                          <pre className="history-json">{item.sourceText || '-'}</pre>
                        </div>
                        <div>
                          <Text strong>{t('history.sentPromptInstructions')}</Text>
                          <pre className="history-json">{item.promptInstructions || t('history.promptUnavailable')}</pre>
                        </div>
                      </Space>
                    </List.Item>
                  )}
                />
              </Card>
            ) : null}
            <Card size="small" title={t('history.segments')}>
              <List
                size="small"
                dataSource={buildHistorySegments(currentHistoryRecord)}
                renderItem={(segment) => (
                  <List.Item>
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Text strong>{t('history.batchItemLabel', { index: segment.segmentIndex })}</Text>
                      <Text>{`${t('history.source')}: ${segment.source || '-'}`}</Text>
                      <Text>{`${t('history.target')}: ${segment.target || '-'}`}</Text>
                      {(segment.tmSource || segment.tmTarget) ? (
                        <Text type="secondary">{`${t('history.tmSource')}: ${segment.tmSource || '-'} | ${t('history.tmTarget')}: ${segment.tmTarget || '-'}`}</Text>
                      ) : null}
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('history.noSelection')} />
        )}
      </Drawer>

      <Drawer
        title={t('context.assetPreviewTitle')}
        placement="right"
        open={assetPreviewOpen}
        onClose={() => {
          setAssetPreviewOpen(false);
          setAssetPreviewData(null);
          setAssetPreviewRecord(null);
        }}
        width={WIDE_SIDE_DRAWER_WIDTH}
        destroyOnClose
      >
        <Space direction="vertical" size={16} style={{ display: 'flex' }}>
          {assetPreviewRecord ? (
            <Descriptions bordered column={1} size="small">
              <Descriptions.Item label={t('context.name')}>{assetPreviewRecord.name || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('context.assetTypeLabel')}>{t(`context.assetType.${assetPreviewRecord.type}`)}</Descriptions.Item>
              <Descriptions.Item label={t('context.assetPreviewRowCount')}>{assetPreviewData?.rowCount ?? '-'}</Descriptions.Item>
              <Descriptions.Item label={t('context.assetPreviewParsingMode')}>
                {assetPreviewData?.parsingMode ? t(`context.assetPreviewMode.${assetPreviewData.parsingMode}`) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('context.assetPreviewSmartAvailability')}>
                {typeof assetPreviewData?.smartParsingAvailable === 'boolean'
                  ? (assetPreviewData.smartParsingAvailable ? t('common.enabled') : t('common.disabled'))
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('context.assetPreviewConfidenceLabel')}>
                {assetPreviewData?.mappingConfidence ? getAssetPreviewConfidenceLabel(t, assetPreviewData.mappingConfidence) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('context.assetPreviewLanguagePair')}>
                {assetPreviewData?.languagePair?.source || assetPreviewData?.languagePair?.target
                  ? `${assetPreviewData?.languagePair?.source || '-'} -> ${assetPreviewData?.languagePair?.target || '-'}`
                  : '-'}
              </Descriptions.Item>
              {hasTbStructurePreview(assetPreviewData) ? (
                <Descriptions.Item label={t('context.assetPreviewTbStructureMode')}>
                  {t(`context.assetPreviewTbStructureModeValue.${assetPreviewData.tbStructuringMode || 'ai_structured'}`)}
                </Descriptions.Item>
              ) : null}
            </Descriptions>
          ) : null}
          {assetPreviewLoading ? (
            <Text type="secondary">{t('app.loading')}</Text>
          ) : assetPreviewData?.unsupported ? (
            <Alert type="info" showIcon message={t('context.assetPreviewUnavailable')} />
          ) : assetPreviewData?.error ? (
            <Alert type="error" showIcon message={assetPreviewData.error} />
          ) : assetPreviewData?.smartParsingAvailable === false && assetPreviewData?.smartParsingRecommended ? (
            <Alert
              type="info"
              showIcon
              message={t('context.assetPreviewSmartUpgradeTitle')}
              description={t('context.assetPreviewSmartUpgradeDescription')}
            />
          ) : null}
          {Array.isArray(assetPreviewData?.mappingWarnings) && assetPreviewData.mappingWarnings.length ? (
            <Alert
              type="warning"
              showIcon
              message={t('context.assetPreviewWarnings')}
              description={assetPreviewData.mappingWarnings.join(' ')}
            />
          ) : null}
          {Array.isArray(assetPreviewData?.tbStructureWarnings) && assetPreviewData.tbStructureWarnings.length ? (
            <Alert
              type="warning"
              showIcon
              message={t('context.assetPreviewTbStructureWarnings')}
              description={assetPreviewData.tbStructureWarnings.join(' ')}
            />
          ) : null}
          {assetPreviewData?.manualMappingRequired ? (
            <Card size="small" title={t('context.assetPreviewManualMappingTitle')}>
              <Space direction="vertical" size={12} style={{ display: 'flex' }}>
                <Text type="secondary">{t('context.assetPreviewManualMappingDescription')}</Text>
                <Select
                  value={assetPreviewManualDraft.srcColumn || undefined}
                  placeholder={t('context.assetPreviewManualSource')}
                  options={(assetPreviewData?.availableColumns || []).map((columnName) => ({ value: columnName, label: columnName }))}
                  onChange={(value) => setAssetPreviewManualDraft((current) => ({ ...current, srcColumn: value || '' }))}
                />
                <Select
                  value={assetPreviewManualDraft.tgtColumn || undefined}
                  placeholder={t('context.assetPreviewManualTarget')}
                  options={(assetPreviewData?.availableColumns || []).map((columnName) => ({ value: columnName, label: columnName }))}
                  onChange={(value) => setAssetPreviewManualDraft((current) => ({ ...current, tgtColumn: value || '' }))}
                />
                <Input
                  value={assetPreviewManualDraft.sourceLanguage}
                  placeholder={t('context.assetPreviewManualSourceLanguage')}
                  onChange={(event) => setAssetPreviewManualDraft((current) => ({ ...current, sourceLanguage: event.target.value }))}
                />
                <Input
                  value={assetPreviewManualDraft.targetLanguage}
                  placeholder={t('context.assetPreviewManualTargetLanguage')}
                  onChange={(event) => setAssetPreviewManualDraft((current) => ({ ...current, targetLanguage: event.target.value }))}
                />
                <Button
                  type="primary"
                  loading={assetPreviewSaving}
                  onClick={() => void saveAssetPreviewTbConfig()}
                  disabled={!assetPreviewManualDraft.srcColumn || !assetPreviewManualDraft.tgtColumn || !assetPreviewManualDraft.sourceLanguage || !assetPreviewManualDraft.targetLanguage}
                >
                  {t('context.assetPreviewManualSave')}
                </Button>
              </Space>
            </Card>
          ) : null}
          {hasTbStructurePreview(assetPreviewData) ? (
            <Descriptions bordered column={1} size="small" title={t('context.assetPreviewTbStructureTitle')}>
              <Descriptions.Item label={t('context.assetPreviewTbStructureSummary')}>
                {assetPreviewData?.tbStructureSummary || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('context.assetPreviewTbStructureFingerprint')}>
                {assetPreviewData?.tbStructureFingerprint || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('context.assetPreviewTbStructureApplied')}>
                {assetPreviewData?.tbStructureApplied === true ? t('common.enabled') : t('common.disabled')}
              </Descriptions.Item>
            </Descriptions>
          ) : null}
          {canApplyTbStructurePreview(assetPreviewData) ? (
            <Card size="small" title={t('context.assetPreviewApplyDetectedTitle')}>
              <Space direction="vertical" size={12} style={{ display: 'flex' }}>
                <Text type="secondary">{t('context.assetPreviewApplyDetectedDescription')}</Text>
                <Button
                  type="primary"
                  loading={assetPreviewSaving}
                  onClick={() => void applyDetectedAssetPreviewTbStructure()}
                >
                  {t('context.assetPreviewApplyDetectedAction')}
                </Button>
              </Space>
            </Card>
          ) : null}
          {formatAssetPreviewMapping(assetPreviewData?.detectedMapping).length ? (
            <Descriptions bordered column={1} size="small" title={t('context.assetPreviewDetectedMapping')}>
              {formatAssetPreviewMapping(assetPreviewData?.detectedMapping).map((item) => (
                <Descriptions.Item key={item.key} label={t(`context.assetPreviewField.${item.role}`)}>
                  <Space>
                    <Text>{item.columnName}</Text>
                    <Tag>{t(`context.assetPreviewConfidence.${item.confidence}`)}</Tag>
                  </Space>
                </Descriptions.Item>
              ))}
              <Descriptions.Item label={t('context.assetPreviewUnmappedColumns')}>
                {(assetPreviewData?.unmappedColumns || []).map((item) => item.columnName).filter(Boolean).join(', ') || '-'}
              </Descriptions.Item>
            </Descriptions>
          ) : null}
          {Array.isArray(assetPreviewData?.rows) && assetPreviewData.rows.length ? (
            <>
              <Table
                size="small"
                pagination={false}
                dataSource={buildAssetPreviewRows(assetPreviewData)}
                columns={(assetPreviewData.columns || Object.keys(assetPreviewData.rows[0] || {})).map((columnKey) => ({
                  title: t(`context.assetPreviewColumn.${columnKey}`),
                  dataIndex: columnKey,
                  key: columnKey,
                  render: (value) => String(value ?? '')
                }))}
              />
              {assetPreviewData?.truncated ? <Text type="secondary">{t('context.assetPreviewTruncated')}</Text> : null}
            </>
          ) : Array.isArray(assetPreviewData?.rows) ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('context.assetPreviewEmpty')} />
          ) : assetPreviewData?.text ? (
            <pre className="history-json">{assetPreviewData.text}</pre>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('context.assetPreviewEmpty')} />
          )}
        </Space>
      </Drawer>

    </Layout>
  );
}
