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
