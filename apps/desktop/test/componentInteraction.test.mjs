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
    assert.equal(reportedErrors.length, 1);
  } finally {
    if (renderer) act(() => renderer.unmount());
    console.error = previousError;
  }
});
