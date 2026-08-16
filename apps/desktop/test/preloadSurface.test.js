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
  ['getQaStatus', 'checkQaSegment', 'checkQaDocument', 'cancelQa', 'saveQaFeedback', 'getQaResults', 'getQaHistory', 'getQaHistoryEntry', 'deleteQaHistory', 'exportQaHistory', 'importBilingualQa', 'openQualityWindow', 'openAssistantWindow', 'runPreviewAssistant', 'cancelPreviewAssistant', 'copyText', 'savePromptPreset', 'deletePromptPreset', 'restoreBuiltinPromptPreset'].forEach((name) => assert.match(source, new RegExp(`\\b${name}:`)));
});

test('assistant preload validates operation and bounds glossary overrides', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/preload.js'), 'utf8');
  assert.match(source, /operation === 'polish'/);
  assert.match(source, /operation === 'translate'/);
  assert.match(source, /\.slice\(0, 50\)/);
  assert.match(source, /mode: payload\.assets\?\.mode === 'override' \? 'override' : 'inherit'/);
  assert.match(source, /additionalInstruction: String\(payload\.prompt\?\.additionalInstruction/);
  assert.match(source, /presetId: String\(payload\.prompt\?\.presetId/);
});

test('quality UI preserves native switch sizing and renders the two-mode assistant', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/index.css'), 'utf8');
  const page = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/pages/quality/QualityPage.jsx'), 'utf8');
  const assistant = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/pages/quality/AssistantWindow.jsx'), 'utf8');
  const history = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/pages/quality/QaHistoryPanel.jsx'), 'utf8');
  const presets = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/pages/quality/PromptPresetSelector.jsx'), 'utf8');
  assert.doesNotMatch(css, /\.quality-page button[\s\S]{0,160}min-height:\s*40px/);
  assert.match(css, /\.quality-switch-row[\s\S]{0,120}min-height:\s*40px/);
  assert.match(page, /loading=\{savingField === 'qaRealtimeAiEnabled'\}/);
  assert.match(assistant, /value: 'translate'/);
  assert.match(assistant, /value: 'qa'/);
  assert.match(assistant, /runAssistant\('polish'\)/);
  assert.doesNotMatch(assistant, /qaResult && findings\.length === 0 \? <Alert type="success"/);
  assert.match(page, /key: 'history'/);
  assert.match(history, /showAutomatic/);
  assert.match(history, /exportQaHistory/);
  assert.match(assistant, /scope="translate"/);
  assert.match(assistant, /scope="polish"/);
  assert.match(assistant, /scope="qa"/);
  assert.match(presets, /restoreBuiltinPromptPreset/);
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
