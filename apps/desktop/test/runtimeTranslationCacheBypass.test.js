'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeTranslationCacheBypass } = require('../src/runtime/runtimeTranslationCacheBypass');

function createBypass() {
  return createRuntimeTranslationCacheBypass({
    loadState: () => ({ profiles: [{ id: 'profile-1' }] })
  });
}

test('translation cache bypass arms one profile and consumes it once', () => {
  const bypass = createBypass();

  assert.deepEqual(bypass.arm(' profile-1 '), {
    ok: true,
    profileId: 'profile-1',
    bypassPending: true
  });
  assert.equal(bypass.pendingIds.has('profile-1'), true);
  assert.equal(bypass.consume('profile-1'), true);
  assert.equal(bypass.consume('profile-1'), false);
  assert.equal(bypass.pendingIds.size, 0);
});

test('translation cache bypass rejects an unknown profile and clears a deleted one', () => {
  const bypass = createBypass();
  bypass.arm('profile-1');

  assert.throws(() => bypass.arm(''), /Profile ID is required/);
  assert.throws(() => bypass.arm('missing'), /Profile missing not found/);
  bypass.clear('profile-1');
  assert.equal(bypass.consume('profile-1'), false);
});
