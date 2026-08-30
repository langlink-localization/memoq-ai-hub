import { useEffect, useRef, useState } from 'react';
import { normalizeAppStatePayload } from '../appState.mjs';
import { buildInstallDraft, getPresetInstallDir, getUpdateErrorDisplay } from '../pages/dashboard/dashboardPresentation.mjs';
import {
  getDashboardStatusSnapshot,
  setDashboardStatusSnapshot
} from '../pages/dashboard/dashboardStatusStore.mjs';

// Owns the dashboard action domain: integration install draft and confirmation,
// handshake test, update checking (including the automatic first check after
// startup), download/open/launch update flows, and the lightweight dashboard
// status polling refresh.
export function useDashboardActions({ api, t, message, modal, notifyError, refresh, historyFilters, setState, startupStatus }) {
  const [installing, setInstalling] = useState(false);
  const [handshaking, setHandshaking] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateActionLoading, setUpdateActionLoading] = useState(false);
  const [installDraft, setInstallDraft] = useState(() => buildInstallDraft());
  const [installDraftDirty, setInstallDraftDirty] = useState(false);
  const autoUpdateCheckStartedRef = useRef(false);

  async function refreshDashboardStatus() {
    if (!api?.getAppState) return;

    try {
      const remoteData = normalizeAppStatePayload(await api.getAppState({
        includeHistoryExplorer: false,
        includeProviderHistoryMetrics: false
      }));
      setDashboardStatusSnapshot(remoteData);
    } catch (loadError) {
      notifyError(loadError);
    }
  }

  useEffect(() => {
    if (startupStatus !== 'ready' || autoUpdateCheckStartedRef.current || typeof api?.checkForUpdates !== 'function') {
      return;
    }

    autoUpdateCheckStartedRef.current = true;
    void api.checkForUpdates({ manual: false })
      .then((updateState) => {
        setState((current) => current ? normalizeAppStatePayload({
          ...current,
          updateCenter: updateState,
          dashboard: {
            ...(current.dashboard || {}),
            updateCenter: updateState
          }
        }) : current);
      })
      .catch(() => {
      });
  }, [api, startupStatus, setState]);

  async function chooseInstallDirectory() {
    try {
      const directory = await api.pickDirectory();
      if (!directory) {
        return;
      }

      setInstallDraftDirty(true);
      setInstallDraft((current) => ({
        ...current,
        mode: 'custom',
        customInstallDir: directory,
        selectedInstallDir: directory
      }));
    } catch (pickError) {
      notifyError(pickError);
    }
  }

  async function installIntegration(selectedInstallDir) {
    if (installing) return;

    setInstalling(true);
    try {
      await api.installIntegration({
        memoqVersion: installDraft.memoqVersion,
        selectedInstallDir,
        customInstallDir: installDraft.mode === 'custom' ? selectedInstallDir : ''
      });
      message.success(t('dashboard.installSuccess'));
      setInstallDraftDirty(false);
      await refresh();
    } catch (installError) {
      notifyError(installError);
    } finally {
      setInstalling(false);
    }
  }

  function confirmInstallIntegration() {
    const selectedInstallDir = installDraft.mode === 'custom'
      ? String(installDraft.customInstallDir || '').trim()
      : getPresetInstallDir(installDraft.memoqVersion);

    if (!selectedInstallDir) {
      message.error(t('dashboard.installDirectoryRequired'));
      return;
    }

    modal.confirm({
      title: t('dashboard.installConfirmTitle'),
      content: t('dashboard.installConfirmDescription', { path: selectedInstallDir }),
      okText: t('dashboard.installReinstall'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: () => installIntegration(selectedInstallDir)
    });
  }

  async function testHandshake() {
    setHandshaking(true);
    try {
      const version = await api.testHandshake();
      message.success(`${t('dashboard.handshakeSuccess')} ${version.productName} (${version.contractVersion})`);
      await refresh();
    } catch (handshakeError) {
      notifyError(handshakeError);
    } finally {
      setHandshaking(false);
    }
  }

  async function runUpdateAction(action, successMessage = '') {
    setUpdateActionLoading(true);
    try {
      const result = await action();
      if (successMessage) {
        message.success(successMessage);
      }
      await refresh(historyFilters);
      return result;
    } catch (updateError) {
      notifyError(updateError);
      return null;
    } finally {
      setUpdateActionLoading(false);
    }
  }

  async function checkForUpdates(manual = true) {
    if (typeof api?.checkForUpdates !== 'function') {
      return;
    }

    setCheckingUpdates(true);
    try {
      const result = await api.checkForUpdates({ manual });
      const dashboardStatus = getDashboardStatusSnapshot();
      if (dashboardStatus) {
        setDashboardStatusSnapshot({
          ...dashboardStatus,
          updateCenter: result,
          dashboard: {
            ...(dashboardStatus.dashboard || {}),
            updateCenter: result
          }
        });
      }
      setState((current) => {
        if (!current) return current;
        return normalizeAppStatePayload({
          ...current,
          updateCenter: result,
          dashboard: {
            ...(current.dashboard || {}),
            updateCenter: result
          }
        });
      });

      if (manual) {
        if (result?.updateStatus === 'error') {
          message.error(getUpdateErrorDisplay(result, t) || t('dashboard.updateStatusError'));
        } else {
          message.success(
            result?.updateStatus === 'available'
              ? t('dashboard.updateAvailableSuccess', { version: result?.latestVersion || '-' })
              : t('dashboard.updateUpToDateSuccess')
          );
        }
      }
    } catch (updateError) {
      notifyError(updateError);
    } finally {
      setCheckingUpdates(false);
    }
  }

  async function downloadInstallerUpdate(dashboardUpdateCenter = {}) {
    await runUpdateAction(
      () => api.downloadInstallerUpdate(dashboardUpdateCenter.latestVersion || ''),
      t('dashboard.updateDownloadStarted')
    );
  }

  async function openPortableDownloadPage(portableDownloadUrl = '') {
    if (!portableDownloadUrl || typeof api?.openExternalUrl !== 'function') {
      return;
    }
    await runUpdateAction(() => api.openExternalUrl(portableDownloadUrl));
  }

  async function openUpdateReleaseNotes(dashboardUpdateCenter = {}) {
    if (!dashboardUpdateCenter.releaseNotesUrl || typeof api?.openExternalUrl !== 'function') {
      return;
    }
    await runUpdateAction(() => api.openExternalUrl(dashboardUpdateCenter.releaseNotesUrl));
  }

  async function launchDownloadedInstallerUpdateNow(dashboardUpdateCenter = {}) {
    if (!dashboardUpdateCenter.downloadedArtifactPath || typeof api?.launchDownloadedInstallerUpdate !== 'function') {
      return;
    }
    await runUpdateAction(
      () => api.launchDownloadedInstallerUpdate(dashboardUpdateCenter.downloadedArtifactPath),
      t('dashboard.updateInstallerLaunchSuccess')
    );
  }

  function confirmLaunchDownloadedInstallerUpdate(dashboardUpdateCenter = {}) {
    if (!dashboardUpdateCenter.downloadedArtifactPath || updateActionLoading) return;
    modal.confirm({
      title: t('dashboard.restartUpdateConfirmTitle'),
      content: t('dashboard.restartUpdateConfirmDescription'),
      okText: t('dashboard.restartAndInstallUpdate'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: () => launchDownloadedInstallerUpdateNow(dashboardUpdateCenter)
    });
  }

  return {
    installing,
    handshaking,
    checkingUpdates,
    updateActionLoading,
    installDraft,
    installDraftDirty,
    setInstallDraft,
    setInstallDraftDirty,
    refreshDashboardStatus,
    chooseInstallDirectory,
    confirmInstallIntegration,
    testHandshake,
    checkForUpdates,
    runUpdateAction,
    downloadInstallerUpdate,
    openPortableDownloadPage,
    openUpdateReleaseNotes,
    confirmLaunchDownloadedInstallerUpdate
  };
}
