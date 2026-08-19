export const DEFAULT_HISTORY_INSIGHTS = {
  totalRequests: 0,
  totalSegments: 0,
  successRate: null,
  avgLatencyMs: null,
  slowRequestCount: 0,
  failedCount: 0,
  timeoutCount: 0,
  rateLimitCount: 0,
  exactCacheHitCount: 0,
  adaptiveCacheHitCount: 0,
  cacheHitCount: 0,
  cacheHitRate: null,
  batchFallbackCount: 0,
  providerBreakdown: [],
  attentionItems: []
};

export function createFallbackAppState() {
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
      updateCenter: {
        currentVersion: '',
        releaseChannel: 'stable',
        packagingMode: 'portable',
        updateStatus: 'idle',
        latestVersion: '',
        releaseNotes: '',
        releaseNotesUrl: '',
        portableDownloadUrl: '',
        publishedAt: '',
        downloadedArtifactPath: '',
        preparedDirectory: '',
        lastCheckedAt: '',
        lastError: '',
        lastErrorCode: '',
        manifestUrl: '',
        pluginReinstallRecommended: true,
        availableAssets: {
          portable: null,
          installer: null
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
    contextBuilder: {
      profiles: [],
      defaultProfileId: '',
      assets: [],
      supportedPlaceholders: [],
      assetImportRules: {},
      translationCacheBypassProfileIds: []
    },
    promptPresets: [],
    memoqMetadataMapping: { rules: [] },
    providerHub: { providers: [], summary: { enabled: 0, healthy: 0 } },
    historyExplorer: {
      items: [],
      insights: DEFAULT_HISTORY_INSIGHTS
    },
    updateCenter: {
      currentVersion: '',
      releaseChannel: 'stable',
      packagingMode: 'portable',
      updateStatus: 'idle',
      latestVersion: '',
      releaseNotes: '',
      releaseNotesUrl: '',
      portableDownloadUrl: '',
      publishedAt: '',
      downloadedArtifactPath: '',
      preparedDirectory: '',
      lastCheckedAt: '',
      lastError: '',
      lastErrorCode: '',
      manifestUrl: '',
      pluginReinstallRecommended: true,
      availableAssets: {
        portable: null,
        installer: null
      }
    }
  };
}

export function normalizeAppStatePayload(data = {}) {
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
      },
      updateCenter: {
        ...fallback.dashboard.updateCenter,
        ...(nextState.dashboard?.updateCenter || {})
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
      translationCacheBypassProfileIds: Array.isArray(nextState.contextBuilder?.translationCacheBypassProfileIds)
        ? nextState.contextBuilder.translationCacheBypassProfileIds.map((item) => String(item || '')).filter(Boolean)
        : fallback.contextBuilder.translationCacheBypassProfileIds,
      assetImportRules: nextState.contextBuilder?.assetImportRules && typeof nextState.contextBuilder.assetImportRules === 'object'
        ? nextState.contextBuilder.assetImportRules
        : fallback.contextBuilder.assetImportRules
    },
    promptPresets: Array.isArray(nextState.promptPresets) ? nextState.promptPresets : fallback.promptPresets,
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
      items: Array.isArray(nextState.historyExplorer?.items) ? nextState.historyExplorer.items : fallback.historyExplorer.items,
      insights: nextState.historyExplorer?.insights && typeof nextState.historyExplorer.insights === 'object'
        ? {
          ...fallback.historyExplorer.insights,
          ...nextState.historyExplorer.insights,
          providerBreakdown: Array.isArray(nextState.historyExplorer.insights.providerBreakdown) ? nextState.historyExplorer.insights.providerBreakdown : [],
          attentionItems: Array.isArray(nextState.historyExplorer.insights.attentionItems) ? nextState.historyExplorer.insights.attentionItems : []
        }
        : fallback.historyExplorer.insights
    },
    updateCenter: {
      ...fallback.updateCenter,
      ...(nextState.updateCenter || {})
    }
  };
}

export function preserveProviderHistoryMetrics(remoteData, currentState) {
  if (!remoteData?.providerHub || !currentState?.providerHub) {
    return remoteData;
  }

  const metricsByProviderId = new Map((currentState.providerHub.providers || []).map((provider) => [
    provider.id,
    {
      successRate24h: provider.successRate24h ?? null,
      avgLatencyMs: provider.avgLatencyMs ?? null
    }
  ]));

  return normalizeAppStatePayload({
    ...remoteData,
    providerHub: {
      ...(remoteData.providerHub || {}),
      providers: (remoteData.providerHub.providers || []).map((provider) => {
        const metrics = metricsByProviderId.get(provider.id);
        if (!metrics) {
          return provider;
        }
        return {
          ...provider,
          successRate24h: metrics.successRate24h,
          avgLatencyMs: metrics.avgLatencyMs
        };
      })
    }
  });
}
