const {
  hasHistoryFallback,
  SLOW_HISTORY_LATENCY_MS
} = require('./runtimeHistory');
const { buildHistorySummary } = require('./runtimeHistoryIntegrationSupport');

// Owns history read-model presentation: list loading from persistence, the
// lightweight list-item projection with issue flags, and per-entry lookups.
// The list item carries only IPC-serializable own fields; the original
// diagnostic payload stays reachable through the prototype for internal
// runtime callers.
function createRuntimeHistoryPresentation({ persistence }) {
  function loadHistoryEntries() {
    return persistence.listHistory();
  }

  function loadHistoryEntry(entryId) {
    return persistence.getHistoryEntry(entryId);
  }

  function buildHistoryIssueFlags(entry = {}) {
    const attempts = Array.isArray(entry.attempts) ? entry.attempts : [];
    const latencyMs = Number(entry.latencyMs);
    return {
      failed: String(entry.status || '').trim().toLowerCase() === 'failed',
      timeout: attempts.some((attempt) => {
        const errorCode = String(attempt?.errorCode || '').trim().toUpperCase();
        return errorCode === 'PROVIDER_TIMEOUT' || errorCode === 'TRANSLATION_TIMEOUT';
      }),
      rate_limit: attempts.some((attempt) => String(attempt?.errorCode || '').trim().toUpperCase() === 'PROVIDER_RATE_LIMITED'),
      fallback: hasHistoryFallback(entry),
      slow: Number.isFinite(latencyMs) && latencyMs > SLOW_HISTORY_LATENCY_MS,
      cache_hit: attempts.some((attempt) => {
        const cacheKind = String(attempt?.cacheKind || '').trim().toLowerCase();
        return cacheKind === 'exact' || cacheKind === 'adaptive';
      })
    };
  }

  function buildHistoryListItem(entry = {}) {
    const summary = buildHistorySummary(entry);
    const item = {
      id: String(entry.id || '').trim(),
      requestId: String(entry.requestId || '').trim(),
      projectId: String(entry.projectId || '').trim(),
      subject: String(entry.subject || '').trim(),
      providerId: String(entry.providerId || '').trim(),
      providerName: String(entry.providerName || '').trim(),
      model: String(entry.model || '').trim(),
      status: String(entry.status || '').trim(),
      submittedAt: String(entry.submittedAt || '').trim(),
      completedAt: String(entry.completedAt || '').trim(),
      latencyMs: Number.isFinite(Number(entry.latencyMs)) ? Number(entry.latencyMs) : null,
      ...summary,
      issueFlags: buildHistoryIssueFlags(entry)
    };
    Object.setPrototypeOf(item, entry);
    return item;
  }

  return {
    loadHistoryEntries,
    loadHistoryEntry,
    buildHistoryListItem,
    buildHistoryIssueFlags
  };
}

module.exports = {
  createRuntimeHistoryPresentation
};
