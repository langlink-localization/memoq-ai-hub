import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Ant Design CI is pinned and fail closed', () => {
  const workflow = fs.readFileSync('.github/workflows/antd-lint.yml', 'utf8');
  const validator = fs.readFileSync('tooling/scripts/validate-antd-lint.mjs', 'utf8');
  assert.match(workflow, /@ant-design\/cli@6\.5\.4/);
  assert.match(workflow, /--format json \| node tooling\/scripts\/validate-antd-lint\.mjs/);
  assert.match(validator, /report\.partial !== false/);
  assert.match(validator, /skippedFiles\.length > 0/);
  assert.match(validator, /issues\.length > 0/);
});
