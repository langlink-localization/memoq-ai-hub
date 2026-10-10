import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, createServer } from 'vite';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(testDir, '..');

test('app initializes every controller and renders the startup screen before IPC data arrives', async (t) => {
  const outDir = await fs.mkdtemp(path.join(desktopRoot, '.startup-test-'));
  t.after(() => fs.rm(outDir, { recursive: true, force: true }));
  await build({
    configFile: path.join(desktopRoot, 'vite.renderer.config.mjs'),
    logLevel: 'silent',
    build: {
      ssr: path.join(desktopRoot, 'src/renderer/src/App.jsx'),
      outDir,
      minify: true,
      commonjsOptions: { include: [/node_modules/, /src[\\/]shared/] },
      rolldownOptions: { output: { entryFileNames: 'startup.mjs' } }
    }
  });
  const { default: App } = await import(pathToFileURL(path.join(outDir, 'startup.mjs')).href);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { memoqDesktop: {} } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });
  const html = renderToString(createElement(App));
  assert.match(html, /class="app-initial-loading"/);
  assert.match(html, /role="status"/);
});

async function loadRendererComponent(modulePath) {
  const server = await createServer({
    configFile: path.join(desktopRoot, 'vite.renderer.config.mjs'),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent'
  });
  try {
    return await server.ssrLoadModule(modulePath);
  } finally {
    await server.close();
  }
}

test('selectable profile row exposes listbox semantics and responds to keyboard activation', async () => {
  const { CollapsibleItemList, ProfileListRow } = await loadRendererComponent('/src/components/CollapsibleSidePanel.jsx');
  let activationCount = 0;
  let preventedCount = 0;
  const entry = {
    id: 'profile-1',
    label: 'Production profile',
    isSelected: true,
    tags: []
  };
  const row = ProfileListRow({
    entry,
    compact: false,
    onClick: () => { activationCount += 1; }
  });

  assert.equal(row.props.role, 'option');
  assert.equal(row.props.tabIndex, 0);
  assert.equal(row.props['aria-selected'], true);

  row.props.onKeyDown({ key: 'Enter', preventDefault: () => { preventedCount += 1; } });
  row.props.onKeyDown({ key: ' ', preventDefault: () => { preventedCount += 1; } });
  row.props.onKeyDown({ key: 'ArrowDown', preventDefault: () => { preventedCount += 1; } });
  assert.equal(activationCount, 2);
  assert.equal(preventedCount, 2);

  const list = CollapsibleItemList({
    entries: [entry],
    collapsed: false,
    emptyText: 'No profiles',
    onSelect() {},
    renderExpandedItem: () => row
  });
  assert.equal(list.props.role, 'listbox');
});

import { act, create } from 'react-test-renderer';

// React 19 checks this flag before act() and warns through console.error otherwise.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('page error boundary keeps surrounding navigation mounted and recovers on retry', async () => {
  const { default: PageErrorBoundary } = await loadRendererComponent('/src/components/PageErrorBoundary.jsx');
  // Project boundary logic runs in React. Adapt only AntD presentation to the
  // DOM-free test renderer; separately render the real fallback through SSR.
  let fallback;
  class HeadlessBoundary extends PageErrorBoundary {
    render() {
      const view = super.render();
      if (!this.state.error) return view;
      fallback = view;
      return createElement('button', { onClick: view.props.extra.props.onClick }, view.props.title);
    }
  }
  let shouldFail = true;
  function Page() {
    if (shouldFail) throw new Error('expected test failure');
    return createElement('p', null, 'Recovered page');
  }
  let renderer;
  const previousError = console.error;
  const reportedErrors = [];
  console.error = (...args) => reportedErrors.push(args);
  try {
    act(() => {
      renderer = create(createElement('div', null,
        createElement('nav', null, 'Navigation remains'),
        createElement(HeadlessBoundary, { t: (key) => key }, createElement(Page))));
    });
    assert.equal(renderer.root.findByType('nav').children[0], 'Navigation remains');
    assert.equal(renderer.root.findByType(HeadlessBoundary).instance.state.error.message, 'expected test failure');
    assert.match(renderToString(fallback), /app.pageErrorTitle/);
    assert.match(renderToString(fallback), /common.retry/);
    shouldFail = false;
    act(() => renderer.root.findByType('button').props.onClick());
    assert.equal(renderer.root.findByType('p').children[0], 'Recovered page');
    // React 19 also logs a react-test-renderer deprecation notice; count only the
    // boundary's own report of the thrown error.
    const boundaryReports = reportedErrors.filter((args) => args.some((arg) => arg?.message === 'expected test failure'));
    assert.equal(boundaryReports.length, 1);
  } finally {
    if (renderer) act(() => renderer.unmount());
    console.error = previousError;
  }
});

test('update actions keep browser download available during checks, downloads and failures', async () => {
  const { default: UpdateActions } = await loadRendererComponent('/src/pages/dashboard/UpdateActions.jsx');
  const { canDownloadUpdate } = await import('../src/renderer/src/pages/dashboard/dashboardPresentation.mjs');
  function buttons(element) {
    if (!element || typeof element !== 'object') return [];
    const children = Array.isArray(element.props?.children) ? element.props.children.flat(Infinity) : [element.props?.children];
    return (typeof element.props?.onClick === 'function' ? [element] : []).concat(children.flatMap(buttons));
  }
  for (const mode of ['installed', 'portable']) {
    for (const status of ['idle', 'checking', 'available', 'downloading', 'prepared', 'error', 'up-to-date']) {
      let opened = '';
      let cancelled = 0;
      const updateCenter = { packagingMode: mode, updateStatus: status, currentVersion: '1.0.0', latestVersion: '1.0.1', availableAssets: { installer: { url: 'https://example.com/setup', sha256: 'a'.repeat(64) }, portable: { url: 'https://example.com/zip', sha256: 'b'.repeat(64) } } };
      const isDownloading = status === 'downloading';
      const element = UpdateActions({
        updateCenter, safeUpdateStatus: status, checkingUpdates: status === 'checking',
        updateActionLoading: isDownloading, portableInAppSupported: true,
        hasAvailableUpdate: canDownloadUpdate(updateCenter, status === 'checking'),
        portableDownloadPage: 'https://github.com/langlink-localization/memoq-ai-hub/releases/latest',
        openPortableDownloadPage: (url) => { opened = url; },
        cancelUpdateDownload: () => { cancelled += 1; },
        t: (key) => key
      });
      const actions = buttons(element);
      const browser = actions.find((button) => button.props.children === 'dashboard.openPortableDownloadPage');
      assert.ok(browser, `${mode}/${status}`);
      assert.ok(!browser.props.loading && !browser.props.disabled);
      browser.props.onClick();
      assert.ok(opened.endsWith('/releases/latest'));
      const cancel = actions.find((button) => button.props.children === 'dashboard.cancelUpdateDownload');
      assert.equal(Boolean(cancel), isDownloading);
      if (cancel) { cancel.props.onClick(); assert.equal(cancelled, 1); }
      if (isDownloading) assert.equal(actions.find((button) => button.props.children === 'dashboard.checkForUpdates').props.disabled, true);
      if (status === 'error') assert.ok(actions.some((button) => button.props.children === 'dashboard.retryUpdateDownload'));
    }
  }
  assert.equal(canDownloadUpdate({ updateStatus: 'error', currentVersion: '1.0.2', latestVersion: '1.0.1', availableAssets: { portable: { url: 'https://example.com', sha256: 'x' } } }), false);
});

test('asset preview separates language columns from scoped rules and blocks incomplete rule saves', async () => {
  const { default: AssetPreviewDrawer } = await loadRendererComponent('/src/components/AssetPreviewDrawer.jsx');
  // The drawer has only useContext; render a wrapper to collect its real elements and handlers.
  let drawer;
  function Capture({ controller }) { drawer = AssetPreviewDrawer({ controller }); return null; }
  const controls = (node, result = []) => {
    if (!node || typeof node !== 'object') return result;
    if (node.props?.onChange || node.props?.onClick) result.push(node);
    for (const child of [node.props?.children].flat(Infinity)) controls(child, result);
    return result;
  };
  let draft = { directionMode: 'automatic', hasHeader: true, languageColumns: [{ columnIndex: 0, language: 'en' }, { columnIndex: 1, language: 'ja' }], ruleLanguagePair: { source: '', target: '' } };
  const controller = {
    assetPreviewOpen: true, assetPreviewRecord: { type: 'glossary', name: 'Terms' },
    assetPreviewData: { availableColumnDetails: [{ columnIndex: 0, columnName: 'en', samples: ['Furnace'] }, { columnIndex: 1, columnName: 'ja', samples: ['大炉'] }], hasDirectionalRules: true, directionalRuleColumns: [{ index: 2, role: 'forbidden' }] },
    setAssetPreviewManualDraft: (update) => { draft = update(draft); }
  };
  function render() { renderToString(createElement(Capture, { controller: { ...controller, assetPreviewManualDraft: draft } })); return controls(drawer); }
  let items = render();
  const save = () => items.find((node) => node.props.children === 'context.assetPreviewManualSave');
  assert.equal(save().props.disabled, true);
  items.find((node) => node.props['aria-label'] === 'context.assetRuleLanguage.source').props.onChange('en');
  items = render();
  items.find((node) => node.props['aria-label'] === 'context.assetRuleLanguage.target').props.onChange('ja');
  items = render();
  assert.equal(save().props.disabled, false);
  items.find((node) => node.props.children === 'context.assetAutomaticDirection').props.onChange({ target: { checked: false } });
  items = render();
  assert.equal(draft.directionMode, 'legacy');
  assert.equal(items.some((node) => node.props['aria-label'] === 'context.assetRuleLanguage.source'), false);
});


test('asset row details show labelled groups and escape literal business tags', async () => {
  const { AssetRowDetails } = await loadRendererComponent('/src/components/AssetPreviewDrawer.jsx');
  const html = renderToString(createElement(AssetRowDetails, { t: (key) => key, row: { details: [
    { group: 'entry', label: 'Entry_ID', value: '10001' },
    { group: 'source', label: 'Term_Info', value: 'CasePermissive;HalfPrefix' },
    { group: 'context', label: 'previousSource', value: '<desc_id=123>' }
  ] } }));
  assert.match(html, /Entry_ID/);
  assert.match(html, /10001/);
  assert.match(html, /context.assetDetailGroup.source/);
  assert.match(html, /&lt;desc_id=123&gt;/);
  assert.doesNotMatch(html, /\[object Object\]/);
});
