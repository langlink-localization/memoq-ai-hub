const {
  formatTimestampForLocalDisplay,
  parseDateInputToEpochMs,
  parseTimestampToEpochMs
} = require('../shared/timeFormatting');

const SLOW_HISTORY_LATENCY_MS = 30000;
const HISTORY_ISSUE_FILTERS = new Set(['failed', 'timeout', 'rate_limit', 'fallback', 'slow']);

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parseTimeMs(value) {
  const parsed = parseTimestampToEpochMs(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * @param {unknown} value
 * @param {boolean=} endOfDay
 * @returns {number | null}
 */
function parseLocalFilterDate(value, endOfDay = false) {
  const parsed = parseDateInputToEpochMs(value, { endOfDay });
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatLocalTimestamp(value) {
  return formatTimestampForLocalDisplay(value, { fallback: '' });
}

/**
 * @param {Record<string, any>=} entry
 * @returns {any[]}
 */
function getHistoryAttempts(entry = {}) {
  return Array.isArray(entry.attempts) ? entry.attempts : [];
}

/**
 * @param {Record<string, any>=} attempt
 * @returns {string}
 */
function getHistoryAttemptErrorCode(attempt = {}) {
  return String(attempt?.errorCode || '').trim().toUpperCase();
}

/**
 * @param {Record<string, any>=} attempt
 * @returns {boolean}
 */
function isHistoryTimeoutAttempt(attempt = {}) {
  const errorCode = getHistoryAttemptErrorCode(attempt);
  return errorCode === 'PROVIDER_TIMEOUT' || errorCode === 'TRANSLATION_TIMEOUT';
}

/**
 * @param {Record<string, any>=} attempt
 * @returns {boolean}
 */
function isHistoryRateLimitAttempt(attempt = {}) {
  return getHistoryAttemptErrorCode(attempt) === 'PROVIDER_RATE_LIMITED';
}

/**
 * @param {Record<string, any>=} entry
 * @returns {boolean}
 */
function hasHistoryFallback(entry = {}) {
  if (entry?.issueFlags?.fallback === true) {
    return true;
  }
  if (entry.finalizedByFallbackRoute === true) {
    return true;
  }
  if (Array.isArray(entry.throughput?.fallbackReasons) && entry.throughput.fallbackReasons.length > 0) {
    return true;
  }
  return getHistoryAttempts(entry).some((attempt) => attempt?.finalizedByFallbackRoute === true);
}

/**
 * @param {Record<string, any>=} entry
 * @param {string=} issue
 * @returns {boolean}
 */
function matchesHistoryIssue(entry = {}, issue = '') {
  const normalizedIssue = String(issue || '').trim().toLowerCase();
  if (!normalizedIssue || !HISTORY_ISSUE_FILTERS.has(normalizedIssue)) {
    return true;
  }

  if (normalizedIssue === 'failed') {
    if (entry?.issueFlags?.failed === true) return true;
    return String(entry?.status || '').trim().toLowerCase() === 'failed';
  }

  if (normalizedIssue === 'timeout') {
    if (entry?.issueFlags?.timeout === true) return true;
    return getHistoryAttempts(entry).some(isHistoryTimeoutAttempt);
  }

  if (normalizedIssue === 'rate_limit') {
    if (entry?.issueFlags?.rate_limit === true) return true;
    return getHistoryAttempts(entry).some(isHistoryRateLimitAttempt);
  }

  if (normalizedIssue === 'fallback') {
    return hasHistoryFallback(entry);
  }

  if (normalizedIssue === 'slow') {
    if (entry?.issueFlags?.slow === true) return true;
    const latencyMs = Number(entry?.latencyMs);
    return Number.isFinite(latencyMs) && latencyMs > SLOW_HISTORY_LATENCY_MS;
  }

  return true;
}

/**
 * @param {any[]} historyEntries
 * @param {Record<string, any>=} filters
 * @returns {any[]}
 */
function filterHistoryEntries(historyEntries, filters = {}) {
  const dateFromMs = parseLocalFilterDate(filters.dateFrom);
  const dateToMs = parseLocalFilterDate(filters.dateTo, true);
  return historyEntries.filter((entry) => {
    const keyword = String(filters.search || '').trim().toLowerCase();
    if (filters.projectId && entry.projectId !== filters.projectId) return false;
    if (filters.subject && entry.subject !== filters.subject) return false;
    if (filters.provider) {
      const providerFilter = String(filters.provider).trim().toLowerCase();
      const providerId = String(entry.providerId || '').trim().toLowerCase();
      const providerName = String(entry.providerName || '').trim().toLowerCase();
      if (providerFilter && providerFilter !== providerId && providerFilter !== providerName) return false;
    }
    if (filters.model && entry.model !== filters.model) return false;
    if (filters.status && entry.status !== filters.status) return false;
    if (filters.issue && !matchesHistoryIssue(entry, filters.issue)) return false;
    const submittedAtMs = parseTimeMs(entry.submittedAt);
    if (Number.isFinite(dateFromMs) && Number.isFinite(submittedAtMs) && Number(submittedAtMs) < Number(dateFromMs)) return false;
    if (Number.isFinite(dateToMs) && Number.isFinite(submittedAtMs) && Number(submittedAtMs) > Number(dateToMs)) return false;
    if (!keyword) return true;
    const summaryText = [
      entry.requestId,
      entry.projectId,
      entry.subject,
      entry.providerId,
      entry.providerName,
      entry.model,
      entry.status,
      entry.segmentSummary
    ].map((item) => String(item || '').toLowerCase()).join(' ');
    return summaryText.includes(keyword);
  });
}

module.exports = {
  HISTORY_ISSUE_FILTERS,
  SLOW_HISTORY_LATENCY_MS,
  parseTimeMs,
  parseLocalFilterDate,
  formatLocalTimestamp,
  filterHistoryEntries,
  hasHistoryFallback,
  matchesHistoryIssue
};
