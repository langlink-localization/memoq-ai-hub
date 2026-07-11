import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  APP_SECTIONS,
  buildAdvancedModelRows,
  buildAssetLibraryEntries,
  buildCollapsiblePanelEntries,
  buildDefaultPresetProfile,
  DEFAULT_PRESET_BATCH_USER_PROMPT,
  DEFAULT_PRESET_SINGLE_USER_PROMPT,
  buildHistoryPromptItems,
  getHistoryRenderedUserPrompt,
  shouldShowHistoryActualSentContent,
  buildPromptResources,
  buildProviderModelTableRows,
  getPanelColumnSpan
} from '../src/renderer/src/appShell.mjs';
import en from '../src/renderer/src/locales/en.js';
import zhCN from '../src/renderer/src/locales/zh-CN.js';

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..');

function readRendererSource(relativePath) {
  return fs.readFileSync(path.join(DESKTOP_ROOT, 'src', 'renderer', 'src', relativePath), 'utf8');
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

  assert.match(appSource, /import \{ lazy, Suspense,/);
  assert.match(appSource, /lazy\(\(\) => import\('\.\/pages\/providers\/ProvidersPage\.jsx'\)\)/);
  assert.match(appSource, /lazy\(\(\) => import\('\.\/pages\/builder\/BuilderPage\.jsx'\)\)/);
  assert.match(appSource, /lazy\(\(\) => import\('\.\/pages\/assets\/AssetsPage\.jsx'\)\)/);
  assert.match(appSource, /lazy\(\(\) => import\('\.\/pages\/logs\/LogsPage\.jsx'\)\)/);
  assert.match(appSource, /<Suspense fallback=\{<Spin/);
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

  assert.match(appSource, /className="app-header-refresh"/);
  assert.match(appSource, /aria-label=\{t\('app\.refresh'\)\}/);
  assert.match(appSource, /const safeUpdateStatus = getSafeUpdateStatus\(updateCenter\);/);
  assert.match(appSource, /const effectiveUpdateStatus = checkingUpdates \? 'checking' : safeUpdateStatus;/);
  assert.match(appSource, /const latestVersionDisplay = updateCenter\.latestVersion/);
  assert.match(appSource, /getUpdateErrorDisplay\(result, t\)/);
  assert.match(appSource, /const hasAvailableUpdate = !checkingUpdates && safeUpdateStatus === 'available';/);
  assert.match(appSource, /icon=\{<ReloadOutlined \/>}/);
  assert.match(en.dashboard.updateCheckingLatestVersion, /Checking/);
  assert.equal(zhCN.dashboard.updateCheckingLatestVersion, '检查中...');
  assert.match(en.dashboard.updateCheckTimeoutError, /timed out/i);
  assert.match(zhCN.dashboard.updateCheckTimeoutError, /超时/);
});

test('history insights expose simple latency-focused filtering hooks', () => {
  const appSource = readRendererSource('App.jsx');

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
  const appSource = readRendererSource('App.jsx');
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

test('global select styles allow selected values and dropdown options to wrap', () => {
  const cssSource = readRendererSource('index.css');

  assert.match(cssSource, /\.content-wrap \.ant-select/);
  assert.match(cssSource, /width:\s*100%/);
  assert.match(cssSource, /max-width:\s*100%/);
  assert.match(cssSource, /\.ant-select-dropdown\s*\{/);
  assert.match(cssSource, /max-width:\s*90vw/);
  assert.match(cssSource, /\.ant-select-dropdown \.ant-select-item-option-content/);
  assert.match(cssSource, /\.ant-select-single \.ant-select-selector \.ant-select-selection-item/);
  assert.match(cssSource, /overflow-wrap:\s*anywhere/);
  assert.match(cssSource, /white-space:\s*normal/);
});

test('dashboard and history use responsive grid and horizontal table scroll', () => {
  const appSource = readRendererSource('App.jsx');
  const cssSource = readRendererSource('index.css');

  assert.match(appSource, /const TABLE_SCROLL_X = 'max-content';/);
  assert.match(appSource, /const WIDE_SIDE_DRAWER_WIDTH = 'min\(920px, calc\(100vw - 32px\)\)';/);
  assert.match(appSource, /className="dashboard-journey-grid"/);
  assert.match(cssSource, /grid-template-columns:\s*repeat\(auto-fit, minmax\(190px, 1fr\)\)/);
  assert.match(appSource, /<Col xs=\{24\} xl=\{12\}>/);
  assert.match(appSource, /<Col xs=\{24\} lg=\{12\}>/);
  assert.match(appSource, /<Col xs=\{24\} sm=\{12\} lg=\{8\} xl=\{4\}>/);
  assert.match(appSource, /scroll=\{\{ x: TABLE_SCROLL_X \}\}/);
  assert.equal((appSource.match(/scroll=\{\{ x: TABLE_SCROLL_X \}\}/g) || []).length >= 3, true);
  assert.equal((appSource.match(/width=\{WIDE_SIDE_DRAWER_WIDTH\}/g) || []).length >= 2, true);
});

test('feature pages keep tables and overlays responsive on narrow viewports', () => {
  const builderSource = readRendererSource('pages/builder/BuilderPage.jsx');
  const providersSource = readRendererSource('pages/providers/ProvidersPage.jsx');
  const logsSource = readRendererSource('pages/logs/LogsPage.jsx');
  const assetsSource = readRendererSource('pages/assets/AssetsPage.jsx');

  assert.match(builderSource, /const PLACEHOLDER_DRAWER_WIDTH = 'min\(420px, calc\(100vw - 32px\)\)';/);
  assert.match(builderSource, /width=\{PLACEHOLDER_DRAWER_WIDTH\}/);
  assert.match(builderSource, /builder-sticky-actions-inner responsive-action-bar/);
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
  assert.match(cssSource, /\.ant-card-head-wrapper/);
  assert.match(cssSource, /flex-wrap:\s*wrap/);
  assert.match(cssSource, /\.ant-table-wrapper\s*\{/);
  assert.match(cssSource, /overflow-x:\s*auto/);
  assert.match(cssSource, /\.responsive-action-bar/);
  assert.match(cssSource, /\.responsive-switch-line/);
  assert.match(cssSource, /\.ant-drawer-content-wrapper/);
  assert.match(cssSource, /max-width:\s*calc\(100vw - 32px\)/);
  assert.match(cssSource, /@media \(max-width: 768px\)/);
  assert.match(appSource, /shellNavigationMode !== 'drawer' \? \(/);
  assert.match(appSource, /className="app-nav-drawer"/);
  assert.doesNotMatch(cssSource, /width:\s*72px !important/);
  assert.match(cssSource, /\.asset-library-toolbar/);
  assert.match(cssSource, /\.provider-model-manager-toolbar/);
  assert.match(cssSource, /\.asset-library-item \.ant-list-item-action/);
});

test('legacy prompt and list action surfaces use scoped responsive actions', () => {
  const appSource = readRendererSource('App.jsx');
  const promptsSource = readRendererSource('pages/prompts/PromptsPage.jsx');
  const cssSource = readRendererSource('index.css');

  assert.match(appSource, /className="responsive-list-actions"/);
  assert.match(promptsSource, /<Space wrap className="responsive-action-bar">/);
  assert.match(cssSource, /\.responsive-list-actions \.ant-list-item-action/);
  assert.match(cssSource, /\.builder-sticky-actions-inner \.ant-btn/);
  assert.doesNotMatch(cssSource, /responsive-action-bar \.ant-btn\s*\{\s*width:\s*100%;/);
});

test('dashboard install path browse button stays horizontal inside input addon', () => {
  const appSource = readRendererSource('App.jsx');
  const cssSource = readRendererSource('index.css');

  assert.match(appSource, /className="install-browse-button"/);
  assert.match(appSource, /addonAfter=\{<Button className="install-browse-button" onClick=\{chooseInstallDirectory\}>/);
  assert.match(cssSource, /\.ant-input-group-addon \.ant-btn,\s*\n\.install-browse-button/);
  assert.match(cssSource, /\.ant-input-group > \.ant-input,\s*\n\.ant-input-group > \.ant-input-affix-wrapper/);
  assert.match(cssSource, /min-width:\s*max-content/);
  assert.match(cssSource, /\.ant-input-group-addon \.ant-btn > span:not\(\.anticon\),\s*\n\.install-browse-button > span:not\(\.anticon\)/);
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

test('buildPromptResources projects prompt content out of profiles', () => {
  const resources = buildPromptResources([
    {
      id: 'profile-1',
      name: 'Legal EN->DE',
      systemPrompt: 'System text',
      userPrompt: 'User text'
    }
  ]);

  assert.equal(resources.length, 1);
  assert.equal(resources[0].id, 'prompt:profile-1');
  assert.equal(resources[0].profileId, 'profile-1');
  assert.equal(resources[0].name, 'Legal EN->DE');
  assert.equal(resources[0].systemPrompt, 'System text');
  assert.equal(resources[0].userPrompt, 'User text');
});

test('buildAssetLibraryEntries annotates asset usage by bound profile', () => {
  const entries = buildAssetLibraryEntries(
    [
      { id: 'asset-1', name: 'Core Glossary', type: 'glossary' },
      { id: 'asset-2', name: 'Retail Brief', type: 'brief' }
    ],
    [
      {
        id: 'profile-1',
        name: 'Retail',
        assetBindings: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }]
      },
      {
        id: 'profile-2',
        name: 'Support',
        assetBindings: [{ assetId: 'asset-1' }]
      }
    ]
  );

  assert.deepEqual(entries[0].boundProfileNames, ['Retail', 'Support']);
  assert.equal(entries[0].usageCount, 2);
  assert.deepEqual(entries[1].boundProfileNames, ['Retail']);
  assert.equal(entries[1].usageCount, 1);
});

test('buildAdvancedModelRows flattens provider model tuning away from the provider model table', () => {
  const rows = buildAdvancedModelRows([
    {
      id: 'provider-1',
      name: 'OpenAI',
      models: [
        {
          id: 'model-1',
          modelName: 'gpt-5.4-mini',
          concurrencyLimit: 3,
          retryEnabled: true,
          retryAttempts: 2,
          promptCacheEnabled: true,
          promptCacheTtlHint: '5m',
          rateLimitHint: '120 rpm',
          notes: 'Primary route'
        }
      ]
    }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].providerName, 'OpenAI');
  assert.equal(rows[0].modelName, 'gpt-5.4-mini');
  assert.equal(rows[0].concurrencyLimit, 3);
  assert.equal(rows[0].promptCacheEnabled, true);
  assert.equal(rows[0].notes, 'Primary route');
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
