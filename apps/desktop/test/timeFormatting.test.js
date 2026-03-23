const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatTimestampForLocalDisplay,
  parseDateInputToEpochMs,
  parseTimestampToEpochMs
} = require('../src/shared/timeFormatting');

test('time formatting parses date-only filters as local start and end of day', () => {
  const start = parseDateInputToEpochMs('2026-03-19');
  const end = parseDateInputToEpochMs('2026-03-19', { endOfDay: true });

  assert.equal(start, new Date(2026, 2, 19, 0, 0, 0, 0).getTime());
  assert.equal(end, new Date(2026, 2, 19, 23, 59, 59, 999).getTime());
});

test('time formatting parses ISO timestamps into epoch milliseconds', () => {
  const iso = '2026-03-19T03:20:40.347Z';
  assert.equal(parseTimestampToEpochMs(iso), new Date(iso).getTime());
});

test('time formatting renders timestamps with the local machine timezone', () => {
  const iso = '2026-03-19T03:20:40.347Z';
  const expected = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(iso));

  assert.equal(formatTimestampForLocalDisplay(iso), expected);
});
