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

test('main process registers log diagnostics IPC handlers', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
  assert.match(source, /desktop:get-log-state/);
  assert.match(source, /desktop:prune-logs/);
  assert.match(source, /desktop:record-renderer-log/);
});
