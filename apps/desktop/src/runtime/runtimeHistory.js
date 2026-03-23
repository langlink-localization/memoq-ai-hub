const {
  formatTimestampForLocalDisplay,
  parseDateInputToEpochMs,
  parseTimestampToEpochMs
} = require('../shared/timeFormatting');

function parseTimeMs(value) {
  const parsed = parseTimestampToEpochMs(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseLocalFilterDate(value, endOfDay = false) {
  const parsed = parseDateInputToEpochMs(value, { endOfDay });
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatLocalTimestamp(value) {
  return formatTimestampForLocalDisplay(value, { fallback: '' });
}

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
    const submittedAtMs = parseTimeMs(entry.submittedAt);
    if (Number.isFinite(dateFromMs) && Number.isFinite(submittedAtMs) && submittedAtMs < dateFromMs) return false;
    if (Number.isFinite(dateToMs) && Number.isFinite(submittedAtMs) && submittedAtMs > dateToMs) return false;
    return keyword ? JSON.stringify(entry).toLowerCase().includes(keyword) : true;
  });
}

module.exports = {
  parseTimeMs,
  parseLocalFilterDate,
  formatLocalTimestamp,
  filterHistoryEntries
};
