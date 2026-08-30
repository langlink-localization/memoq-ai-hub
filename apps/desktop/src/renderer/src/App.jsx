import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppstoreOutlined,
  ApartmentOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Button,
  Col,
  Layout,
  Menu,
  Result,
  Row,
  Skeleton,
  Spin,
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
import { useAssetPreviewController } from './hooks/useAssetPreviewController.mjs';
import { useDashboardActions } from './hooks/useDashboardActions.mjs';
import { useHistoryFilters } from './hooks/useHistoryFilters.mjs';
import { useLogsController } from './hooks/useLogsController.mjs';
import AssetPreviewDrawer from './components/AssetPreviewDrawer.jsx';
import NavigationConfirmModal from './components/NavigationConfirmModal.jsx';
import { AppHeader, AppNavigation } from './components/AppShellChrome.jsx';
import { useProfileController } from './hooks/useProfileController.mjs';
import { useProviderController } from './hooks/useProviderController.mjs';

const ProvidersPage = lazy(() => import('./pages/providers/ProvidersPage.jsx'));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage.jsx'));
const HistoryPage = lazy(() => import('./pages/history/HistoryPage.jsx'));
const BuilderPage = lazy(() => import('./pages/builder/BuilderPage.jsx'));
const AssetsPage = lazy(() => import('./pages/assets/AssetsPage.jsx'));
const MappingRulesPage = lazy(() => import('./pages/mapping/MappingRulesPage.jsx'));
const LogsPage = lazy(() => import('./pages/logs/LogsPage.jsx'));
const QualityPage = lazy(() => import('./pages/quality/QualityPage.jsx'));

const { Content } = Layout;
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
  const [selectedHistoryIds, setSelectedHistoryIds] = useState([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [importingAssetType, setImportingAssetType] = useState('');
  const [exportingHistoryFormat, setExportingHistoryFormat] = useState('');
  const [deletingHistory, setDeletingHistory] = useState(false);
  const [historyRefreshing, setHistoryRefreshing] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(() => initialShellStateRef.current.navCollapsed);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => Number(globalThis.innerWidth || 1366));
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [navigationResolving, setNavigationResolving] = useState(false);
  const pendingOperationsRef = useRef(null);
  if (!pendingOperationsRef.current) {
    pendingOperationsRef.current = createPendingOperationRegistry();
  }

  const logs = useLogsController({ api, t, message, modal, notifyError, appState: state });
  const historyFiltersController = useHistoryFilters({
    api,
    refresh,
    beginPendingOperation,
    setHistoryRefreshing,
    setSelectedHistoryIds,
    setSelectedHistoryId,
    setProviderInsightFocus
  });
  const { historyFilters } = historyFiltersController;
  const {
    providerId,
    setProviderId,
    providerDraftsById,
    setProviderDraftsById,
    setProviderTestStatesById,
    providerItems,
    filteredProviders,
    groupedProviders,
    currentProvider,
    currentProviderDirty,
    currentProviderConnectionMeta,
    currentProviderConnectionSnapshot,
    currentProviderConnectionStatus,
    currentProviderHasPreviousTest,
    currentProviderTestMessage,
    providerSearch,
    setProviderSearch,
    providerModelSelection,
    setProviderModelSelection,
    providerModelManagerOpen,
    setProviderModelManagerOpen,
    providerModelSearch,
    setProviderModelSearch,
    filteredCurrentProviderModelCatalog,
    providerInsightFocus,
    setProviderInsightFocus,
    savingProvider,
    testingProvider,
    discoveringProviderModels,
    createProvider,
    openInsightProvider,
    discardCurrentProviderChangesNow,
    confirmDiscardCurrentProviderChanges,
    patchCurrentProvider,
    patchCurrentModel,
    addModelToCurrentProvider,
    removeModelsFromCurrentProvider,
    setCurrentProviderDefaultModel,
    confirmDeleteProvider,
    confirmDeleteModel,
    confirmBulkDeleteModels,
    saveCurrentProvider,
    testProvider,
    discoverProviderModels
  } = useProviderController({ api, t, message, modal, notifyError, refresh, requestNavigation, requestPageNavigation, state });
  const {
    profileId,
    setProfileId,
    profileDraftsById,
    setProfileDraftsById,
    profileItems,
    defaultProfileId,
    currentProfile,
    currentProfileDirty,
    savingProfile,
    duplicatingProfile,
    creatingProfileKind,
    translationCacheBypassPending: currentProfileTranslationCacheBypassPending,
    patchCurrentProfile,
    saveCurrentProfile,
    discardCurrentProfileChangesNow,
    confirmDiscardCurrentProfileChanges,
    duplicateCurrentProfile,
    setCurrentProfileAsDefault,
    bypassTranslationCacheForCurrentProfileOnce,
    confirmClearTranslationCache,
    toggleAssetBinding,
    createNewProfile,
    createEmptyProfile,
    confirmDeleteProfile
  } = useProfileController({ api, t, message, modal, notifyError, refresh, beginPendingOperation, requestNavigation, state, providerItems });

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

  useEffect(() => {
    setError('');
  }, [activePage]);

  const {
    record: historyDetailRecord,
    loading: historyDetailLoading,
    error: historyDetailError
  } = useHistoryDetail({ api, selectedHistoryId, t });

  const assetImportRules = state?.contextBuilder?.assetImportRules || {};
  const assets = state?.contextBuilder?.assets || [];

  const assetPreview = useAssetPreviewController({ api, t, message, notifyError, refresh, assets });
  const dashboard = useDashboardActions({ api, t, message, modal, notifyError, refresh, historyFilters, setState, startupStatus: state?.startup?.status });

  useAppDataLifecycle({
    activePage,
    startupStatus: state?.startup?.status,
    historyFilters,
    refresh,
    refreshDashboardStatus: dashboard.refreshDashboardStatus,
    refreshLogs: logs.refreshLogs
  });
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

  const { persistCurrentPageScrollPosition } = useShellLifecycle({
    initialShellState: initialShellStateRef.current,
    activePage,
    navCollapsed,
    setViewportWidth,
    shellNavigationMode,
    setMobileNavOpen,
    hasUnsavedDrafts
  });

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
        void assetPreview.openAssetPreview(importedAsset.id, { fallbackAsset: importedAsset });
      }
    } catch (assetError) {
      notifyError(assetError);
    } finally {
      endPending();
    }
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

  function selectProvider(providerEntryId = '') {
    requestNavigation('provider', providerEntryId);
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
      <AppNavigation
        shellNavigationMode={shellNavigationMode}
        navCollapsed={navCollapsed}
        onToggleCollapsed={() => setNavCollapsed((current) => !current)}
        activePage={activePage}
        mobileNavOpen={mobileNavOpen}
        onCloseMobileNav={() => setMobileNavOpen(false)}
        navItems={navItems}
        requestPageNavigation={requestPageNavigation}
      />
      <Layout>
        <AppHeader
          shellNavigationMode={shellNavigationMode}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          locale={locale}
          setLocale={setLocale}
          refreshing={refreshing}
          onRefresh={() => refresh({}, { trackPending: true })}
          startupStatus={state?.startup?.status}
          initialState={state}
        />
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
              installDraft={dashboard.installDraft}
              installDraftDirty={dashboard.installDraftDirty}
              checkingUpdates={dashboard.checkingUpdates}
              installing={dashboard.installing}
              handshaking={dashboard.handshaking}
              updateActionLoading={dashboard.updateActionLoading}
              checkForUpdates={dashboard.checkForUpdates}
              chooseInstallDirectory={dashboard.chooseInstallDirectory}
              confirmInstallIntegration={dashboard.confirmInstallIntegration}
              confirmLaunchDownloadedInstallerUpdate={dashboard.confirmLaunchDownloadedInstallerUpdate}
              downloadInstallerUpdate={dashboard.downloadInstallerUpdate}
              handleChecklistAction={handleChecklistAction}
              openPortableDownloadPage={dashboard.openPortableDownloadPage}
              openUpdateReleaseNotes={dashboard.openUpdateReleaseNotes}
              runUpdateAction={dashboard.runUpdateAction}
              setInstallDraft={dashboard.setInstallDraft}
              setInstallDraftDirty={dashboard.setInstallDraftDirty}
              testHandshake={dashboard.testHandshake}
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
              logState={logs.logState}
              loading={logs.logLoading}
              pruning={logs.logPruning}
              onRefresh={logs.refreshLogs}
              onOpenLogsDir={logs.openLogsDirectory}
              onPruneLogs={logs.confirmPruneLogs}
              onRevealFile={logs.revealLogFile}
              onCopyDiagnostics={logs.copyLogDiagnostics}
            />
          )}

          {activePage === 'history' && (
            <HistoryPage
              activeHistoryFilterTags={activeHistoryFilterTags}
              applyHistoryFilters={historyFiltersController.applyHistoryFilters}
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
              historyFilterDraft={historyFiltersController.historyFilterDraft}
              historyFilterModelOptions={historyFilterModelOptions}
              historyFilterProviderOptions={historyFilterProviderOptions}
              historyFilters={historyFilters}
              historyInsightFocus={historyFiltersController.historyInsightFocus}
              historyInsights={historyInsights}
              historyRefreshing={historyRefreshing}
              onCloseHistoryDetail={closeHistoryDetail}
              refreshHistory={historyFiltersController.refreshHistory}
              resetHistoryFilters={historyFiltersController.resetHistoryFilters}
              selectedHistoryId={selectedHistoryId}
              selectedHistoryIds={selectedHistoryIds}
              setHistoryInsightFocus={historyFiltersController.setHistoryInsightFocus}
              setSelectedHistoryId={setSelectedHistoryId}
              setSelectedHistoryIds={setSelectedHistoryIds}
              t={t}
              updateHistoryFilterDraftField={historyFiltersController.updateHistoryFilterDraftField}
              visibleHistoryItems={visibleHistoryItems}
            />
          )}

          {activePage === 'quality' && (
            <QualityPage api={api} profiles={profileItems} providers={providerItems} promptPresets={state?.promptPresets || []} />
          )}
          </Suspense>
        </Content>
      </Layout>

      <NavigationConfirmModal
        pendingNavigation={pendingNavigation}
        navigationResolving={navigationResolving}
        currentProvider={currentProvider}
        currentProfile={currentProfile}
        currentProviderConnectionMeta={currentProviderConnectionMeta}
        onStay={stayOnDirtyEditor}
        onDiscardAndContinue={discardAndContinueNavigation}
        onSaveAndContinue={saveAndContinueNavigation}
      />

      <AssetPreviewDrawer controller={assetPreview} />

    </Layout>
  );
}
