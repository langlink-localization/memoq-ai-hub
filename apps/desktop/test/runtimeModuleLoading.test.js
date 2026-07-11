const test = require('node:test');
const assert = require('node:assert/strict');

test('runtime defers feature-only provider and asset parser dependencies', () => {
  require('../src/runtime/runtime');

  const loadedModules = Object.keys(require.cache).map((filePath) => filePath.replaceAll('\\', '/'));
  for (const packageName of ['fast-xml-parser', 'openai', 'xlsx']) {
    assert.equal(
      loadedModules.some((filePath) => filePath.includes(`/node_modules/${packageName}/`)),
      false,
      `Expected ${packageName} to stay unloaded until its feature is used.`
    );
  }
});
