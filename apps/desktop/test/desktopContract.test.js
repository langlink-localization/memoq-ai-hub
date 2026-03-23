const test = require('node:test');
const assert = require('node:assert/strict');
const { PRODUCT_NAME, CONTRACT_VERSION, DEFAULT_PORT, ROUTES } = require('../src/shared/desktopContract');

test('desktop contract exposes expected core fields', () => {
  assert.equal(PRODUCT_NAME, 'memoQ AI Hub');
  assert.equal(CONTRACT_VERSION, '1');
  assert.equal(DEFAULT_PORT, 5271);
  assert.equal(ROUTES.desktopVersion, '/desktop/version');
  assert.equal(ROUTES.mtTranslate, '/mt/translate');
});
