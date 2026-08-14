const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('preload exposes log diagnostics actions', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/preload.js'), 'utf8');
  assert.match(source, /getLogState/);
  assert.match(source, /pruneLogs/);
  assert.match(source, /recordRendererLog/);
});

test('preload exposes only explicit quality-check operations', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/preload.js'), 'utf8');
  ['getQaStatus', 'checkQaSegment', 'checkQaDocument', 'cancelQa', 'saveQaFeedback', 'getQaResults', 'importBilingualQa', 'openQualityWindow', 'copyText'].forEach((name) => assert.match(source, new RegExp(`\\b${name}:`)));
});

test('main process registers log diagnostics IPC handlers', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
  assert.match(source, /desktop:get-log-state/);
  assert.match(source, /desktop:prune-logs/);
  assert.match(source, /desktop:record-renderer-log/);
});

test('main process consumes the Electron 43 console-message details event', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
  assert.match(source, /webContents\.on\('console-message', \(details\) =>/);
  assert.match(source, /details\.level === 'warning' \|\| details\.level === 'error'/);
  assert.match(source, /line:\s*details\.lineNumber/);
  assert.doesNotMatch(source, /level\s*>=\s*2/);
});

test('main window supports the governed drawer breakpoint and content-width sizing', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
  assert.match(source, /minWidth:\s*720/);
  assert.match(source, /useContentSize:\s*true/);
  assert.match(source, /MEMOQ_AI_DESKTOP_WINDOW_WIDTH/);
  assert.match(source, /requestedWidth >= 720 && requestedWidth <= 3840/);
});

test('main process validates external URLs before invoking the operating system', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
  assert.match(source, /normalizeExternalHttpsUrl\(requestedUrl\)/);
  assert.match(source, /shell\.openExternal\(normalizedUrl\)/);
  assert.doesNotMatch(source, /shell\.openExternal\(requestedUrl\)/);
});

test('main process re-verifies downloaded installers before invoking the operating system', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
  const handlerStart = source.indexOf("ipcMain.handle('desktop:launch-downloaded-installer-update'");
  const handlerEnd = source.indexOf("ipcMain.handle('desktop:pick-directory'", handlerStart);

  assert.notEqual(handlerStart, -1);
  assert.notEqual(handlerEnd, -1);
  const handlerSource = source.slice(handlerStart, handlerEnd);
  assert.match(handlerSource, /invokeWorker\('verifyDownloadedInstallerUpdate'/);
  assert.match(handlerSource, /shell\.openPath\(verifiedInstallerPath\)/);
  assert.doesNotMatch(handlerSource, /shell\.openPath\(normalizedPath\)/);
  assert.ok(
    handlerSource.indexOf("invokeWorker('verifyDownloadedInstallerUpdate'")
      < handlerSource.indexOf('shell.openPath(verifiedInstallerPath)')
  );
});
