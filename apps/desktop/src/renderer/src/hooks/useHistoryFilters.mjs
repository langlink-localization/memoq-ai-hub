import { useState } from 'react';
import { createEmptyHistoryFilters } from '../pages/history/historyPresentation.mjs';

// Owns the history filter domain: the editable filter draft, the applied
// filters, the insight focus state, and the filter apply/reset/refresh
// actions. History selection state stays in the app shell because the global
// refresh() prunes it against freshly loaded history items.
export function useHistoryFilters({ api, refresh, beginPendingOperation, setHistoryRefreshing, setSelectedHistoryIds, setSelectedHistoryId, setProviderInsightFocus }) {
  const [historyFilterDraft, setHistoryFilterDraft] = useState(() => createEmptyHistoryFilters());
  const [historyFilters, setHistoryFilters] = useState(() => createEmptyHistoryFilters());
  const [historyInsightFocus, setHistoryInsightFocus] = useState(null);

  async function applyHistoryFilters() {
    const endPending = beginPendingOperation('history-refresh', setHistoryRefreshing);
    if (!endPending) return;
    setHistoryInsightFocus(null);
    setHistoryFilters(historyFilterDraft);
    setSelectedHistoryIds([]);
    setSelectedHistoryId('');
    try {
      await refresh(historyFilterDraft, { includeHistoryExplorer: true });
    } finally {
      endPending();
    }
  }

  function updateHistoryFilterDraftField(field, value) {
    setHistoryInsightFocus(null);
    setHistoryFilterDraft((current) => ({ ...current, [field]: value }));
  }

  async function applyHistoryInsightFilter(filter = {}, focus = {}) {
    const endPending = beginPendingOperation('history-refresh', setHistoryRefreshing);
    if (!endPending) return;
    const nextFilters = {
      ...createEmptyHistoryFilters(),
      ...(filter && typeof filter === 'object' ? filter : {})
    };
    setHistoryInsightFocus({
      ...(focus && typeof focus === 'object' ? focus : {}),
      filter: nextFilters
    });
    setHistoryFilterDraft(nextFilters);
    setHistoryFilters(nextFilters);
    setSelectedHistoryIds([]);
    setSelectedHistoryId('');
    try {
      await refresh(nextFilters, { includeHistoryExplorer: true });
    } finally {
      endPending();
    }
  }

  async function resetHistoryFilters() {
    const endPending = beginPendingOperation('history-refresh', setHistoryRefreshing);
    if (!endPending) return;
    const emptyFilters = createEmptyHistoryFilters();
    setHistoryInsightFocus(null);
    setProviderInsightFocus(null);
    setHistoryFilterDraft(emptyFilters);
    setHistoryFilters(emptyFilters);
    setSelectedHistoryIds([]);
    setSelectedHistoryId('');
    try {
      await refresh(emptyFilters, { includeHistoryExplorer: true });
    } finally {
      endPending();
    }
  }

  async function refreshHistory() {
    const endPending = beginPendingOperation('history-refresh', setHistoryRefreshing);
    if (!endPending) return;
    try {
      await refresh(historyFilters, { includeHistoryExplorer: true });
    } finally {
      endPending();
    }
  }

  return {
    historyFilterDraft,
    historyFilters,
    historyInsightFocus,
    setHistoryInsightFocus,
    applyHistoryFilters,
    updateHistoryFilterDraftField,
    applyHistoryInsightFilter,
    resetHistoryFilters,
    refreshHistory
  };
}
