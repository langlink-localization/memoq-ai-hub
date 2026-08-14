import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  APP_SECTIONS,
  buildCollapsiblePanelEntries,
  buildDefaultPresetProfile,
  DEFAULT_PRESET_BATCH_USER_PROMPT,
  DEFAULT_PRESET_SINGLE_USER_PROMPT,
  buildHistoryPromptItems,
  getHistoryRenderedUserPrompt,
  shouldShowHistoryActualSentContent,
  buildProviderModelTableRows,
  getPanelColumnSpan
} from '../src/renderer/src/appShell.mjs';
import en from '../src/renderer/src/locales/en.js';
import zhCN from '../src/renderer/src/locales/zh-CN.js';
import { SHELL_BREAKPOINTS } from '../src/renderer/src/uiBehavior.mjs';

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..');

function readRendererSource(relativePath) {
  return fs.readFileSync(path.join(DESKTOP_ROOT, 'src', 'renderer', 'src', relativePath), 'utf8');
}

function readRendererSources(...relativePaths) {
  return relativePaths.map(readRendererSource).join('\n');
}

function collectLocaleKeys(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      return collectLocaleKeys(child, nextPrefix);
    }
    return [nextPrefix];
  });
}

test('app sections expose assets and logs as first-class top-level modules', () => {
  assert.deepEqual(
    APP_SECTIONS.map((item) => item.key),
    ['dashboard', 'providers', 'assets', 'builder', 'history', 'logs']
  );
});

test('feature pages load behind explicit renderer boundaries', () => {
  const appSource = readRendererSource('App.jsx');
  const dashboardSource = readRendererSource('pages/dashboard/DashboardPage.jsx');
  const historySource = readRendererSources(
    'pages/history/HistoryPage.jsx',
    'pages/history/HistoryDetailDrawer.jsx'
  );

  assert.match(appSource, /import \{ lazy, Suspense,/);
  assert.match(appSource, /lazy\(\(\) => import\('\.\/pages\/dashboard\/DashboardPage\.jsx'\)\)/);
  assert.match(appSource, /lazy\(\(\) => import\('\.\/pages\/history\/HistoryPage\.jsx'\)\)/);
  assert.match(appSource, /lazy\(\(\) => import\('\.\/pages\/providers\/ProvidersPage\.jsx'\)\)/);
  assert.match(appSource, /lazy\(\(\) => import\('\.\/pages\/builder\/BuilderPage\.jsx'\)\)/);
  assert.match(appSource, /lazy\(\(\) => import\('\.\/pages\/assets\/AssetsPage\.jsx'\)\)/);
  assert.match(appSource, /lazy\(\(\) => import\('\.\/pages\/logs\/LogsPage\.jsx'\)\)/);
  assert.match(appSource, /<Suspense fallback=\{<Skeleton active/);
  assert.doesNotMatch(appSource, /dashboard-journey-grid/);
  assert.doesNotMatch(appSource, /history\.diagnosticSummary/);
  assert.match(dashboardSource, /dashboard-journey-grid/);
  assert.match(historySource, /history\.diagnosticSummary/);
});

test('Chinese locale is independent and matches English locale keys', () => {
  assert.notEqual(zhCN, en);
  assert.deepEqual(
    collectLocaleKeys(zhCN).sort(),
    collectLocaleKeys(en).sort()
  );
  assert.equal(zhCN.nav.logs, '日志');
  assert.equal(en.nav.assets, 'Assets');
  assert.equal(zhCN.nav.assets, '资产');
  assert.equal(zhCN.providers.title, 'AI 服务');
  assert.equal(en.nav.providers, 'AI Services');
  assert.equal(en.history.insights.title, 'History insights');
  assert.equal(zhCN.history.insights.title, '历史洞察');
  assert.equal(en.history.issue.timeout, 'Timeouts');
  assert.equal(zhCN.history.issue.timeout, '超时');
  assert.equal(en.history.issueTag.cache_hit, 'Cache hit');
  assert.equal(zhCN.history.issueTag.cache_hit, '缓存命中');
  assert.equal(en.history.diagnosticSummary, 'Diagnostic summary');
  assert.equal(zhCN.history.diagnosticSummary, '诊断摘要');
  assert.equal(en.providers.insightFocusTitle, 'Opened from History Insights');
  assert.equal(zhCN.providers.insightFocusTitle, '从历史洞察打开');
  assert.equal(en.common.dismiss, 'Dismiss');
  assert.equal(zhCN.common.dismiss, '关闭提示');
});

test('dashboard keeps refresh controls icon-first and guards stale available updates', () => {
  const appSource = readRendererSource('App.jsx');
  const dashboardSource = readRendererSources(
    'pages/dashboard/DashboardPage.jsx',
    'pages/dashboard/dashboardPresentation.mjs'
  );

  assert.match(appSource, /className="app-header-refresh"/);
  assert.match(appSource, /aria-label=\{t\('app\.refresh'\)\}/);
  assert.match(dashboardSource, /const safeUpdateStatus = getSafeUpdateStatus\(updateCenter\);/);
  assert.match(dashboardSource, /const effectiveUpdateStatus = checkingUpdates \? 'checking' : safeUpdateStatus;/);
  assert.match(dashboardSource, /const latestVersionDisplay = updateCenter\.latestVersion/);
  assert.match(appSource, /getUpdateErrorDisplay\(result, t\)/);
  assert.match(dashboardSource, /const hasAvailableUpdate = !checkingUpdates && safeUpdateStatus === 'available';/);
  assert.match(dashboardSource, /icon=\{<ReloadOutlined \/>}/);
  assert.match(en.dashboard.updateCheckingLatestVersion, /Checking/);
  assert.equal(zhCN.dashboard.updateCheckingLatestVersion, '检查中...');
  assert.match(en.dashboard.updateCheckTimeoutError, /timed out/i);
  assert.match(zhCN.dashboard.updateCheckTimeoutError, /超时/);
});

test('history insights expose simple latency-focused filtering hooks', () => {
  const appSource = readRendererSources('App.jsx', 'pages/history/HistoryPage.jsx');

  assert.match(appSource, /issue:\s*''/);
  assert.match(appSource, /function applyHistoryInsightFilter/);
  assert.match(appSource, /historyInsightFocus/);
  assert.match(appSource, /history\.insights\.avgLatency/);
  assert.match(appSource, /history\.insights\.slowRequests/);
  assert.match(appSource, /history\.insights\.failedRequestsTitle/);
  assert.doesNotMatch(appSource, /history\.insights\.p95Latency/);
  assert.doesNotMatch(appSource, /history\.insights\.cacheHitRate/);
  assert.match(appSource, /getHistoryIssueLabel/);
  assert.match(appSource, /history\.issueFilter/);
});

test('history records expose per-entry diagnostics and attempt timeline affordances', () => {
  const appSource = readRendererSources(
    'App.jsx',
    'pages/history/HistoryPage.jsx',
    'pages/history/HistoryDetailDrawer.jsx',
    'pages/history/historyPresentation.mjs'
  );
  const cssSource = readRendererSource('index.css');

  assert.match(appSource, /function buildHistoryIssueTags/);
  assert.match(appSource, /function buildHistoryDiagnosticSummary/);
  assert.match(appSource, /function buildHistoryAttemptRows/);
  assert.match(appSource, /title:\s*t\('history\.issues'\)/);
  assert.match(appSource, /history\.diagnosticSummary/);
  assert.match(appSource, /history\.attemptTimeline/);
  assert.match(appSource, /history\.noAttempts/);
  assert.match(cssSource, /\.history-issue-tag-row/);
  assert.match(cssSource, /\.history-diagnostic-card/);
  assert.match(cssSource, /\.history-attempt-status-tag/);
});

test('history refreshes preserve loaded records outside the history page', () => {
  const appSource = readRendererSource('App.jsx');

  assert.match(appSource, /const includeHistoryExplorer = typeof options\.includeHistoryExplorer === 'boolean'/);
  assert.match(appSource, /if \(!includeHistoryExplorer && current\?\.historyExplorer\)/);
  assert.match(appSource, /historyExplorer: current\.historyExplorer/);
  assert.match(appSource, /void refresh\(historyFilters, \{ includeHistoryExplorer: true \}\)/);
  assert.match(appSource, /refresh\(historyFilters, \{ includeHistoryExplorer: true \}\)/);
});

test('provider refreshes preserve loaded history metrics outside the providers page', () => {
  const appSource = readRendererSource('App.jsx');

  assert.match(appSource, /function preserveProviderHistoryMetrics/);
  assert.match(appSource, /successRate24h: provider\.successRate24h \?\? null/);
  assert.match(appSource, /avgLatencyMs: provider\.avgLatencyMs \?\? null/);
  assert.match(appSource, /if \(!includeProviderHistoryMetrics\)/);
  assert.match(appSource, /preserveProviderHistoryMetrics\(nextData, current\)/);
  assert.match(appSource, /void refresh\(\{\}, \{ includeProviderHistoryMetrics: true \}\)/);
});

test('provider page exposes history insight focus affordances', () => {
  const providerSource = readRendererSource('pages/providers/ProvidersPage.jsx');
  const cssSource = readRendererSource('index.css');

  assert.match(providerSource, /insightFocus/);
  assert.match(providerSource, /onBackToHistory/);
  assert.match(providerSource, /onClearInsightFocus/);
  assert.match(providerSource, /focusedModelName/);
  assert.match(providerSource, /provider-model-row-focused/);
  assert.match(providerSource, /providers\.insightFocusTitle/);
  assert.match(providerSource, /providers\.backToHistory/);
  assert.match(cssSource, /\.provider-insight-focus-alert/);
  assert.match(cssSource, /\.provider-model-row-focused > td/);
});

test('renderer feedback uses the themed Ant Design app context and recoverable startup states', () => {
  const mainSource = readRendererSource('main.jsx');
  const appSource = readRendererSource('App.jsx');

  assert.match(mainSource, /<AntdApp>/);
  assert.match(appSource, /const \{ message, modal \} = AntdApp\.useApp\(\);/);
  assert.doesNotMatch(appSource, /\n\s*message,\s*\n/);
  assert.doesNotMatch(appSource, /Modal\.confirm\(/);
  assert.match(appSource, /className="app-initial-loading"/);
  assert.match(appSource, /<Result[\s\S]*app\.startupErrorTitle/);
  assert.match(appSource, /closable[\s\S]*onClose=\{\(\) => setError\(''\)\}/);
});

test('high-risk actions and async mutations expose confirmation and pending contracts', () => {
  const appSource = readRendererSources('App.jsx', 'pages/history/HistoryPage.jsx');
  const builderSource = readRendererSource('pages/builder/BuilderPage.jsx');
  const assetsSource = readRendererSource('pages/assets/AssetsPage.jsx');

  assert.match(appSource, /function confirmPruneLogs\(\)/);
  assert.match(appSource, /function confirmInstallIntegration\(\)/);
  assert.match(appSource, /function confirmLaunchDownloadedInstallerUpdate\(dashboardUpdateCenter = \{\}\)/);
  assert.match(appSource, /function confirmDiscardCurrentProfileChanges\(\)/);
  assert.match(appSource, /function confirmDiscardCurrentProviderChanges\(\)/);
  assert.equal((appSource.match(/okButtonProps: \{ danger: true \}/g) || []).length >= 5, true);
  assert.match(appSource, /beginPendingOperation\('profile-save'/);
  assert.match(appSource, /beginPendingOperation\('profile-create'/);
  assert.match(appSource, /beginPendingOperation\('asset-import'/);
  assert.match(appSource, /beginPendingOperation\('history-export'/);
  assert.match(appSource, /beginPendingOperation\('history-delete'/);
  assert.match(builderSource, /loading=\{saving\}/);
  assert.match(builderSource, /disabled: saving \|\| duplicating/);
  assert.match(assetsSource, /loading=\{Boolean\(importingAssetType\)\}/);
  assert.match(appSource, /history\.exportSelectedCsv/);
  assert.match(appSource, /history\.exportFilteredXlsx/);
});

test('renderer theme uses one Ant Design token contract without internal selector overrides', () => {
  const mainSource = readRendererSource('main.jsx');
  const appSource = readRendererSource('App.jsx');
  const cssSource = readRendererSource('index.css');

  assert.match(mainSource, /cssVar:\s*\{[\s\S]*prefix: 'memoq'/);
  assert.match(mainSource, /colorPrimary: '#0066ff'/);
  assert.doesNotMatch(cssSource, /--app-/);
  assert.doesNotMatch(cssSource, /\.ant-/);
  assert.doesNotMatch(cssSource, /!important/);
  assert.doesNotMatch(cssSource, /--memoq-color-bg-layout-(?:alt|card|elevated|soft)/);
  assert.match(cssSource, /var\(--memoq-color-bg-layout\)/);
  assert.doesNotMatch(appSource, /style=\{\{ display: 'flex'/);
});

test('dashboard polling updates only changed status slices', () => {
  const appSource = readRendererSource('App.jsx');
  const dashboardSource = readRendererSource('pages/dashboard/DashboardPage.jsx');
  const connectionSource = readRendererSource('components/DashboardConnectionStatus.jsx');
  const storeSource = readRendererSource('pages/dashboard/dashboardStatusStore.mjs');
  const pollSource = appSource.slice(
    appSource.indexOf('async function refreshDashboardStatus()'),
    appSource.indexOf('async function pruneLogsNow()')
  );

  assert.match(storeSource, /DASHBOARD_STATUS_KEYS = \['startup', 'dashboard', 'integration', 'previewBridge', 'updateCenter'\]/);
  assert.match(storeSource, /mergeChangedStateSlices\(/);
  assert.match(pollSource, /setDashboardStatusSnapshot\(remoteData\)/);
  assert.doesNotMatch(pollSource, /setState\(/);
  assert.match(dashboardSource, /useSyncExternalStore\(/);
  assert.match(connectionSource, /useSyncExternalStore\(/);
  assert.match(appSource, /void refreshDashboardStatus\(\);/);
});

test('priority configuration fields use Ant Design form controls', () => {
  const appSource = readRendererSource('App.jsx');
  const historySource = readRendererSource('pages/history/HistoryPage.jsx');
  const builderSource = readRendererSource('pages/builder/BuilderPage.jsx');
  const providersSource = readRendererSource('pages/providers/ProvidersPage.jsx');

  assert.match(providersSource, /<Form layout="vertical"/);
  assert.match(providersSource, /<Form\.Item[\s\S]*providers\.apiKey/);
  assert.match(builderSource, /<InputNumber className="builder-number-input"/);
  assert.equal((builderSource.match(/<InputNumber/g) || []).length, 4);
  assert.match(historySource, /<DatePicker[\s\S]*format="YYYY-MM-DD"/);
  assert.equal((historySource.match(/<DatePicker/g) || []).length, 2);
});

test('translation style presets and empty-state next actions stay localized and explicit', () => {
  const builderSource = readRendererSource('pages/builder/BuilderPage.jsx');
  const assetsSource = readRendererSource('pages/assets/AssetsPage.jsx');
  const providersSource = readRendererSource('pages/providers/ProvidersPage.jsx');

  assert.match(builderSource, /TRANSLATION_STYLE_PRESETS/);
  assert.match(builderSource, /t\(selected\.instructionKey\)/);
  assert.doesNotMatch(builderSource, /Prefer natural, concise/);
  assert.match(assetsSource, /<Empty[\s\S]*<Dropdown menu=\{addAssetMenu\}/);
  assert.match(providersSource, /<Empty description=\{t\('providers\.createProviderFirst'\)\}>[\s\S]*<Dropdown menu=\{addProviderMenu\}/);
});

test('dashboard and history use responsive grid and horizontal table scroll', () => {
  const appSource = readRendererSource('App.jsx');
  const dashboardSource = readRendererSource('pages/dashboard/DashboardPage.jsx');
  const historySource = readRendererSource('pages/history/HistoryPage.jsx');
  const historyDetailSource = readRendererSource('pages/history/HistoryDetailDrawer.jsx');
  const tableLayoutSource = readRendererSource('tableLayout.mjs');
  const pageSource = `${dashboardSource}\n${historySource}\n${historyDetailSource}`;
  const cssSource = readRendererSource('index.css');

  assert.match(tableLayoutSource, /TABLE_SCROLL_X = 'max-content'/);
  assert.match(appSource, /const WIDE_SIDE_DRAWER_WIDTH = 'min\(920px, calc\(100vw - 32px\)\)';/);
  assert.match(historyDetailSource, /const HISTORY_DETAIL_DRAWER_WIDTH = 'min\(920px, calc\(100vw - 32px\)\)';/);
  assert.match(dashboardSource, /className="dashboard-journey-grid"/);
  assert.match(cssSource, /grid-template-columns:\s*repeat\(auto-fit, minmax\(190px, 1fr\)\)/);
  assert.match(dashboardSource, /<Col xs=\{24\} xl=\{12\}>/);
  assert.match(historySource, /<Col xs=\{24\} lg=\{12\}>/);
  assert.match(historySource, /<Col xs=\{24\} sm=\{12\} lg=\{8\} xl=\{4\}>/);
  assert.match(pageSource, /scroll=\{\{ x: TABLE_SCROLL_X \}\}/);
  assert.equal((`${appSource}\n${pageSource}`.match(/scroll=\{\{ x: TABLE_SCROLL_X \}\}/g) || []).length >= 3, true);
  assert.match(appSource, /width=\{WIDE_SIDE_DRAWER_WIDTH\}/);
  assert.match(historyDetailSource, /width=\{HISTORY_DETAIL_DRAWER_WIDTH\}/);
});

test('renderer tables use semantic column-width tokens instead of inline pixel widths', () => {
  const tableLayoutSource = readRendererSource('tableLayout.mjs');
  const tableSources = readRendererSources(
    'App.jsx',
    'pages/history/HistoryPage.jsx',
    'pages/history/HistoryDetailDrawer.jsx',
    'pages/logs/LogsPage.jsx',
    'pages/providers/ProvidersPage.jsx'
  );

  assert.match(tableLayoutSource, /TABLE_COLUMN_WIDTHS = Object\.freeze/);
  assert.match(tableSources, /TABLE_COLUMN_WIDTHS\.identifier/);
  assert.match(tableSources, /TABLE_COLUMN_WIDTHS\.timestamp/);
  assert.match(tableSources, /TABLE_COLUMN_WIDTHS\.inlineActions/);
  assert.doesNotMatch(tableSources, /\bwidth:\s*\d+/);
});

test('feature pages keep tables and overlays responsive on narrow viewports', () => {
  const builderSource = readRendererSource('pages/builder/BuilderPage.jsx');
  const providersSource = readRendererSource('pages/providers/ProvidersPage.jsx');
  const logsSource = readRendererSource('pages/logs/LogsPage.jsx');
  const assetsSource = readRendererSource('pages/assets/AssetsPage.jsx');

  assert.match(builderSource, /type: 'custom_tm'/);
  assert.match(builderSource, /titleKey: 'context\.assetRoleTmTitle'/);
  assert.match(builderSource, /fieldName: 'customTmAssetId'/);
  assert.match(builderSource, /mode="multiple"/);
  assert.match(builderSource, /onProfileChange\('customTmMatchBuckets', value\)/);
  assert.match(providersSource, /const TABLE_SCROLL_X = 'max-content';/);
  assert.match(providersSource, /const MODEL_LIBRARY_MODAL_WIDTH = 'min\(920px, calc\(100vw - 32px\)\)';/);
  assert.match(providersSource, /scroll=\{\{ x: TABLE_SCROLL_X \}\}/);
  assert.match(providersSource, /width=\{MODEL_LIBRARY_MODAL_WIDTH\}/);
  assert.match(logsSource, /const TABLE_SCROLL_X = 'max-content';/);
  assert.match(logsSource, /scroll=\{\{ x: TABLE_SCROLL_X \}\}/);
  assert.match(logsSource, /className="responsive-action-bar"/);
  assert.match(assetsSource, /className="asset-library-item"/);
  assert.match(assetsSource, /id: 'custom_tm'/);
  assert.match(assetsSource, /key: 'custom_tm', label: t\('context\.uploadCustomTm'\)/);
  assert.match(assetsSource, /customTm: \(assetImportRules\?\.customTm\?\.extensions \|\| \[\]\)\.join\(', '\)/);
  assert.match(assetsSource, /t\('context\.assetNotAttached'\)/);
  assert.doesNotMatch(assetsSource, /t\('providers\.notAvailable'\)/);
});

test('setup route throughput summaries stay inside their cards with hover disclosure', () => {
  const builderSource = readRendererSource('pages/builder/BuilderPage.jsx');
  const cssSource = readRendererSource('index.css');

  assert.match(builderSource, /<Tag className="builder-route-throughput-tag">/);
  assert.match(builderSource, /<HoverText value=\{throughputStatus\} className="builder-route-throughput-text"/);
  assert.match(cssSource, /\.builder-route-throughput-tag\s*\{[\s\S]*max-width:\s*100%/);
  assert.match(cssSource, /\.builder-route-throughput-text\s*\{[\s\S]*text-overflow:\s*ellipsis/);
});

test('setup asset selections include custom TM bindings', () => {
  const appSource = readRendererSource('App.jsx');
  const builderSource = readRendererSource('pages/builder/BuilderPage.jsx');

  assert.match(builderSource, /\[item\.fieldName\]: String\(currentSelections\[item\.fieldName\] \|\| ''\)/);
  assert.match(appSource, /purpose === 'custom_tm' && !nextSelections\.customTmAssetId/);
  assert.match(appSource, /const customTmAssetId = String\(assetSelections\?\.customTmAssetId \|\| ''\)\.trim\(\);/);
  assert.match(appSource, /nextBindings\.push\(\{ assetId: customTmAssetId, purpose: 'custom_tm' \}\);/);
});

test('global responsive CSS covers wrapping, table overflow, shell header, and mobile drawer', () => {
  const appSource = readRendererSource('App.jsx');
  const cssSource = readRendererSource('index.css');

  assert.match(appSource, /className="app-header-bar"/);
  assert.match(appSource, /className="app-header-controls"/);
  assert.match(cssSource, /\*::before,\s*\n\*::after\s*\{/);
  assert.match(cssSource, /flex-wrap:\s*wrap/);
  assert.match(cssSource, /\.responsive-table-shell\s*\{/);
  assert.match(cssSource, /overflow-x:\s*auto/);
  assert.match(cssSource, /\.responsive-action-bar/);
  assert.match(cssSource, /\.responsive-switch-line/);
  assert.match(cssSource, new RegExp(`@media \\(max-width: ${SHELL_BREAKPOINTS.expandedMin - 1}px\\)`));
  assert.match(cssSource, new RegExp(`@media \\(max-width: ${SHELL_BREAKPOINTS.drawerMax}px\\)`));
  assert.match(appSource, /shellNavigationMode !== 'drawer' \? \(/);
  assert.match(appSource, /className="app-nav-drawer"/);
  assert.doesNotMatch(cssSource, /!important/);
  assert.match(cssSource, /\.asset-library-toolbar/);
  assert.match(cssSource, /\.provider-model-manager-toolbar/);
});

test('retired prompt, advanced, and placeholder editor surfaces stay removed', () => {
  const appSource = readRendererSource('App.jsx');
  const builderSource = readRendererSource('pages/builder/BuilderPage.jsx');

  assert.equal(fs.existsSync(path.join(DESKTOP_ROOT, 'src', 'renderer', 'src', 'pages', 'prompts', 'PromptsPage.jsx')), false);
  assert.equal(fs.existsSync(path.join(DESKTOP_ROOT, 'src', 'renderer', 'src', 'pages', 'advanced', 'AdvancedTuningPage.jsx')), false);
  assert.doesNotMatch(appSource, /EditableProfileForm|insertPlaceholderIntoProfile/);
  assert.doesNotMatch(builderSource, /PlaceholderDrawer|PLACEHOLDER_DRAWER_WIDTH/);
});

test('dashboard install path browse button stays horizontal inside input addon', () => {
  const appSource = readRendererSource('pages/dashboard/DashboardPage.jsx');
  const cssSource = readRendererSource('index.css');

  assert.match(appSource, /className="install-browse-button"/);
  assert.match(appSource, /<Space\.Compact block>/);
  assert.match(appSource, /<Button className="install-browse-button" onClick=\{chooseInstallDirectory\}>/);
  assert.match(cssSource, /min-width:\s*max-content/);
  assert.match(cssSource, /\.install-browse-button > span:not\(\.anticon\)/);
  assert.match(cssSource, /white-space:\s*nowrap/);
  assert.match(cssSource, /overflow-wrap:\s*normal/);
});

test('buildDefaultPresetProfile enables advanced context toggles with source-first preview defaults', () => {
  const profile = buildDefaultPresetProfile();

  assert.equal(profile.profilePresetId, 'default-translation-ops');
  assert.equal(profile.isPresetDerived, true);
  assert.equal(profile.useBestFuzzyTm, true);
  assert.equal(profile.useUploadedGlossary, true);
  assert.equal(profile.useCustomTm, true);
  assert.deepEqual(profile.customTmMatchBuckets, ['101%', '100%', '95-99', '85-94', '75-84']);
  assert.equal(profile.useBrief, true);
  assert.equal(profile.usePreviewContext, true);
  assert.equal(profile.usePreviewFullText, false);
  assert.equal(profile.usePreviewSummary, true);
  assert.equal(profile.usePreviewAboveBelow, true);
  assert.equal(profile.usePreviewTargetText, true);
  assert.match(profile.translationStyle, /natural, concise/i);
  assert.equal(profile.previewAboveIncludeSource, true);
  assert.equal(profile.previewAboveIncludeTarget, false);
  assert.equal(profile.previewBelowIncludeSource, true);
  assert.equal(profile.previewBelowIncludeTarget, false);
  assert.equal('promptTemplates' in profile, false);
  assert.equal('systemPrompt' in profile, false);
  assert.equal('userPrompt' in profile, false);
});

test('default prompt templates keep volatile terminology and TM details out of freeform prompt text', () => {
  const single = DEFAULT_PRESET_SINGLE_USER_PROMPT;
  const batch = DEFAULT_PRESET_BATCH_USER_PROMPT;

  assert.ok(single.indexOf('Source segment:') < single.indexOf('[Current target text:'));
  assert.ok(single.indexOf('[Current target text:') < single.indexOf('[Above source context:'));
  assert.ok(single.indexOf('[Above source context:') < single.indexOf('[Below source context:'));

  assert.match(single, /segment payload fields for matched terminology, TM hints, and neighboring context/i);
  assert.match(batch, /segment payload fields for matched terminology and TM hints/i);
  assert.ok(batch.indexOf('Source segment:') >= 0);
  assert.equal(single.includes('[Required terminology:'), false);
  assert.equal(single.includes('[Best memoQ TM match:'), false);
  assert.equal(batch.includes('[Required terminology:'), false);
  assert.equal(batch.includes('[Best memoQ TM match:'), false);
  assert.doesNotMatch(single, /\[memoQ TM match:/);
  assert.doesNotMatch(single, /\[Uploaded custom TM:/);
  assert.doesNotMatch(single, /\[Terminology rules:/);
  assert.doesNotMatch(batch, /\[memoQ TM match:/);
  assert.doesNotMatch(batch, /\[Uploaded custom TM:/);
  assert.doesNotMatch(batch, /\[Terminology rules:/);
  assert.doesNotMatch(single, /\[Custom TM reference:/);
  assert.doesNotMatch(batch, /\[Custom TM reference:/);
  assert.doesNotMatch(single, /\[Project brief:/);
  assert.doesNotMatch(batch, /\[Project brief:/);
  assert.doesNotMatch(single, /\[Document summary:/);
  assert.doesNotMatch(batch, /\[Document summary:/);
});

test('buildCollapsiblePanelEntries exposes compact avatars and accessibility labels for collapsed side panels', () => {
  const entries = buildCollapsiblePanelEntries(
    [
      { id: 'profile-1', name: 'Legal Review' },
      { id: 'profile-2', name: 'Support' }
    ],
    {
      selectedId: 'profile-1',
      emptyLabel: 'Untitled Profile'
    }
  );

  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, 'profile-1');
  assert.equal(entries[0].label, 'Legal Review');
  assert.equal(entries[0].avatarLabel, 'LR');
  assert.equal(entries[0].isSelected, true);
  assert.equal(entries[1].avatarLabel, 'S');
});

test('buildProviderModelTableRows marks the default model outside of the actions column', () => {
  const rows = buildProviderModelTableRows({
    defaultModelId: 'model-2',
    models: [
      { id: 'model-1', modelName: 'gpt-4.1-mini', enabled: true },
      { id: 'model-2', modelName: 'gpt-5.4-mini', enabled: true }
    ]
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].isDefault, false);
  assert.equal(rows[1].isDefault, true);
});

test('getPanelColumnSpan narrows collapsed module sidebars without hiding them', () => {
  assert.equal(getPanelColumnSpan(false), 6);
  assert.equal(getPanelColumnSpan(true), 4);
});

test('getHistoryRenderedUserPrompt prefers single promptView content', () => {
  assert.equal(
    getHistoryRenderedUserPrompt({
      promptView: {
        single: {
          userPrompt: 'Source:\nHello world'
        }
      }
    }),
    'Source:\nHello world'
  );
});

test('getHistoryRenderedUserPrompt prefers the captured batch JSON payload when available', () => {
  assert.equal(
    getHistoryRenderedUserPrompt({
      promptView: {
        batch: {
          userPrompt: '{"schemaVersion":"structured-v2"}',
          items: [
            { userPrompt: 'Segment One' },
            { userPrompt: 'Segment Two' }
          ]
        }
      }
    }),
    '{"schemaVersion":"structured-v2"}'
  );
});

test('getHistoryRenderedUserPrompt summarizes batch promptView items when the full payload is unavailable', () => {
  assert.equal(
    getHistoryRenderedUserPrompt({
      promptView: {
        batch: {
          items: [
            { userPrompt: 'Segment One' },
            { userPrompt: 'Segment Two' }
          ]
        }
      }
    }),
    'Per-segment prompt instructions are shown below for batch requests.'
  );
});

test('buildHistoryPromptItems prefers promptView content for single records and preserves legacy fallback behavior', () => {
  assert.deepEqual(
    buildHistoryPromptItems({
      promptView: {
        single: {
          sourceText: 'Hello world',
          userPrompt: 'Source:\nHello world'
        }
      },
      segments: [
        {
          segmentIndex: 0,
          sourceText: 'Hello world'
        }
      ]
    }),
    [
      {
        key: 'single-0',
        segmentIndex: 0,
        sourceText: 'Hello world',
        promptInstructions: 'Source:\nHello world'
      }
    ]
  );

  assert.deepEqual(
    buildHistoryPromptItems({
      segments: [
        {
          segmentIndex: 0,
          sourceText: 'Legacy source'
        }
      ]
    }),
    [
      {
        key: 'segment-0',
        segmentIndex: 0,
        sourceText: 'Legacy source',
        promptInstructions: ''
      }
    ]
  );
});

test('buildHistoryPromptItems uses batch promptView items for sent prompt instructions', () => {
  assert.deepEqual(
    buildHistoryPromptItems({
      promptView: {
        batch: {
          items: [
            { index: 0, sourceText: 'One', userPrompt: 'Segment One' },
            { index: 1, sourceText: 'Two', userPrompt: 'Segment Two' }
          ]
        }
      }
    }),
    [
      {
        key: 'batch-0',
        segmentIndex: 0,
        sourceText: 'One',
        promptInstructions: 'Segment One'
      },
      {
        key: 'batch-1',
        segmentIndex: 1,
        sourceText: 'Two',
        promptInstructions: 'Segment Two'
      }
    ]
  );
});

test('shouldShowHistoryActualSentContent hides single payloads and keeps batch payloads', () => {
  assert.equal(
    shouldShowHistoryActualSentContent(
      {
        requestMode: 'single',
        promptView: {
          single: {
            sourceText: 'One',
            userPrompt: 'Prompt One'
          }
        }
      },
      [{ segmentIndex: 0, sourceText: 'One' }]
    ),
    false
  );

  assert.equal(
    shouldShowHistoryActualSentContent(
      {
        requestMode: 'batch',
        promptView: {
          batch: {
            items: [
              { index: 0, sourceText: 'One', userPrompt: 'Prompt One' },
              { index: 1, sourceText: 'Two', userPrompt: 'Prompt Two' }
            ]
          }
        }
      },
      [{ segmentIndex: 0, sourceText: 'One' }, { segmentIndex: 1, sourceText: 'Two' }]
    ),
    true
  );
});
