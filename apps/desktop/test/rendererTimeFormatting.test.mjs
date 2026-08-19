import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatLocalTimestamp,
  formatTimestampForLocalDisplay
} from '../src/renderer/src/timeFormatting.mjs';

test('renderer local timestamp adapter preserves the positional fallback contract', () => {
  assert.equal(formatLocalTimestamp('', '-'), '-');
  assert.equal(
    formatLocalTimestamp('2026-08-20T00:00:00.000Z'),
    formatTimestampForLocalDisplay('2026-08-20T00:00:00.000Z')
  );
});
