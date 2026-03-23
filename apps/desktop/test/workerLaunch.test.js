const test = require('node:test');
const assert = require('node:assert/strict');

const { buildWorkerForkOptions } = require('../src/workerLaunch');

test('worker launch options force node mode without inheriting parent execArgv', () => {
  const options = buildWorkerForkOptions({
    PATH: '/tmp/bin',
    ELECTRON_RUN_AS_NODE: '0'
  });

  assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.deepEqual(options.execArgv, []);
  assert.equal(options.windowsHide, true);
  assert.equal(options.silent, true);
});
