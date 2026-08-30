const {
  ASSET_PURPOSES,
  getAssetImportRules,
  normalizeAssetPurpose
} = require('../asset/assetContext');
const { summarizeRuleConditions } = require('../shared/memoqMetadata');
const { getSupportedPlaceholders } = require('../shared/promptTemplate');
const { getFirstReleaseVisiblePlaceholders } = require('../shared/profilePolicy');
const { PRODUCT_NAME, CONTRACT_VERSION, DEFAULT_HOST, DEFAULT_PORT } = require('../shared/desktopContract');
const { getIntegrationStatus } = require('../integration/integrationService');
const { filterHistoryEntries } = require('./runtimeHistory');
const { buildHistoryInsights, buildIntegrationConfig } = require('./runtimeHistoryIntegrationSupport');

// Dashboard checklist and notice assembly are pure projections of the loaded
// state; getState composes them into the renderer-facing app-state payload.
function buildChecklist(state, history, integration, providers) {
  const enabledProviderCount = providers.filter((item) => item.enabled).length;
  const assetCount = Array.isArray(state.assets) ? state.assets.length : 0;
  return [
    { key: 'install-plugin', title: '1. Install integration', subtitle: integration.status === 'installed' ? 'Integration ready' : 'Integration not installed', actionLabel: 'Install or repair', completed: integration.status === 'installed', count: integration.status === 'installed' ? 1 : 0 },
    { key: 'provider-hub', title: '2. Connect AI service', subtitle: enabledProviderCount ? `${enabledProviderCount} service(s)` : 'No AI service yet', actionLabel: 'Connect', completed: enabledProviderCount > 0, count: enabledProviderCount },
    { key: 'asset-hub', title: '3. Add optional assets', subtitle: assetCount ? `${assetCount} asset(s)` : 'Optional — no assets uploaded', actionLabel: 'Add assets', completed: assetCount > 0, optional: true, count: assetCount },
    { key: 'context-builder', title: '4. Create profile', subtitle: state.profiles.length ? `${state.profiles.length} profile(s)` : 'No profile yet', actionLabel: 'Create', completed: state.profiles.length > 0, count: state.profiles.length },
    { key: 'history', title: '5. Review a run', subtitle: history.length ? `${history.length} record(s)` : 'No translation records yet', actionLabel: 'Review', completed: history.length > 0, count: history.length }
  ];
}

function buildNotices(state, providers, history, integration, updateStatus) {
  const notices = [];
  if (!integration.installations.length) notices.push('No memoQ installation directory was detected.');
  if (!providers.length) notices.push('No provider has been configured yet.');
  const unhealthy = providers.filter((provider) => provider.enabled && provider.status === 'failed');
  if (unhealthy.length) notices.push(`${unhealthy.map((provider) => provider.name).join(', ')} need attention.`);
  const latest = history[0];
  if (latest) notices.push(latest.status === 'success' ? `Latest translation succeeded: ${latest.requestId}` : `Latest translation failed: ${latest.requestId}`);
  if (updateStatus.updateStatus === 'available') notices.push(`Version ${updateStatus.latestVersion || ''} is available.`);
  if (updateStatus.updateStatus === 'error') notices.push(updateStatus.lastError || 'The last update check failed.');
  return notices;
}

// Owns the renderer-facing app-state read model: dashboard checklist/notices,
// runtime status, context-builder projection, prompt presets, mapping rules,
// provider hub summary, and history explorer presentation.
function createRuntimeStateView({
  loadState,
  loadHistoryEntries,
  buildHistoryListItem,
  enrichProviders,
  syncPreviewBridgeStatusFromClient,
  updateService,
  isGatewayReady,
  bypassTranslationCacheProfileIds,
  paths
}) {
  function getState(filters = {}) {
    const state = loadState();
    const includeHistoryExplorer = filters.includeHistoryExplorer !== false;
    const includeProviderHistoryMetrics = filters.includeProviderHistoryMetrics !== false;
    const historyEntries = (includeHistoryExplorer || includeProviderHistoryMetrics) ? loadHistoryEntries() : [];
    const integration = getIntegrationStatus(paths, buildIntegrationConfig(state));
    const history = includeHistoryExplorer ? filterHistoryEntries(historyEntries, filters) : [];
    const providers = enrichProviders(state, includeProviderHistoryMetrics ? historyEntries : []);
    const previewStatus = syncPreviewBridgeStatusFromClient();
    const updateStatus = updateService.getStatus();
    return {
      productName: PRODUCT_NAME,
      contractVersion: CONTRACT_VERSION,
      gatewayBaseUrl: `http://${DEFAULT_HOST}:${DEFAULT_PORT}`,
      dashboard: {
        checklist: buildChecklist(state, history, integration, providers),
        runtimeStatus: {
          memoqInstallPath: integration.selectedInstallDir || integration.installations[0]?.rootDir || 'Not detected',
          pluginStatus: integration.status,
          connectionStatus: isGatewayReady() ? 'Connected' : 'Disconnected',
          previewStatus
        },
        updateCenter: updateStatus,
        notices: buildNotices(state, providers, history, integration, updateStatus)
      },
      integration,
      previewBridge: previewStatus,
      updateCenter: updateStatus,
      contextBuilder: {
        profiles: state.profiles,
        defaultProfileId: state.defaultProfileId,
        assets: state.assets,
        supportedPlaceholders: getFirstReleaseVisiblePlaceholders(getSupportedPlaceholders()),
        assetImportRules: getAssetImportRules(),
        translationCacheBypassProfileIds: Array.from(bypassTranslationCacheProfileIds)
      },
      promptPresets: filters.includePromptPresets === false ? [] : state.promptPresets,
      memoqMetadataMapping: {
        rules: [...state.mappingRules]
          .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999))
          .map((rule) => ({ ...rule, conditionSummary: summarizeRuleConditions(rule) }))
      },
      providerHub: {
        providers,
        summary: {
          enabled: providers.filter((item) => item.enabled).length,
          healthy: providers.filter((item) => item.enabled && item.status === 'connected').length
        }
      },
      historyExplorer: {
        insights: includeHistoryExplorer ? buildHistoryInsights(history) : buildHistoryInsights([]),
        items: includeHistoryExplorer ? history.map((entry) => buildHistoryListItem(entry)) : []
      }
    };
  }

  return {
    getState
  };
}

module.exports = {
  createRuntimeStateView
};
