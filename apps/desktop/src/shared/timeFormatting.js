const DISPLAY_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

/**
 * Parses a timestamp-like value into a local-epoch millisecond number.
 * @param {unknown} value
 * @returns {number | null}
 */
function parseTimestampToEpochMs(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * @typedef {Object} DateInputParseOptions
 * @property {boolean=} endOfDay
 */

/**
 * @param {unknown} value
 * @param {DateInputParseOptions=} options
 * @returns {number | null}
 */
function parseDateInputToEpochMs(value, options = {}) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const dateOnlyMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, yearText, monthText, dayText] = dateOnlyMatch;
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    const day = Number(dayText);
    const date = options.endOfDay
      ? new Date(year, monthIndex, day, 23, 59, 59, 999)
      : new Date(year, monthIndex, day, 0, 0, 0, 0);
    const time = date.getTime();
    return Number.isFinite(time) ? time : null;
  }

  const parsed = new Date(text);
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * @typedef {Object} TimestampDisplayOptions
 * @property {string=} fallback
 */

/**
 * @param {unknown} value
 * @param {TimestampDisplayOptions=} options
 * @returns {string}
 */
function formatTimestampForLocalDisplay(value, options = {}) {
  const time = parseTimestampToEpochMs(value);
  if (time === null) {
    return options.fallback ?? '';
  }

  return DISPLAY_TIMESTAMP_FORMATTER.format(new Date(time));
}

module.exports = {
  formatTimestampForLocalDisplay,
  parseDateInputToEpochMs,
  parseTimestampToEpochMs
};
