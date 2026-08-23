import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppstoreOutlined,
  ApartmentOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  SafetyCertificateOutlined,
  MenuOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SelectOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Descriptions,
  Dropdown,
  Drawer,
  Empty,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Radio,
  Result,
  Row,
  Select,
  Skeleton,
  Space,
  Spin,
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
  resolveSelectedRecordId,
  updateDraftEntry
} from './editorDrafts.mjs';
import { getProviderDraftSeed } from './providerDraftDefaults.mjs';
import {
  buildProviderFingerprint,
  buildProviderModelCatalog,
  createDraftProviderModel,
  createProviderDraft,
  getPreferredProviderModel,
  isDraftProvider
} from './providerDraftState.mjs';
import {
  applyProfileExecutionSelection,
  applyProfileProviderId,
  buildAssetBindingsFromSelections,
  buildAssetSelectionsFromBindings,
  buildExecutionOptionValue,
  buildProfileFingerprint,
  createBlankProfile,
  createEmptyProfileDraft,
  getProfileExecutionSelection,
  getProfileProviderId,
  isSelectableProfileProvider
} from './profileDraftState.mjs';
import {
  DEFAULT_HISTORY_INSIGHTS,
  createFallbackAppState,
  normalizeAppStatePayload,
  preserveProviderHistoryMetrics
} from './appState.mjs';
import { useI18n } from './i18n';
import { getLocalizedDesktopError } from './errorPresentation.mjs';
import DashboardConnectionStatus from './components/DashboardConnectionStatus.jsx';
import { TABLE_SCROLL_X } from './tableLayout.mjs';
import {
  buildInstallDraft,
  getPresetInstallDir,
  getUpdateErrorDisplay
} from './pages/dashboard/dashboardPresentation.mjs';
import {
  getDashboardStatusSnapshot,
  setDashboardStatusSnapshot
} from './pages/dashboard/dashboardStatusStore.mjs';
import {
  buildHistoryActiveFilterTags,
  createEmptyHistoryFilters,
  filterHistoryItems
} from './pages/history/historyPresentation.mjs';
import {
  buildLogDiagnosticText,
  normalizeLogStatePayload
} from './pages/logs/logPresentation.mjs';
import {
  buildAssetPreviewRows,
  canApplyTbStructurePreview,
  formatAssetPreviewMapping,
  getAssetPreviewConfidenceLabel,
  hasTbStructurePreview
} from './pages/assets/assetPresentation.mjs';
import {
  DEFAULT_PROVIDER_TEST_STATE,
  decorateProvidersWithConnectionStatus,
  normalizeProviderStatus
} from './pages/providers/providerConnectionState.mjs';
import {
  getProviderTypeLabel,
  getStatusTagMeta,
  normalizeProviderFilterText
} from './pages/providers/providerPresentation.mjs';
import {
  createPendingOperationRegistry,
  getShellNavigationMode,
  readShellState,
  resolveDirtyNavigationKind,
} from './uiBehavior.mjs';
import {
  useAppDataLifecycle,
  useHistoryDetail,
  useShellLifecycle
} from './hooks/useAppLifecycle.mjs';

const ProvidersPage = lazy(() => import('./pages/providers/ProvidersPage.jsx'));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage.jsx'));
const HistoryPage = lazy(() => import('./pages/history/HistoryPage.jsx'));
const BuilderPage = lazy(() => import('./pages/builder/BuilderPage.jsx'));
const AssetsPage = lazy(() => import('./pages/assets/AssetsPage.jsx'));
const MappingRulesPage = lazy(() => import('./pages/mapping/MappingRulesPage.jsx'));
const LogsPage = lazy(() => import('./pages/logs/LogsPage.jsx'));
const QualityPage = lazy(() => import('./pages/quality/QualityPage.jsx'));

const { Content, Header, Sider } = Layout;
const { Text, Title } = Typography;
const CONNECTION_SENSITIVE_PROVIDER_FIELDS = new Set(['apiKey', 'baseUrl', 'requestPath', 'type']);
const WIDE_SIDE_DRAWER_WIDTH = 'min(920px, calc(100vw - 32px))';

function useDesktopApi() {
  return window.memoqDesktop;
}

function PageHeaderBlock({ title, description }) {
  return (
    <div className="page-header-block">
      <Title level={2}>{title}</Title>
      <Text type="secondary">{description}</Text>
    </div>
  );
}


export default function App() {
  const api = useDesktopApi();
  const { t, locale, setLocale } = useI18n();
  const { message, modal } = AntdApp.useApp();
  const initialShellStateRef = useRef(null);
  if (!initialShellStateRef.current) {
    initialShellStateRef.current = readShellState(globalThis.localStorage);
  }
  const [activePage, setActivePage] = useState(() => initialShellStateRef.current.activePage);
  const [state, setState] = useState(null);
  const [profileId, setProfileId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [selectedHistoryIds, setSelectedHistoryIds] = useState([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [handshaking, setHandshaking] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateActionLoading, setUpdateActionLoading] = useState(false);
  const [logState, setLogState] = useState(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logPruning, setLogPruning] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [duplicatingProfile, setDuplicatingProfile] = useState(false);
  const [creatingProfileKind, setCreatingProfileKind] = useState('');
  const [importingAssetType, setImportingAssetType] = useState('');
  const [exportingHistoryFormat, setExportingHistoryFormat] = useState('');
  const [deletingHistory, setDeletingHistory] = useState(false);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
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
  const [historyInsightFocus, setHistoryInsightFocus] = useState(null);
  const [providerInsightFocus, setProviderInsightFocus] = useState(null);
  const [navCollapsed, setNavCollapsed] = useState(() => initialShellStateRef.current.navCollapsed);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => Number(globalThis.innerWidth || 1366));
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [navigationResolving, setNavigationResolving] = useState(false);
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
  const autoUpdateCheckStartedRef = useRef(false);
  const pendingOperationsRef = useRef(null);

  providerDraftsRef.current = providerDraftsById;
  profileDraftsRef.current = profileDraftsById;
  if (!pendingOperationsRef.current) {
    pendingOperationsRef.current = createPendingOperationRegistry();
  }

  function beginPendingOperation(key, setPending, pendingValue = true) {
    const endOperation = pendingOperationsRef.current.begin(key);
    if (!endOperation) return null;
    setPending(pendingValue);
    return () => {
      endOperation();
      setPending(typeof pendingValue === 'boolean' ? false : '');
    };
  }

  const navPageItems = [
    { key: 'dashboard', label: <span className="app-nav-label">{t('nav.dashboard')}</span>, title: t('nav.dashboard'), icon: <AppstoreOutlined className="app-nav-icon" /> },
    { key: 'providers', label: <span className="app-nav-label">{t('nav.providers')}</span>, title: t('nav.providers'), icon: <CloudServerOutlined className="app-nav-icon" /> },
    { key: 'assets', label: <span className="app-nav-label">{t('nav.assets')}</span>, title: t('nav.assets'), icon: <DatabaseOutlined className="app-nav-icon" /> },
    { key: 'builder', label: <span className="app-nav-label">{t('nav.builder')}</span>, title: t('nav.builder'), icon: <DeploymentUnitOutlined className="app-nav-icon" /> },
    { key: 'mapping', label: <span className="app-nav-label">{t('nav.mapping')}</span>, title: t('nav.mapping'), icon: <ApartmentOutlined className="app-nav-icon" /> },
    { key: 'quality', label: <span className="app-nav-label">{t('nav.quality')}</span>, title: t('nav.quality'), icon: <SafetyCertificateOutlined className="app-nav-icon" /> },
    { key: 'history', label: <span className="app-nav-label">{t('nav.history')}</span>, title: t('nav.history'), icon: <FileSearchOutlined className="app-nav-icon" /> },
    { key: 'logs', label: <span className="app-nav-label">{t('nav.logs')}</span>, title: t('nav.logs'), icon: <FileTextOutlined className="app-nav-icon" /> }
  ];
  const navItems = [
    navPageItems[0],
    { type: 'group', label: <span className="app-nav-group-label">{t('nav.configure')}</span>, children: navPageItems.slice(1, 5) },
    navPageItems[5],
    navPageItems[6],
    { type: 'group', label: <span className="app-nav-group-label">{t('nav.support')}</span>, children: [navPageItems[7]] }
  ];
  const pageDescriptions = {
    dashboard: t('nav.dashboardDescription'),
    providers: t('nav.providersDescription'),
    assets: t('nav.assetsDescription'),
    builder: t('nav.builderDescription'),
    mapping: t('nav.mappingDescription'),
    history: t('nav.historyDescription'),
    quality: t('nav.qualityDescription'),
    logs: t('nav.logsDescription')
  };

  function notifyError(loadError, fallback = t('feedback.actionFailed')) {
    const text = getLocalizedDesktopError(loadError, t, fallback);
    setError(text);
    message.error(text);
  }

  async function refresh(filters = {}, options = {}) {
    const endPending = options.trackPending
      ? beginPendingOperation('app-refresh', setRefreshing)
      : () => {};
    if (!endPending) return false;

    try {
      setError('');
      if (!api?.getAppState) {
        throw new Error(t('app.desktopBridgeUnavailable'));
      }

      const includeHistoryExplorer = typeof options.includeHistoryExplorer === 'boolean'
        ? options.includeHistoryExplorer
        : activePage === 'history';
      const includeProviderHistoryMetrics = typeof options.includeProviderHistoryMetrics === 'boolean'
        ? options.includeProviderHistoryMetrics
        : activePage === 'providers';
      const requestFilters = {
        ...(filters || {}),
        includeHistoryExplorer,
        includeProviderHistoryMetrics
      };
      const remoteData = normalizeAppStatePayload(await api.getAppState(requestFilters));
      setDashboardStatusSnapshot(remoteData);
      const providerRebase = rebaseDraftEntries(providerDraftsRef.current, remoteData?.providerHub?.providers || [], buildProviderFingerprint);
      const profileRebase = rebaseDraftEntries(profileDraftsRef.current, remoteData?.contextBuilder?.profiles || [], buildProfileFingerprint);

      setProviderDraftsById(providerRebase.draftsById);
      setProfileDraftsById(profileRebase.draftsById);
      setState((current) => {
        let nextData = remoteData;
        if (!includeProviderHistoryMetrics) {
          nextData = preserveProviderHistoryMetrics(nextData, current);
        }
        if (!includeHistoryExplorer && current?.historyExplorer) {
          nextData = normalizeAppStatePayload({
            ...nextData,
            historyExplorer: current.historyExplorer
          });
        }
        return nextData;
      });

      const resolvedProviders = getResolvedRecords(remoteData?.providerHub?.providers || [], providerRebase.draftsById);
      const resolvedProfiles = getResolvedRecords(remoteData?.contextBuilder?.profiles || [], profileRebase.draftsById);

      setProfileId((current) => resolveSelectedRecordId(
        resolvedProfiles,
        current,
        remoteData?.contextBuilder?.defaultProfileId || ''
      ));
      setProviderId((current) => resolvedProviders.some((item) => item.id === current) ? current : (resolvedProviders[0]?.id || ''));
      if (includeHistoryExplorer) {
        setSelectedHistoryIds((current) => current.filter((entryId) => remoteData?.historyExplorer?.items?.some((item) => item.id === entryId)));
        setSelectedHistoryId((current) => remoteData?.historyExplorer?.items?.some((item) => item.id === current) ? current : '');
      }

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
      return true;
    } catch (loadError) {
      setState((current) => current || normalizeAppStatePayload());
      notifyError(loadError);
      return false;
    } finally {
      endPending();
    }
  }

  async function refreshLogs() {
    if (!api?.getLogState) {
      return;
    }

    try {
      setLogLoading(true);
      setLogState(normalizeLogStatePayload(await api.getLogState()));
    } catch (loadError) {
      notifyError(loadError);
    } finally {
      setLogLoading(false);
    }
  }

  async function refreshDashboardStatus() {
    if (!api?.getAppState) return;

    try {
      const remoteData = normalizeAppStatePayload(await api.getAppState({
        includeHistoryExplorer: false,
        includeProviderHistoryMetrics: false
      }));
      setDashboardStatusSnapshot(remoteData);
    } catch (loadError) {
      notifyError(loadError);
    }
  }

  async function pruneLogsNow() {
    if (!api?.pruneLogs) {
      return;
    }

    try {
      setLogPruning(true);
      const result = await api.pruneLogs();
      message.success(t('logs.cleanSuccess', { count: result?.deletedCount || 0 }));
      await refreshLogs();
    } catch (pruneError) {
      notifyError(pruneError);
    } finally {
      setLogPruning(false);
    }
  }

  function confirmPruneLogs() {
    if (logPruning) return;
    modal.confirm({
      title: t('logs.cleanConfirmTitle'),
      content: t('logs.cleanConfirmDescription'),
      okText: t('logs.cleanNow'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: pruneLogsNow
    });
  }

  async function openLogsDirectory() {
    if (!logState?.logsDir) {
      return;
    }

    try {
      await api.openPath(logState.logsDir);
    } catch (openError) {
      notifyError(openError);
    }
  }

  async function revealLogFile(filePath) {
    if (!filePath) {
      return;
    }

    try {
      await api.showItemInFolder(filePath);
    } catch (openError) {
      notifyError(openError);
    }
  }

  async function copyLogDiagnostics() {
    try {
      await navigator.clipboard.writeText(buildLogDiagnosticText(logState || {}, state || {}, t));
      message.success(t('logs.copySuccess'));
    } catch (copyError) {
      notifyError(copyError);
    }
  }

  useAppDataLifecycle({
    activePage,
    startupStatus: state?.startup?.status,
    historyFilters,
    refresh,
    refreshDashboardStatus,
    refreshLogs
  });

  useEffect(() => {
    setError('');
  }, [activePage]);

  const {
    record: historyDetailRecord,
    loading: historyDetailLoading,
    error: historyDetailError
  } = useHistoryDetail({ api, selectedHistoryId, t });

  useEffect(() => {
    if (state?.startup?.status !== 'ready' || autoUpdateCheckStartedRef.current || typeof api?.checkForUpdates !== 'function') {
      return;
    }

    autoUpdateCheckStartedRef.current = true;
    void api.checkForUpdates({ manual: false })
      .then((updateState) => {
        setState((current) => current ? normalizeAppStatePayload({
          ...current,
          updateCenter: updateState,
          dashboard: {
            ...(current.dashboard || {}),
            updateCenter: updateState
          }
        }) : current);
      })
      .catch(() => {
      });
  }, [api, state?.startup?.status]);

  const profileItems = useMemo(
    () => getResolvedRecords(state?.contextBuilder?.profiles || [], profileDraftsById),
    [state?.contextBuilder?.profiles, profileDraftsById],
  );
  const defaultProfileId = String(state?.contextBuilder?.defaultProfileId || '').trim();
  const providerItems = useMemo(() => decorateProvidersWithConnectionStatus({
    providers: getResolvedRecords(state?.providerHub?.providers || [], providerDraftsById),
    draftsById: providerDraftsById,
    testStatesById: providerTestStatesById,
    buildFingerprint: buildProviderFingerprint,
    hasDraftChanges,
  }), [state?.providerHub?.providers, providerDraftsById, providerTestStatesById]);
  const currentProfile = useMemo(
    () => profileItems.find((item) => item.id === resolveSelectedRecordId(profileItems, profileId, defaultProfileId)) || null,
    [defaultProfileId, profileItems, profileId],
  );
  const translationCacheBypassProfileIds = useMemo(
    () => new Set(state?.contextBuilder?.translationCacheBypassProfileIds || []),
    [state?.contextBuilder?.translationCacheBypassProfileIds],
  );
  const currentProfileTranslationCacheBypassPending = currentProfile
    ? translationCacheBypassProfileIds.has(currentProfile.id)
    : false;
  const assetImportRules = state?.contextBuilder?.assetImportRules || {};
  const assets = state?.contextBuilder?.assets || [];
  const currentProvider = useMemo(
    () => providerItems.find((item) => item.id === providerId) || providerItems[0] || null,
    [providerItems, providerId],
  );
  const currentProviderModelCatalog = useMemo(
    () => buildProviderModelCatalog(currentProvider, discoveredProviderModels[currentProvider?.id] || []),
    [currentProvider, discoveredProviderModels],
  );
  const filteredCurrentProviderModelCatalog = useMemo(() => {
    const keyword = normalizeProviderFilterText(providerModelSearch);
    if (!keyword) {
      return currentProviderModelCatalog;
    }

    return currentProviderModelCatalog.filter((modelName) => modelName.toLowerCase().includes(keyword));
  }, [currentProviderModelCatalog, providerModelSearch]);
  const filteredProviders = useMemo(() => {
    const keyword = normalizeProviderFilterText(providerSearch);
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
  const currentProviderConnectionSnapshot = useMemo(() => currentProvider?.connectionSnapshot || {
    status: normalizeProviderStatus(currentProvider?.status),
    testedAt: '',
    latencyMs: null,
    message: '',
    lastError: '',
    hasPreviousTest: false
  }, [currentProvider]);
  const currentProviderConnectionStatus = normalizeProviderStatus(currentProviderConnectionSnapshot.status);
  const currentProviderConnectionMeta = getStatusTagMeta(currentProviderConnectionStatus, t);
  const currentProviderHasPreviousTest = currentProviderConnectionSnapshot.hasPreviousTest === true;
  const currentProviderTestMessage = useMemo(
    () => String(currentProviderConnectionSnapshot.message || '').trim(),
    [currentProviderConnectionSnapshot]
  );
  const currentProviderDirty = Boolean(currentProvider?.id && hasDraftChanges(providerDraftsById, currentProvider.id));
  const currentProfileDirty = Boolean(currentProfile?.id && hasDraftChanges(profileDraftsById, currentProfile.id));
  const hasUnsavedDrafts = Object.values(providerDraftsById).some((entry) => entry?.isNew || entry?.dirtyFields?.length)
    || Object.values(profileDraftsById).some((entry) => entry?.isNew || entry?.dirtyFields?.length);
  const shellNavigationMode = getShellNavigationMode(viewportWidth);
  const currentHistoryListItem = useMemo(
    () => state?.historyExplorer?.items?.find((item) => item.id === selectedHistoryId) || null,
    [state, selectedHistoryId],
  );
  const currentHistoryRecord = historyDetailRecord || currentHistoryListItem;
  const visibleHistoryItems = useMemo(
    () => filterHistoryItems(state?.historyExplorer?.items || [], historyFilters),
    [state, historyFilters]
  );
  const historyInsights = state?.historyExplorer?.insights || DEFAULT_HISTORY_INSIGHTS;
  const activeHistoryFilterTags = useMemo(
    () => buildHistoryActiveFilterTags(historyFilters, t),
    [historyFilters, t]
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
    setProviderModelSelection([]);
    setProviderModelSearch('');
  }, [currentProvider?.id]);

  const { persistCurrentPageScrollPosition } = useShellLifecycle({
    initialShellState: initialShellStateRef.current,
    activePage,
    navCollapsed,
    setViewportWidth,
    shellNavigationMode,
    setMobileNavOpen,
    hasUnsavedDrafts
  });

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
    if (!currentProfile) return false;
    const endPending = beginPendingOperation('profile-save', setSavingProfile);
    if (!endPending) return false;
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
      return true;
    } catch (saveError) {
      notifyError(saveError);
      return false;
    } finally {
      endPending();
    }
  }

  function discardCurrentProfileChangesNow() {
    if (!currentProfile) return;
    setProfileDraftsById((current) => discardDraftEntry(current, currentProfile.id));
  }

  function confirmDiscardCurrentProfileChanges() {
    if (!currentProfile || !currentProfileDirty) return;
    modal.confirm({
      title: t('navigation.discardProfileTitle'),
      content: t('navigation.discardProfileDescription', { name: currentProfile.name || t('context.unnamedProfile') }),
      okText: t('context.discardChanges'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: discardCurrentProfileChangesNow
    });
  }

  async function duplicateCurrentProfile() {
    if (!currentProfile) return;
    const endPending = beginPendingOperation('profile-duplicate', setDuplicatingProfile);
    if (!endPending) return;
    try {
      await api.duplicateProfile(currentProfile.id);
      await refresh();
    } catch (duplicateError) {
      notifyError(duplicateError);
    } finally {
      endPending();
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

  async function bypassTranslationCacheForCurrentProfileOnce() {
    if (!currentProfile || typeof api?.bypassTranslationCacheOnce !== 'function') {
      return;
    }

    try {
      await api.bypassTranslationCacheOnce(currentProfile.id);
      message.success(t('context.translationCacheBypassArmed'));
      await refresh();
    } catch (bypassError) {
      notifyError(bypassError);
    }
  }

  function confirmClearTranslationCache() {
    if (typeof api?.clearTranslationCache !== 'function') {
      return;
    }

    modal.confirm({
      title: t('context.clearTranslationCacheTitle'),
      content: t('context.clearTranslationCacheConfirm'),
      okText: t('context.clearTranslationCacheAction'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const result = await api.clearTranslationCache();
          message.success(t('context.clearTranslationCacheSuccess', { count: Number(result?.clearedCount || 0) }));
          await refresh();
        } catch (clearError) {
          notifyError(clearError);
        }
      }
    });
  }

  async function importAsset(type) {
    const normalizedType = String(type || '').trim();
    if (!normalizedType) return;
    const endPending = beginPendingOperation('asset-import', setImportingAssetType, normalizedType);
    if (!endPending) return;
    try {
      const importedAsset = await api.importAsset(normalizedType);
      await refresh();
      setActivePage('assets');
      if (importedAsset?.id) {
        void openAssetPreview(importedAsset.id, { fallbackAsset: importedAsset });
      }
    } catch (assetError) {
      notifyError(assetError);
    } finally {
      endPending();
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
    if (!currentProvider || currentProviderConnectionMeta.color !== 'green') return false;
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
      return true;
    } catch (saveError) {
      notifyError(saveError);
      return false;
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

  async function installIntegration(selectedInstallDir) {
    if (installing) return;

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

  function confirmInstallIntegration() {
    const selectedInstallDir = installDraft.mode === 'custom'
      ? String(installDraft.customInstallDir || '').trim()
      : getPresetInstallDir(installDraft.memoqVersion);

    if (!selectedInstallDir) {
      message.error(t('dashboard.installDirectoryRequired'));
      return;
    }

    modal.confirm({
      title: t('dashboard.installConfirmTitle'),
      content: t('dashboard.installConfirmDescription', { path: selectedInstallDir }),
      okText: t('dashboard.installReinstall'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: () => installIntegration(selectedInstallDir)
    });
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

  async function runUpdateAction(action, successMessage = '') {
    setUpdateActionLoading(true);
    try {
      const result = await action();
      if (successMessage) {
        message.success(successMessage);
      }
      await refresh(historyFilters);
      return result;
    } catch (updateError) {
      notifyError(updateError);
      return null;
    } finally {
      setUpdateActionLoading(false);
    }
  }

  async function checkForUpdates(manual = true) {
    if (typeof api?.checkForUpdates !== 'function') {
      return;
    }

    setCheckingUpdates(true);
    try {
      const result = await api.checkForUpdates({ manual });
      const dashboardStatus = getDashboardStatusSnapshot();
      if (dashboardStatus) {
        setDashboardStatusSnapshot({
          ...dashboardStatus,
          updateCenter: result,
          dashboard: {
            ...(dashboardStatus.dashboard || {}),
            updateCenter: result
          }
        });
      }
      setState((current) => {
        if (!current) return current;
        return normalizeAppStatePayload({
          ...current,
          updateCenter: result,
          dashboard: {
            ...(current.dashboard || {}),
            updateCenter: result
          }
        });
      });

      if (manual) {
        if (result?.updateStatus === 'error') {
          message.error(getUpdateErrorDisplay(result, t) || t('dashboard.updateStatusError'));
        } else {
          message.success(
            result?.updateStatus === 'available'
              ? t('dashboard.updateAvailableSuccess', { version: result?.latestVersion || '-' })
              : t('dashboard.updateUpToDateSuccess')
          );
        }
      }
    } catch (updateError) {
      notifyError(updateError);
    } finally {
      setCheckingUpdates(false);
    }
  }

  async function downloadInstallerUpdate(dashboardUpdateCenter = {}) {
    await runUpdateAction(
      () => api.downloadInstallerUpdate(dashboardUpdateCenter.latestVersion || ''),
      t('dashboard.updateDownloadStarted')
    );
  }

  async function openPortableDownloadPage(portableDownloadUrl = '') {
    if (!portableDownloadUrl || typeof api?.openExternalUrl !== 'function') {
      return;
    }
    await runUpdateAction(() => api.openExternalUrl(portableDownloadUrl));
  }

  async function openUpdateReleaseNotes(dashboardUpdateCenter = {}) {
    if (!dashboardUpdateCenter.releaseNotesUrl || typeof api?.openExternalUrl !== 'function') {
      return;
    }
    await runUpdateAction(() => api.openExternalUrl(dashboardUpdateCenter.releaseNotesUrl));
  }

  async function launchDownloadedInstallerUpdateNow(dashboardUpdateCenter = {}) {
    if (!dashboardUpdateCenter.downloadedArtifactPath || typeof api?.launchDownloadedInstallerUpdate !== 'function') {
      return;
    }
    await runUpdateAction(
      () => api.launchDownloadedInstallerUpdate(dashboardUpdateCenter.downloadedArtifactPath),
      t('dashboard.updateInstallerLaunchSuccess')
    );
  }

  function confirmLaunchDownloadedInstallerUpdate(dashboardUpdateCenter = {}) {
    if (!dashboardUpdateCenter.downloadedArtifactPath || updateActionLoading) return;
    modal.confirm({
      title: t('dashboard.restartUpdateConfirmTitle'),
      content: t('dashboard.restartUpdateConfirmDescription'),
      okText: t('dashboard.restartAndInstallUpdate'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: () => launchDownloadedInstallerUpdateNow(dashboardUpdateCenter)
    });
  }

  async function exportHistory(format, scope) {
    const endPending = beginPendingOperation('history-export', setExportingHistoryFormat, format);
    if (!endPending) return;
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
    } finally {
      endPending();
    }
  }

  async function applyHistoryFilters() {
    const endPending = beginPendingOperation('history-refresh', setHistoryRefreshing);
    if (!endPending) return;
    setHistoryInsightFocus(null);
    setHistoryFilters(historyFilterDraft);
    setSelectedHistoryIds([]);
    setSelectedHistoryId('');
    try {
      await refresh(historyFilterDraft, { includeHistoryExplorer: true });
    } finally {
      endPending();
    }
  }

  function updateHistoryFilterDraftField(field, value) {
    setHistoryInsightFocus(null);
    setHistoryFilterDraft((current) => ({ ...current, [field]: value }));
  }

  async function applyHistoryInsightFilter(filter = {}, focus = {}) {
    const endPending = beginPendingOperation('history-refresh', setHistoryRefreshing);
    if (!endPending) return;
    const nextFilters = {
      ...createEmptyHistoryFilters(),
      ...(filter && typeof filter === 'object' ? filter : {})
    };
    setHistoryInsightFocus({
      ...(focus && typeof focus === 'object' ? focus : {}),
      filter: nextFilters
    });
    setHistoryFilterDraft(nextFilters);
    setHistoryFilters(nextFilters);
    setSelectedHistoryIds([]);
    setSelectedHistoryId('');
    try {
      await refresh(nextFilters, { includeHistoryExplorer: true });
    } finally {
      endPending();
    }
  }

  function commitNavigation(navigation) {
    if (!navigation) return;
    if (navigation.kind === 'page') {
      persistCurrentPageScrollPosition();
      setActivePage(navigation.value);
      return;
    }
    if (navigation.kind === 'provider') {
      setProviderInsightFocus(null);
      setProviderId(navigation.value);
      return;
    }
    if (navigation.kind === 'profile') {
      setProfileId(navigation.value);
    }
  }

  function requestNavigation(kind, value) {
    const isSameDestination = (kind === 'page' && value === activePage)
      || (kind === 'provider' && value === currentProvider?.id)
      || (kind === 'profile' && value === currentProfile?.id);
    if (isSameDestination) return;

    const dirtyKind = resolveDirtyNavigationKind({
      activePage,
      navigationKind: kind,
      currentProviderDirty,
      currentProfileDirty
    });
    const navigation = { kind, value, dirtyKind };
    if (dirtyKind) {
      setPendingNavigation(navigation);
      return;
    }
    commitNavigation(navigation);
  }

  function requestPageNavigation(pageKey) {
    requestNavigation('page', pageKey);
  }

  function selectProfile(profileEntryId = '') {
    requestNavigation('profile', profileEntryId);
  }

  function openInsightProvider(providerEntryId = '', focus = {}) {
    const normalizedProviderId = String(providerEntryId || '').trim();
    if (normalizedProviderId) {
      setProviderId(normalizedProviderId);
    }
    setProviderSearch('');
    setProviderInsightFocus({
      ...(focus && typeof focus === 'object' ? focus : {}),
      providerId: normalizedProviderId
    });
    requestPageNavigation('providers');
  }

  function selectProvider(providerEntryId = '') {
    requestNavigation('provider', providerEntryId);
  }

  function returnFromProviderInsightFocus() {
    requestPageNavigation('history');
  }

  async function resetHistoryFilters() {
    const endPending = beginPendingOperation('history-refresh', setHistoryRefreshing);
    if (!endPending) return;
    const emptyFilters = createEmptyHistoryFilters();
    setHistoryInsightFocus(null);
    setProviderInsightFocus(null);
    setHistoryFilterDraft(emptyFilters);
    setHistoryFilters(emptyFilters);
    setSelectedHistoryIds([]);
    setSelectedHistoryId('');
    try {
      await refresh(emptyFilters, { includeHistoryExplorer: true });
    } finally {
      endPending();
    }
  }

  async function refreshHistory() {
    const endPending = beginPendingOperation('history-refresh', setHistoryRefreshing);
    if (!endPending) return;
    try {
      await refresh(historyFilters, { includeHistoryExplorer: true });
    } finally {
      endPending();
    }
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

  }

  function patchCurrentModel(modelId, field, value) {
    if (!currentProvider) return;
    updateCurrentProviderDraft((provider) => ({
      ...provider,
      models: (provider.models || []).map((model) => (
        model.id === modelId ? { ...model, [field]: value } : model
      ))
    }), { dirtyFields: field === 'modelName' ? ['models', 'modelsConnection'] : ['models'] });

  }

  function addModelToCurrentProvider(modelName = '') {
    if (!currentProvider) return;
    const draftSeed = getProviderDraftSeed(currentProvider.type);
    const normalizedModelName = String(modelName || '').trim() || draftSeed.modelNames?.[0] || '';
    if (!normalizedModelName) return;

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
  }

  function removeModelsFromCurrentProvider(modelIds = []) {
    if (!currentProvider) return;
    const normalizedIds = Array.from(new Set((Array.isArray(modelIds) ? modelIds : []).map((item) => String(item || '').trim()).filter(Boolean)));
    if (!normalizedIds.length) {
      return;
    }

    updateCurrentProviderDraft((provider) => {
      const currentModels = Array.isArray(provider.models) ? provider.models : [];
      const allowsEmptyDraftModels = provider.type === 'openai-compatible';
      if (!allowsEmptyDraftModels && currentModels.length - normalizedIds.length < 1) {
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
  }

  function setCurrentProviderDefaultModel(modelId) {
    if (!currentProvider) return;
    updateCurrentProviderDraft((provider) => ({
      ...provider,
      defaultModelId: modelId
    }), { dirtyFields: ['defaultModelId'] });
  }

  function discardCurrentProviderChangesNow() {
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

  function confirmDiscardCurrentProviderChanges() {
    if (!currentProvider || !currentProviderDirty) return;
    modal.confirm({
      title: t('navigation.discardProviderTitle'),
      content: t('navigation.discardProviderDescription', { name: currentProvider.name || t('nav.providers') }),
      okText: t('providers.discardChanges'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: discardCurrentProviderChangesNow
    });
  }

  async function createNewProfile() {
    const endPending = beginPendingOperation('profile-create', setCreatingProfileKind, 'preset');
    if (!endPending) return;
    try {
      const created = await api.saveProfile(createBlankProfile(t));
      await refresh();
      requestNavigation('profile', created.id);
      message.success(t('feedback.profileCreatedFromPreset'));
    } catch (createError) {
      notifyError(createError);
    } finally {
      endPending();
    }
  }

  async function createEmptyProfile() {
    const endPending = beginPendingOperation('profile-create', setCreatingProfileKind, 'blank');
    if (!endPending) return;
    try {
      const created = await api.saveProfile(createEmptyProfileDraft(t));
      await refresh();
      requestNavigation('profile', created.id);
      message.success(t('feedback.actionSucceeded'));
    } catch (createError) {
      notifyError(createError);
    } finally {
      endPending();
    }
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
      requestNavigation('provider', nextProvider.id);
      clearProviderTestState(nextProvider.id);
      message.success(t('providers.providerDraftCreated'));
    } catch (createError) {
      notifyError(createError);
    }
  }

  function handleChecklistAction(key) {
    if (key === 'install-plugin') {
      requestPageNavigation('dashboard');
      return;
    }

    if (key === 'provider-hub') {
      requestPageNavigation('providers');
      return;
    }

    if (key === 'asset-hub') {
      requestPageNavigation('assets');
      return;
    }

    if (key === 'context-builder') {
      requestPageNavigation('builder');
      return;
    }

    requestPageNavigation('history');
  }

  function stayOnDirtyEditor() {
    setPendingNavigation(null);
  }

  function discardAndContinueNavigation() {
    if (!pendingNavigation) return;
    const navigation = pendingNavigation;
    if (navigation.dirtyKind === 'provider') {
      discardCurrentProviderChangesNow();
    } else if (navigation.dirtyKind === 'profile') {
      discardCurrentProfileChangesNow();
    }
    setPendingNavigation(null);
    commitNavigation(navigation);
  }

  async function saveAndContinueNavigation() {
    if (!pendingNavigation) return;
    const navigation = pendingNavigation;
    setNavigationResolving(true);
    try {
      const saved = navigation.dirtyKind === 'provider'
        ? await saveCurrentProvider()
        : await saveCurrentProfile();
      if (!saved) return;
      setPendingNavigation(null);
      commitNavigation(navigation);
    } finally {
      setNavigationResolving(false);
    }
  }

  async function deleteHistoryEntries(entryIds = []) {
    const normalizedEntryIds = Array.from(new Set((Array.isArray(entryIds) ? entryIds : []).filter(Boolean)));
    if (!normalizedEntryIds.length || !api?.deleteHistoryEntries) {
      return;
    }

    const endPending = beginPendingOperation('history-delete', setDeletingHistory);
    if (!endPending) return;

    try {
      const result = await api.deleteHistoryEntries(normalizedEntryIds);
      setSelectedHistoryIds((current) => current.filter((entryId) => !normalizedEntryIds.includes(entryId)));
      setSelectedHistoryId((current) => (normalizedEntryIds.includes(current) ? '' : current));
      message.success(t('history.deleteSuccess', { count: Number(result?.deletedCount || normalizedEntryIds.length) }));
      await refresh(historyFilters, { includeHistoryExplorer: true });
    } catch (deleteError) {
      notifyError(deleteError);
    } finally {
      endPending();
    }
  }

  function confirmHistoryDeletion({ entryIds, title, content }) {
    const normalizedEntryIds = Array.from(new Set((entryIds || []).filter(Boolean)));
    if (!normalizedEntryIds.length || deletingHistory) return;

    modal.confirm({
      title,
      content,
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: () => deleteHistoryEntries(normalizedEntryIds)
    });
  }

  function confirmDeleteSelectedHistoryEntries() {
    if (!selectedHistoryIds.length) {
      return;
    }

    confirmHistoryDeletion({
      entryIds: selectedHistoryIds,
      title: t('history.deleteSelected'),
      content: t('history.confirmDeleteSelected', { count: selectedHistoryIds.length })
    });
  }

  function confirmDeleteCurrentHistoryEntry() {
    if (!currentHistoryRecord) {
      return;
    }

    confirmHistoryDeletion({
      entryIds: [currentHistoryRecord.id],
      title: t('history.deleteEntry'),
      content: t('history.confirmDeleteEntry', { id: currentHistoryRecord.requestId || currentHistoryRecord.id || '-' })
    });
  }

  function closeHistoryDetail() {
    setSelectedHistoryId('');
    setHistoryDetailRecord(null);
    setHistoryDetailError('');
  }

  function confirmDeleteProfile() {
    if (!currentProfile) return;
    modal.confirm({
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
    modal.confirm({
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
    modal.confirm({
      title: t('providers.deleteProvider'),
      content: t('providers.confirmDeleteProvider', { name: currentProvider.name }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        if (isDraftProvider(currentProvider)) {
          discardCurrentProviderChangesNow();
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
    modal.confirm({
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
    modal.confirm({
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
    if (error) {
      return (
        <Result
          status="error"
          title={t('app.startupErrorTitle')}
          subTitle={error}
          extra={(
            <Button type="primary" onClick={() => refresh()}>
              {t('common.retry')}
            </Button>
          )}
        />
      );
    }

    return (
      <div className="app-initial-loading" role="status" aria-live="polite">
        <Spin size="large" />
        <Text type="secondary">{t('app.loading')}</Text>
      </div>
    );
  }

  return (
    <Layout className="app-shell">
      {shellNavigationMode !== 'drawer' ? (
        <Sider
          className={`app-sider ${(shellNavigationMode === 'compact' || navCollapsed) ? 'app-sider-collapsed' : ''}`}
          width={248}
          collapsedWidth={80}
          collapsed={shellNavigationMode === 'compact' || navCollapsed}
          trigger={null}
          theme="light"
        >
          <div className={`brand-block ${(shellNavigationMode === 'compact' || navCollapsed) ? 'brand-block-collapsed' : ''}`}>
            <div className="brand-block-top">
              {shellNavigationMode === 'expanded' && !navCollapsed ? <span /> : null}
              {shellNavigationMode === 'expanded' ? (
                <Tooltip title={navCollapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}>
                  <Button
                    type="text"
                    className="app-nav-toggle"
                    icon={navCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                    aria-label={navCollapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}
                    onClick={() => setNavCollapsed((current) => !current)}
                  />
                </Tooltip>
              ) : null}
            </div>
          </div>
          <nav aria-label={t('navigation.primary')}>
            <Menu
              className="app-nav-menu"
              theme="light"
              mode="inline"
              inlineCollapsed={shellNavigationMode === 'compact' || navCollapsed}
              selectedKeys={[activePage]}
              items={navItems}
              onClick={({ key }) => requestPageNavigation(key)}
            />
          </nav>
        </Sider>
      ) : null}
      <Drawer
        className="app-nav-drawer"
        title={t('app.title')}
        placement="left"
        width="min(320px, calc(100vw - 32px))"
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      >
        <nav aria-label={t('navigation.primary')}>
          <Menu
            className="app-nav-menu"
            theme="light"
            mode="inline"
            selectedKeys={[activePage]}
            items={navItems}
            onClick={({ key }) => {
              setMobileNavOpen(false);
              requestPageNavigation(key);
            }}
          />
        </nav>
      </Drawer>
      <Layout>
        <Header className="app-header">
          <Space className="app-header-bar">
            <Space className="app-header-title">
              {shellNavigationMode === 'drawer' ? (
                <Button
                  type="text"
                  className="app-mobile-nav-trigger"
                  icon={<MenuOutlined />}
                  aria-label={t('common.openNavigation')}
                  onClick={() => setMobileNavOpen(true)}
                />
              ) : null}
              <Text strong className="app-header-product">{t('app.title')}</Text>
            </Space>
            <Space wrap className="app-header-controls">
              <Select
                size="small"
                className="app-language-select"
                value={locale}
                options={[{ value: 'en', label: 'English' }, { value: 'zh-CN', label: '中文' }]}
                onChange={setLocale}
              />
              <Tooltip title={t('app.openAssistant')}>
                <Button
                  type="text"
                  size="small"
                  className="app-header-assistant"
                  icon={<SelectOutlined />}
                  onClick={() => api.openAssistantWindow?.()}
                  aria-label={t('app.openAssistant')}
                />
              </Tooltip>
              <Tooltip title={t('app.refresh')}>
                <Button
                  type="text"
                  size="small"
                  className="app-header-refresh"
                  icon={<ReloadOutlined />}
                  loading={refreshing}
                  onClick={() => refresh({}, { trackPending: true })}
                  disabled={state?.startup?.status === 'starting'}
                  aria-label={t('app.refresh')}
                />
              </Tooltip>
              <DashboardConnectionStatus initialState={state} t={t} />
            </Space>
          </Space>
        </Header>
        <Content className="content-wrap">
          <PageHeaderBlock
            title={navPageItems.find((item) => item.key === activePage)?.title || t('nav.dashboard')}
            description={pageDescriptions[activePage] || pageDescriptions.dashboard}
          />
          {error && (
            <Alert
              type="error"
              showIcon
              closable
              message={error}
              onClose={() => setError('')}
              className="app-error-alert"
            />
          )}

          <Suspense fallback={<Skeleton active paragraph={{ rows: 10 }} className="app-page-loading" />}>
          {activePage === 'dashboard' && (
            <DashboardPage
              api={api}
              initialState={state}
              installDraft={installDraft}
              installDraftDirty={installDraftDirty}
              checkingUpdates={checkingUpdates}
              installing={installing}
              handshaking={handshaking}
              updateActionLoading={updateActionLoading}
              checkForUpdates={checkForUpdates}
              chooseInstallDirectory={chooseInstallDirectory}
              confirmInstallIntegration={confirmInstallIntegration}
              confirmLaunchDownloadedInstallerUpdate={confirmLaunchDownloadedInstallerUpdate}
              downloadInstallerUpdate={downloadInstallerUpdate}
              handleChecklistAction={handleChecklistAction}
              openPortableDownloadPage={openPortableDownloadPage}
              openUpdateReleaseNotes={openUpdateReleaseNotes}
              runUpdateAction={runUpdateAction}
              setInstallDraft={setInstallDraft}
              setInstallDraftDirty={setInstallDraftDirty}
              testHandshake={testHandshake}
              t={t}
            />
          )}

          {activePage === 'builder' && (
            <BuilderPage
              profileItems={profileItems}
              defaultProfileId={defaultProfileId}
              currentProfile={currentProfile}
              providers={providerItems}
              assets={assets}
              isDirty={currentProfileDirty}
              onSelectProfile={selectProfile}
              onCreateBlankProfile={createEmptyProfile}
              onCreatePresetProfile={createNewProfile}
              creatingProfileKind={creatingProfileKind}
              onChangeProfile={patchCurrentProfile}
              onSaveProfile={saveCurrentProfile}
              onSetDefaultProfile={setCurrentProfileAsDefault}
              onBypassTranslationCacheOnce={bypassTranslationCacheForCurrentProfileOnce}
              onClearTranslationCache={confirmClearTranslationCache}
              translationCacheBypassPending={currentProfileTranslationCacheBypassPending}
              onDiscardProfile={confirmDiscardCurrentProfileChanges}
              onDuplicateProfile={duplicateCurrentProfile}
              savingProfile={savingProfile}
              duplicatingProfile={duplicatingProfile}
              onDeleteProfile={confirmDeleteProfile}
            />
          )}

          {activePage === 'assets' && (
            <AssetsPage
              profileItems={profileItems}
              assets={assets}
              assetImportRules={assetImportRules}
              importingAssetType={importingAssetType}
              onImportAsset={importAsset}
              onDeleteAsset={confirmDeleteAsset}
              onPreviewAsset={openAssetPreview}
            />
          )}

          {activePage === 'mapping' && (
            <MappingRulesPage
              api={api}
              rules={state?.memoqMetadataMapping?.rules || []}
              profiles={state?.contextBuilder?.profiles || []}
              defaultProfileId={defaultProfileId}
              onRefresh={() => refresh()}
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
              currentProviderConnectionSnapshot={currentProviderConnectionSnapshot}
              currentProviderConnectionStatus={currentProviderConnectionStatus}
              currentProviderHasPreviousTest={currentProviderHasPreviousTest}
              currentProviderTestMessage={currentProviderTestMessage}
              isDirty={currentProviderDirty}
              savingProvider={savingProvider}
              testingProvider={testingProvider}
              discoveringProviderModels={discoveringProviderModels}
              onCreateProvider={createProvider}
              onSelectProvider={selectProvider}
              onProviderSearchChange={setProviderSearch}
              onPatchProvider={patchCurrentProvider}
              onDiscardProviderChanges={confirmDiscardCurrentProviderChanges}
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
              insightFocus={providerInsightFocus}
              focusedModelName={providerInsightFocus?.model || ''}
              onBackToHistory={returnFromProviderInsightFocus}
              onClearInsightFocus={() => setProviderInsightFocus(null)}
            />
          )}

          {activePage === 'logs' && (
            <LogsPage
              logState={logState}
              loading={logLoading}
              pruning={logPruning}
              onRefresh={refreshLogs}
              onOpenLogsDir={openLogsDirectory}
              onPruneLogs={confirmPruneLogs}
              onRevealFile={revealLogFile}
              onCopyDiagnostics={copyLogDiagnostics}
            />
          )}

          {activePage === 'history' && (
            <HistoryPage
              activeHistoryFilterTags={activeHistoryFilterTags}
              applyHistoryFilters={applyHistoryFilters}
              confirmDeleteCurrentHistoryEntry={confirmDeleteCurrentHistoryEntry}
              confirmDeleteSelectedHistoryEntries={confirmDeleteSelectedHistoryEntries}
              confirmHistoryDeletion={confirmHistoryDeletion}
              currentHistoryListItem={currentHistoryListItem}
              currentHistoryRecord={currentHistoryRecord}
              deletingHistory={deletingHistory}
              exportHistory={exportHistory}
              exportingHistoryFormat={exportingHistoryFormat}
              historyDetailError={historyDetailError}
              historyDetailLoading={historyDetailLoading}
              historyFilterDraft={historyFilterDraft}
              historyFilterModelOptions={historyFilterModelOptions}
              historyFilterProviderOptions={historyFilterProviderOptions}
              historyFilters={historyFilters}
              historyInsightFocus={historyInsightFocus}
              historyInsights={historyInsights}
              historyRefreshing={historyRefreshing}
              onCloseHistoryDetail={closeHistoryDetail}
              refreshHistory={refreshHistory}
              resetHistoryFilters={resetHistoryFilters}
              selectedHistoryId={selectedHistoryId}
              selectedHistoryIds={selectedHistoryIds}
              setHistoryInsightFocus={setHistoryInsightFocus}
              setSelectedHistoryId={setSelectedHistoryId}
              setSelectedHistoryIds={setSelectedHistoryIds}
              t={t}
              updateHistoryFilterDraftField={updateHistoryFilterDraftField}
              visibleHistoryItems={visibleHistoryItems}
            />
          )}

          {activePage === 'quality' && (
            <QualityPage api={api} profiles={profileItems} providers={providerItems} promptPresets={state?.promptPresets || []} />
          )}
          </Suspense>
        </Content>
      </Layout>

      <Modal
        title={t('navigation.unsavedTitle')}
        open={Boolean(pendingNavigation)}
        onCancel={stayOnDirtyEditor}
        closable={!navigationResolving}
        maskClosable={!navigationResolving}
        footer={[
          <Button key="stay" onClick={stayOnDirtyEditor} disabled={navigationResolving}>
            {t('navigation.stay')}
          </Button>,
          <Button key="discard" danger onClick={discardAndContinueNavigation} disabled={navigationResolving}>
            {t('navigation.discardAndContinue')}
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={navigationResolving}
            disabled={pendingNavigation?.dirtyKind === 'provider' && currentProviderConnectionMeta.color !== 'green'}
            onClick={() => void saveAndContinueNavigation()}
          >
            {t('navigation.saveAndContinue')}
          </Button>
        ]}
      >
        <Space direction="vertical" size={8}>
          <Text>{t('navigation.unsavedDescription', {
            name: pendingNavigation?.dirtyKind === 'provider' ? currentProvider?.name || '-' : currentProfile?.name || '-'
          })}</Text>
          {pendingNavigation?.dirtyKind === 'provider' && currentProviderConnectionMeta.color !== 'green' ? (
            <Alert type="warning" showIcon message={t('navigation.providerMustTestBeforeSave')} />
          ) : null}
        </Space>
      </Modal>

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
        <Space direction="vertical" size={16} className="app-block-space">
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
              <Space direction="vertical" size={12} className="app-block-space">
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
              <Space direction="vertical" size={12} className="app-block-space">
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
                scroll={{ x: TABLE_SCROLL_X }}
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
