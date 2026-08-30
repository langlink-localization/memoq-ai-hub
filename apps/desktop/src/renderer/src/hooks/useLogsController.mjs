import { useState } from 'react';
import { buildLogDiagnosticText, normalizeLogStatePayload } from '../pages/logs/logPresentation.mjs';

// Owns the renderer log-diagnostics domain: log state loading, pruning with
// confirmation, directory reveal, and the support-summary clipboard copy.
export function useLogsController({ api, t, message, modal, notifyError, appState }) {
  const [logState, setLogState] = useState(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logPruning, setLogPruning] = useState(false);

  async function refreshLogs() {
    if (!api?.getLogState) {
      return;
    }

    try {
      setLogLoading(true);
      setLogState(normalizeLogStatePayload(await api.getLogState()));
    } catch (loadError) {
      notifyError(loadError);
    } finally {
      setLogLoading(false);
    }
  }

  async function pruneLogsNow() {
    if (!api?.pruneLogs) {
      return;
    }

    try {
      setLogPruning(true);
      const result = await api.pruneLogs();
      message.success(t('logs.cleanSuccess', { count: result?.deletedCount || 0 }));
      await refreshLogs();
    } catch (pruneError) {
      notifyError(pruneError);
    } finally {
      setLogPruning(false);
    }
  }

  function confirmPruneLogs() {
    if (logPruning) return;
    modal.confirm({
      title: t('logs.cleanConfirmTitle'),
      content: t('logs.cleanConfirmDescription'),
      okText: t('logs.cleanNow'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: pruneLogsNow
    });
  }

  async function openLogsDirectory() {
    if (!logState?.logsDir) {
      return;
    }

    try {
      await api.openPath(logState.logsDir);
    } catch (openError) {
      notifyError(openError);
    }
  }

  async function revealLogFile(filePath) {
    if (!filePath) {
      return;
    }

    try {
      await api.showItemInFolder(filePath);
    } catch (openError) {
      notifyError(openError);
    }
  }

  async function copyLogDiagnostics() {
    try {
      await navigator.clipboard.writeText(buildLogDiagnosticText(logState || {}, appState || {}, t));
      message.success(t('logs.copySuccess'));
    } catch (copyError) {
      notifyError(copyError);
    }
  }

  return {
    logState,
    logLoading,
    logPruning,
    refreshLogs,
    confirmPruneLogs,
    openLogsDirectory,
    revealLogFile,
    copyLogDiagnostics
  };
}
