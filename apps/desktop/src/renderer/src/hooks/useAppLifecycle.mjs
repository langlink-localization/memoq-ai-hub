import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPageScrollPosition,
  updatePageScrollPosition,
  writeShellState
} from '../uiBehavior.mjs';

export function useLatestCallback(callback) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback((...args) => callbackRef.current?.(...args), []);
}

export function usePollingRefresh(refresh, delayMs) {
  const runRefresh = useLatestCallback(refresh);
  useEffect(() => {
    void runRefresh();
    const timer = globalThis.setInterval(() => void runRefresh(true), delayMs);
    return () => globalThis.clearInterval(timer);
  }, [delayMs, runRefresh]);
}

export function createVisibleInterval({
  enabled,
  delayMs,
  callback,
  windowRef = globalThis,
  documentRef = globalThis.document
}) {
  if (!enabled || typeof windowRef?.setInterval !== 'function') {
    return () => {};
  }

  const timer = windowRef.setInterval(() => {
    if (documentRef?.hidden) return;
    callback();
  }, delayMs);
  return () => windowRef.clearInterval?.(timer);
}

function useVisibleInterval(enabled, delayMs, callback) {
  const runCallback = useLatestCallback(callback);
  useEffect(() => createVisibleInterval({
    enabled,
    delayMs,
    callback: runCallback,
    windowRef: globalThis.window,
    documentRef: globalThis.document
  }), [delayMs, enabled, runCallback]);
}

export function useAppDataLifecycle({
  activePage,
  startupStatus,
  historyFilters,
  refresh,
  refreshDashboardStatus,
  refreshLogs
}) {
  const historyFiltersRef = useRef(historyFilters);
  historyFiltersRef.current = historyFilters;
  const runRefresh = useLatestCallback(refresh);
  const runDashboardRefresh = useLatestCallback(refreshDashboardStatus);
  const runLogRefresh = useLatestCallback(refreshLogs);

  useEffect(() => {
    void runRefresh();
  }, [runRefresh]);

  useVisibleInterval(startupStatus === 'starting', 1000, runRefresh);
  useVisibleInterval(
    startupStatus === 'ready' && activePage === 'dashboard',
    3000,
    runDashboardRefresh
  );

  useEffect(() => {
    if (activePage === 'logs') {
      void runLogRefresh();
    } else if (activePage === 'providers') {
      void runRefresh({}, { includeProviderHistoryMetrics: true });
    } else if (activePage === 'history') {
      void runRefresh(historyFiltersRef.current, { includeHistoryExplorer: true });
    } else if (activePage === 'mapping') {
      void runRefresh();
    }
  }, [activePage, runLogRefresh, runRefresh]);
}

export function loadHistoryDetail({ api, selectedHistoryId, t, update }) {
  if (!selectedHistoryId) {
    update({ record: null, loading: false, error: '' });
    return () => {};
  }

  let cancelled = false;
  update({ record: null, loading: true, error: '' });

  if (typeof api?.getHistoryEntry !== 'function') {
    update({ record: null, loading: false, error: t('history.detailLoadFailed') });
    return () => {};
  }

  void api.getHistoryEntry(selectedHistoryId)
    .then((entry) => {
      if (cancelled) return;
      if (!entry) {
        update({ error: t('history.detailNotFound') });
        return;
      }
      update({ record: entry });
    })
    .catch((loadError) => {
      if (!cancelled) {
        update({ error: String(loadError?.message || t('history.detailLoadFailed')) });
      }
    })
    .finally(() => {
      if (!cancelled) update({ loading: false });
    });

  return () => {
    cancelled = true;
  };
}

export function useHistoryDetail({ api, selectedHistoryId, t }) {
  const [detail, setDetail] = useState({ record: null, loading: false, error: '' });

  useEffect(() => loadHistoryDetail({
    api,
    selectedHistoryId,
    t,
    update: (patch) => setDetail((current) => ({ ...current, ...patch }))
  }), [api, selectedHistoryId, t]);

  return detail;
}

export function useShellLifecycle({
  initialShellState,
  activePage,
  navCollapsed,
  setViewportWidth,
  shellNavigationMode,
  setMobileNavOpen,
  hasUnsavedDrafts
}) {
  const pageScrollPositionsRef = useRef(initialShellState.pageScrollPositions || {});
  const navCollapsedRef = useRef(navCollapsed);
  navCollapsedRef.current = navCollapsed;

  const persistCurrentPageScrollPosition = useCallback(() => {
    const scrollTop = Math.max(0, Number(globalThis.scrollY || globalThis.pageYOffset || 0));
    pageScrollPositionsRef.current = updatePageScrollPosition(
      pageScrollPositionsRef.current,
      activePage,
      scrollTop
    );
    writeShellState(globalThis.localStorage, {
      activePage,
      navCollapsed: navCollapsedRef.current,
      pageScrollPositions: pageScrollPositionsRef.current
    });
  }, [activePage]);

  useEffect(() => {
    writeShellState(globalThis.localStorage, {
      activePage,
      navCollapsed,
      pageScrollPositions: pageScrollPositionsRef.current
    });
  }, [activePage, navCollapsed]);

  useEffect(() => {
    const targetScrollTop = getPageScrollPosition(pageScrollPositionsRef.current, activePage);
    const frameId = globalThis.requestAnimationFrame?.(() => {
      globalThis.scrollTo?.({ top: targetScrollTop, left: 0, behavior: 'auto' });
    });
    return () => globalThis.cancelAnimationFrame?.(frameId);
  }, [activePage]);

  useEffect(() => {
    globalThis.addEventListener?.('pagehide', persistCurrentPageScrollPosition);
    return () => globalThis.removeEventListener?.('pagehide', persistCurrentPageScrollPosition);
  }, [persistCurrentPageScrollPosition]);

  useEffect(() => {
    function handleResize() {
      setViewportWidth(Number(globalThis.innerWidth || 1366));
    }
    globalThis.addEventListener?.('resize', handleResize);
    return () => globalThis.removeEventListener?.('resize', handleResize);
  }, [setViewportWidth]);

  useEffect(() => {
    if (shellNavigationMode !== 'drawer') setMobileNavOpen(false);
  }, [setMobileNavOpen, shellNavigationMode]);

  useEffect(() => {
    if (!hasUnsavedDrafts) return undefined;
    function protectUnsavedDrafts(event) {
      event.preventDefault();
      event.returnValue = '';
    }
    globalThis.addEventListener?.('beforeunload', protectUnsavedDrafts);
    return () => globalThis.removeEventListener?.('beforeunload', protectUnsavedDrafts);
  }, [hasUnsavedDrafts]);

  return { persistCurrentPageScrollPosition };
}
