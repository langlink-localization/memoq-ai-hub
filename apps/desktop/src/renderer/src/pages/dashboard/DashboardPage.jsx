import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Alert, Button, Card, Col, Collapse, Descriptions, Empty, Input, List, Radio, Row, Select, Space, Tag, Typography } from 'antd';
import { DeploymentUnitOutlined, ReloadOutlined } from '@ant-design/icons';
import HoverText from '../../components/HoverText.jsx';
import { formatLocalTimestamp } from '../../timeFormatting.mjs';
import { buildDashboardChecklist } from '../../uiBehavior.mjs';
import {
  buildInstallDraft,
  buildInstallOptions,
  getPackagingModeLabel,
  getPresetInstallDir,
  getRuntimeConnectionLabel,
  getSafeUpdateStatus,
  getUpdateErrorDisplay,
  getUpdateStatusLabel
} from './dashboardPresentation.mjs';
import {
  getDashboardStatusSnapshot,
  subscribeDashboardStatus
} from './dashboardStatusStore.mjs';

const { Text } = Typography;

export default function DashboardPage({
  api,
  checkForUpdates,
  checkingUpdates,
  chooseInstallDirectory,
  confirmInstallIntegration,
  confirmLaunchDownloadedInstallerUpdate,
  downloadInstallerUpdate,
  handleChecklistAction,
  handshaking,
  initialState,
  installDraft,
  installDraftDirty,
  installing,
  openPortableDownloadPage,
  openUpdateReleaseNotes,
  runUpdateAction,
  setInstallDraft,
  setInstallDraftDirty,
  t,
  testHandshake,
  updateActionLoading
}) {
  const state = useSyncExternalStore(
    subscribeDashboardStatus,
    getDashboardStatusSnapshot,
    getDashboardStatusSnapshot
  ) || initialState;
  const installOptions = useMemo(() => buildInstallOptions(state?.integration || {}), [state?.integration]);
  const installPreviewPath = installDraft.mode === 'custom'
    ? installDraft.customInstallDir
    : getPresetInstallDir(installDraft.memoqVersion);
  const selectedInstallVersionOptions = installOptions.map((option) => ({
    label: option.label || `memoQ ${option.version}`,
    value: option.version,
    path: option.selectedInstallDir
  }));
  const visibleDashboardNotices = useMemo(
    () => (state?.dashboard?.notices || []).filter((notice) => notice !== 'No mapping rule has been configured yet.'),
    [state?.dashboard?.notices]
  );
  const dashboardChecklistItems = useMemo(
    () => buildDashboardChecklist(state?.dashboard?.checklist || [], t),
    [state?.dashboard?.checklist, t]
  );
  const dashboardRequiredSteps = dashboardChecklistItems.filter((item) => item?.optional !== true);
  const dashboardCompletedSteps = dashboardRequiredSteps.filter((item) => item?.completed === true).length;
  const dashboardJourneyComplete = dashboardRequiredSteps.length > 0
    && dashboardCompletedSteps === dashboardRequiredSteps.length;
  const connectionStatusLabel = getRuntimeConnectionLabel(
    state?.dashboard?.runtimeStatus?.connectionStatus,
    t
  );
  const previewBridgeStatus = state?.dashboard?.runtimeStatus?.previewStatus || {};
  const previewBridgeStatusLabel = getRuntimeConnectionLabel(previewBridgeStatus.status, t);
  const updateCenter = state?.updateCenter || state?.dashboard?.updateCenter || { availableAssets: {} };
  const safeUpdateStatus = getSafeUpdateStatus(updateCenter);
  const effectiveUpdateStatus = checkingUpdates ? 'checking' : safeUpdateStatus;
  const hasAvailableUpdate = !checkingUpdates && safeUpdateStatus === 'available';
  const portableDownloadPage = hasAvailableUpdate
    ? (updateCenter.portableDownloadUrl || updateCenter.releaseNotesUrl || updateCenter.availableAssets?.portable?.url || '')
    : '';
  const updateStatusLabel = getUpdateStatusLabel(effectiveUpdateStatus, t);
  const latestVersionDisplay = updateCenter.latestVersion
    || (effectiveUpdateStatus === 'checking' ? t('dashboard.updateCheckingLatestVersion') : '');
  const updateErrorDisplay = getUpdateErrorDisplay(updateCenter, t);
  const packagingModeLabel = getPackagingModeLabel(updateCenter.packagingMode, t);

  useEffect(() => {
    if (!installDraftDirty) {
      setInstallDraft(buildInstallDraft(state?.integration || {}));
    }
  }, [installDraftDirty, setInstallDraft, state?.integration]);

  return (
<Space direction="vertical" size={16} className="app-block-space">
              <Card
                className="page-card dashboard-journey-card"
                title={(
                  <div className="dashboard-journey-heading">
                    <Text strong>{t('dashboard.setupJourneyTitle')}</Text>
                    <Text type="secondary">{t('dashboard.setupJourneyDescription')}</Text>
                  </div>
                )}
                extra={(
                  <Tag color={dashboardJourneyComplete ? 'green' : 'blue'}>
                    {t('dashboard.setupJourneyProgress', {
                      completed: dashboardCompletedSteps,
                      total: dashboardRequiredSteps.length
                    })}
                  </Tag>
                )}
              >
                <div className="dashboard-journey-grid">
                {dashboardChecklistItems.map((item) => (
                  <div className={`dashboard-journey-step ${item.completed ? 'dashboard-journey-step-complete' : ''}`} key={item.key}>
                    <div className="dashboard-journey-step-heading">
                      <Text strong>{item.title}</Text>
                      <Tag bordered={false} color={item.completed ? 'green' : item.optional ? 'blue' : undefined}>
                        {item.completed
                          ? t('dashboard.stepComplete')
                          : item.optional
                            ? t('dashboard.stepOptional')
                            : t('dashboard.stepTodo')}
                      </Tag>
                    </div>
                    <Text type="secondary">{item.subtitle}</Text>
                    <Button type="link" className="dashboard-journey-action" onClick={() => handleChecklistAction(item.key)}>{item.actionLabel}</Button>
                  </div>
                ))}
                </div>
              </Card>
              <Row gutter={[16, 16]}>
                <Col xs={24} xl={12}>
                  <Card className="page-card" title={t('dashboard.runtimeStatus')}>
                    <Descriptions column={1} className="wrap-descriptions">
                      <Descriptions.Item label={t('dashboard.memoqPath')}><HoverText value={state.dashboard.runtimeStatus.memoqInstallPath} /></Descriptions.Item>
                      <Descriptions.Item label={t('dashboard.pluginStatus')}><HoverText value={state.dashboard.runtimeStatus.pluginStatus} /></Descriptions.Item>
                      <Descriptions.Item label={t('dashboard.connectionStatus')}><HoverText value={connectionStatusLabel} /></Descriptions.Item>
                      <Descriptions.Item label={t('dashboard.previewStatus')}><HoverText value={previewBridgeStatusLabel} /></Descriptions.Item>
                      <Descriptions.Item label={t('dashboard.previewLastError')}><HoverText value={previewBridgeStatus.lastError} /></Descriptions.Item>
                    </Descriptions>
                    <Space wrap className="responsive-action-bar card-action-row">
                      <Button loading={handshaking} onClick={testHandshake} disabled={state?.startup?.status !== 'ready'}>{t('dashboard.testConnection')}</Button>
                    </Space>
                  </Card>
                </Col>
                <Col xs={24} xl={12}>
                  <Card className="page-card" title={t('dashboard.installConfig')}>
                    <Space direction="vertical" size={16} className="app-block-space">
                      <Alert type="info" showIcon message={t('dashboard.installDialogHint')} />
                      <Alert
                        type="warning"
                        showIcon
                        message={t('dashboard.memoqParallelismNoticeTitle')}
                        description={t('dashboard.memoqParallelismNotice')}
                      />
                      <Row gutter={[16, 16]}>
                        <Col xs={24} md={12}>
                          <Space direction="vertical" size={8} className="app-block-space">
                            <Text strong>{t('dashboard.installMemoqVersion')}</Text>
                            <Select
                              value={installDraft.memoqVersion}
                              options={selectedInstallVersionOptions.map((option) => ({
                                value: option.value,
                                label: option.label
                              }))}
                              onChange={(value) => {
                                setInstallDraftDirty(true);
                                setInstallDraft((current) => ({
                                  ...current,
                                  memoqVersion: value,
                                  selectedInstallDir: current.mode === 'preset' ? getPresetInstallDir(value) : current.selectedInstallDir
                                }));
                              }}
                            />
                          </Space>
                        </Col>
                        <Col xs={24} md={12}>
                          <Space direction="vertical" size={8} className="app-block-space">
                            <Text strong>{t('dashboard.installMode')}</Text>
                            <Radio.Group
                              value={installDraft.mode}
                              onChange={(event) => {
                                const mode = event.target.value;
                                setInstallDraftDirty(true);
                                setInstallDraft((current) => ({
                                  ...current,
                                  mode,
                                  customInstallDir: mode === 'preset' ? '' : current.customInstallDir,
                                  selectedInstallDir: mode === 'preset'
                                    ? getPresetInstallDir(current.memoqVersion)
                                    : current.selectedInstallDir
                                }));
                              }}
                            >
                              <Radio value="preset">{t('dashboard.installPreset')}</Radio>
                              <Radio value="custom">{t('dashboard.installCustom')}</Radio>
                            </Radio.Group>
                          </Space>
                        </Col>
                      </Row>
                      {installDraft.mode === 'preset' ? (
                        <Space direction="vertical" size={8} className="app-block-space">
                          <Text strong>{t('dashboard.installTargetDir')}</Text>
                          <div className="install-path-preview">{installPreviewPath}</div>
                        </Space>
                      ) : (
                        <Space direction="vertical" size={8} className="app-block-space">
                          <Text strong>{t('dashboard.installTargetDir')}</Text>
                          <Space.Compact block>
                            <Input
                              value={installDraft.customInstallDir}
                              onChange={(event) => {
                                const directory = event.target.value;
                                setInstallDraftDirty(true);
                                setInstallDraft((current) => ({ ...current, customInstallDir: directory, selectedInstallDir: directory }));
                              }}
                            />
                            <Button className="install-browse-button" onClick={chooseInstallDirectory}>{t('dashboard.browseDirectory')}</Button>
                          </Space.Compact>
                          <Text type="secondary">{t('dashboard.installCustomHint')}</Text>
                        </Space>
                      )}
                      <Space wrap className="responsive-action-bar">
                        <Button loading={installing} type="primary" icon={<DeploymentUnitOutlined />} onClick={confirmInstallIntegration}>
                          {t('dashboard.installReinstall')}
                        </Button>
                      </Space>
                    </Space>
                  </Card>
                </Col>
              </Row>
              <Collapse
                className="dashboard-maintenance-collapse"
                items={[{
                  key: 'updates',
                  label: <Text strong>{t('dashboard.updatesTitle')}</Text>,
                  extra: <Tag>{updateStatusLabel}</Tag>,
                  children: (
                    <Space direction="vertical" size={16} className="app-block-space">
                  <Descriptions column={1}>
                    <Descriptions.Item label={t('dashboard.currentVersion')}><HoverText value={updateCenter.currentVersion} /></Descriptions.Item>
                    <Descriptions.Item label={t('dashboard.packagingMode')}><HoverText value={packagingModeLabel} /></Descriptions.Item>
                    <Descriptions.Item label={t('dashboard.updateState')}><HoverText value={updateStatusLabel} /></Descriptions.Item>
                    <Descriptions.Item label={t('dashboard.latestVersion')}><HoverText value={latestVersionDisplay} /></Descriptions.Item>
                    <Descriptions.Item label={t('dashboard.updatePublishedAt')}><HoverText value={formatLocalTimestamp(updateCenter.publishedAt)} /></Descriptions.Item>
                    {updateCenter.packagingMode === 'portable' ? (
                      <Descriptions.Item label={t('dashboard.updateDownloadPage')}><HoverText value={portableDownloadPage} /></Descriptions.Item>
                    ) : (
                      <>
                        <Descriptions.Item label={t('dashboard.updatePreparedDirectory')}><HoverText value={updateCenter.preparedDirectory} /></Descriptions.Item>
                        <Descriptions.Item label={t('dashboard.updateDownloadedArtifact')}><HoverText value={updateCenter.downloadedArtifactPath} /></Descriptions.Item>
                      </>
                    )}
                    <Descriptions.Item label={t('dashboard.updateLastError')}><HoverText value={updateErrorDisplay} /></Descriptions.Item>
                  </Descriptions>
                  <Alert
                    type="info"
                    showIcon
                    message={t(updateCenter.packagingMode === 'installed'
                      ? 'dashboard.updateInstalledHint'
                      : 'dashboard.updatePortableHint')}
                    description={t('dashboard.updatePluginHint')}
                  />
                  <Space wrap>
                    <Button icon={<ReloadOutlined />} loading={checkingUpdates} onClick={() => void checkForUpdates(true)}>
                      {t('dashboard.checkForUpdates')}
                    </Button>
                    {updateCenter.packagingMode === 'portable' && hasAvailableUpdate ? (
                      <Button type="primary" loading={updateActionLoading} onClick={() => void openPortableDownloadPage(portableDownloadPage)}>
                        {t('dashboard.openPortableDownloadPage')}
                      </Button>
                    ) : null}
                    {updateCenter.packagingMode === 'installed' && hasAvailableUpdate ? (
                      <Button type="primary" loading={updateActionLoading} onClick={() => void downloadInstallerUpdate(updateCenter)}>
                        {t('dashboard.downloadAndInstallUpdate')}
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
                    {updateCenter.releaseNotesUrl ? (
                      <Button loading={updateActionLoading} onClick={() => void openUpdateReleaseNotes(updateCenter)}>
                        {t('dashboard.viewReleaseNotes')}
                      </Button>
                    ) : null}
                  </Space>
                    </Space>
                  )
                }]}
              />
              <Card className="page-card" title={t('dashboard.notices')}>
                {visibleDashboardNotices.length ? (
                  <List size="small" dataSource={visibleDashboardNotices} renderItem={(item) => <List.Item>{item}</List.Item>} />
                ) : (
                  <Empty description={t('dashboard.noNotices')} />
                )}
              </Card>
            </Space>
  );
}
