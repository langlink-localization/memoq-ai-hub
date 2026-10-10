import { Button, Progress, Space, Typography } from 'antd';
import { RefreshIcon } from '@langlink-tech/antd-kit/icons';
const { Text } = Typography;

export default function UpdateActions({
  api,
  checkForUpdates,
  cancelUpdateDownload,
  checkingUpdates,
  updateActionLoading,
  safeUpdateStatus,
  hasAvailableUpdate,
  updateCenter,
  portableInAppSupported,
  openPortableDownloadPage,
  portableDownloadPage,
  downloadPortableUpdateNow,
  preparePortableUpdateNow,
  confirmApplyPortableUpdate,
  updateBusy,
  downloadInstallerUpdate,
  confirmLaunchDownloadedInstallerUpdate,
  runUpdateAction,
  openUpdateReleaseNotes,
  t
}) {
  return <Space orientation="vertical" size={8} className="app-block-space">
    <Text type="secondary">{t(updateCenter.networkMode === 'system' ? 'dashboard.updateSystemProxyHint' : 'dashboard.updateDirectNetworkHint')}</Text>
    {safeUpdateStatus === 'downloading' ? <Text type="secondary">{t('dashboard.updateDownloadCancelHint')}</Text> : null}
    {safeUpdateStatus === 'downloading' && updateCenter.downloadProgress?.totalBytes > 0 ? (
      <Progress percent={Math.min(99, Math.floor(updateCenter.downloadProgress.receivedBytes * 100 / updateCenter.downloadProgress.totalBytes))} status="active" />
    ) : null}
    <Space wrap>
      <Button icon={<RefreshIcon />} disabled={updateActionLoading || safeUpdateStatus === 'downloading'} loading={checkingUpdates} onClick={() => void checkForUpdates(true)}>
        {t('dashboard.checkForUpdates')}
      </Button>
      {updateCenter.packagingMode === 'portable' && hasAvailableUpdate && portableInAppSupported ? (
        <Button type="primary" loading={updateActionLoading} onClick={() => void downloadPortableUpdateNow(updateCenter)}>
          {t(safeUpdateStatus === 'error' ? 'dashboard.retryUpdateDownload' : 'dashboard.downloadUpdate')}
        </Button>
      ) : null}
      <Button onClick={() => void openPortableDownloadPage(portableDownloadPage)}>
        {t('dashboard.openPortableDownloadPage')}
      </Button>
      {safeUpdateStatus === 'downloading' ? (
        <Button onClick={() => void cancelUpdateDownload()}>{t('dashboard.cancelUpdateDownload')}</Button>
      ) : null}
      {updateCenter.packagingMode === 'portable' && safeUpdateStatus === 'prepared' && portableInAppSupported ? (
        <Button danger loading={updateActionLoading} onClick={() => confirmApplyPortableUpdate(updateCenter, { busy: updateBusy })}>
          {t('dashboard.restartAndInstallUpdate')}
        </Button>
      ) : null}
      {updateCenter.packagingMode === 'portable' && safeUpdateStatus === 'available' && updateCenter.downloadedArtifactPath && portableInAppSupported ? (
        <Button loading={updateActionLoading} onClick={() => void preparePortableUpdateNow(updateCenter)}>
          {t('dashboard.prepareUpdateRetry')}
        </Button>
      ) : null}
      {updateCenter.packagingMode === 'installed' && hasAvailableUpdate ? (
        <Button type="primary" loading={updateActionLoading} onClick={() => void downloadInstallerUpdate(updateCenter)}>
          {t(safeUpdateStatus === 'error' ? 'dashboard.retryUpdateDownload' : 'dashboard.downloadAndInstallUpdate')}
        </Button>
      ) : null}
      {updateCenter.packagingMode === 'installed' && updateCenter.downloadedArtifactPath ? (
        <Button danger loading={updateActionLoading} onClick={() => confirmLaunchDownloadedInstallerUpdate(updateCenter)}>
          {t('dashboard.restartAndInstallUpdate')}
        </Button>
      ) : null}
      {updateCenter.packagingMode === 'installed' && updateCenter.downloadedArtifactPath ? (
        <Button loading={updateActionLoading} onClick={() => void runUpdateAction(() => api.showItemInFolder(updateCenter.downloadedArtifactPath))}>
          {t('dashboard.revealDownloadedUpdate')}
        </Button>
      ) : null}
      {updateCenter.packagingMode === 'portable' && updateCenter.downloadedArtifactPath ? (
        <Button loading={updateActionLoading} onClick={() => void runUpdateAction(() => api.showItemInFolder(updateCenter.downloadedArtifactPath))}>
          {t('dashboard.revealDownloadedUpdate')}
        </Button>
      ) : null}
      {updateCenter.releaseNotesUrl ? (
        <Button onClick={() => void openUpdateReleaseNotes(updateCenter)}>
          {t('dashboard.viewReleaseNotes')}
        </Button>
      ) : null}
    </Space>
  </Space>;
}
