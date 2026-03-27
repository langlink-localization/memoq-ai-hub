const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('BuilderPage includes sticky bottom save actions for long-form editing', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/src/pages/builder/BuilderPage.jsx'),
    'utf8'
  );

  assert.match(source, /className="builder-sticky-actions"/);
  assert.match(source, /data-testid="builder-sticky-actions"/);
  assert.match(source, /onClick=\{onDiscard\}/);
  assert.match(source, /onClick=\{onSave\}/);
});
