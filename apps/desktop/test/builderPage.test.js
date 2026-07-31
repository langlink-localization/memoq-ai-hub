const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('BuilderPage keeps save primary and destructive actions in the editor card menu', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/src/pages/builder/BuilderPage.jsx'),
    'utf8'
  );

  assert.match(source, /loading=\{saving\} type="primary" icon=\{<SaveOutlined \/>\} onClick=\{onSave\}/);
  assert.match(source, /<Dropdown menu=\{editorActionMenu\}/);
  assert.match(source, /key: 'discard', danger: true/);
  assert.match(source, /key: 'delete', danger: true/);
  assert.doesNotMatch(source, /builder-sticky-actions/);
});
