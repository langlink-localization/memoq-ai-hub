import {
  ClearOutlined,
  CopyOutlined,
  FolderOpenOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Space,
  Table,
  Tag,
  Typography
} from 'antd';
import { useMemo } from 'react';
import { useI18n } from '../../i18n';

const { Text } = Typography;

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function flattenLogFiles(logState = {}) {
  return (logState.groups || []).flatMap((group) => (
    (group.files || []).map((file) => ({
      key: file.path || `${group.source}-${file.name}`,
      source: group.source,
      ...file
    }))
  ));
}

export default function LogsPage({
  logState,
  loading,
  pruning,
  onRefresh,
  onOpenLogsDir,
  onPruneLogs,
  onRevealFile,
  onCopyDiagnostics
}) {
  const { t } = useI18n();
  const files = useMemo(() => flattenLogFiles(logState || {}), [logState]);
  const policy = logState?.policy || {};

  return (
    <Space direction="vertical" size={18} style={{ display: 'flex' }}>
      <Card
        className="page-card logs-summary-card"
        title={t('logs.title')}
        extra={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={onRefresh}>
              {t('logs.refresh')}
            </Button>
            <Button icon={<FolderOpenOutlined />} onClick={onOpenLogsDir} disabled={!logState?.logsDir}>
              {t('logs.openFolder')}
            </Button>
            <Button icon={<CopyOutlined />} onClick={onCopyDiagnostics} disabled={!logState}>
              {t('logs.copyDiagnostics')}
            </Button>
            <Button icon={<ClearOutlined />} loading={pruning} onClick={onPruneLogs}>
              {t('logs.cleanNow')}
            </Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={16} style={{ display: 'flex' }}>
          <Alert type="info" showIcon message={t('logs.supportHint')} />
          <Descriptions column={1} className="wrap-descriptions">
            <Descriptions.Item label={t('logs.directory')}>
              <Text copyable className="long-value">{logState?.logsDir || '-'}</Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('logs.totalSize')}>
              {formatBytes(logState?.totalSizeBytes)}
            </Descriptions.Item>
            <Descriptions.Item label={t('logs.latestUpdatedAt')}>
              {logState?.latestUpdatedAt || '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('logs.policy')}>
              {t('logs.policyValue', {
                size: formatBytes(policy.maxFileBytes),
                files: policy.maxFiles || 0,
                days: policy.retentionDays || 0
              })}
            </Descriptions.Item>
          </Descriptions>
        </Space>
      </Card>

      <Card className="page-card" title={t('logs.filesTitle')}>
        <Table
          rowKey="key"
          loading={loading}
          dataSource={files}
          pagination={false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('logs.noFiles')} /> }}
          columns={[
            {
              title: t('logs.source'),
              dataIndex: 'source',
              width: 180,
              render: (value) => <Tag>{value}</Tag>
            },
            {
              title: t('logs.fileName'),
              dataIndex: 'name',
              render: (value, record) => (
                <Space wrap size={[8, 8]}>
                  <Text className="long-value">{value}</Text>
                  {record.isCurrent ? <Tag color="green">{t('logs.currentFile')}</Tag> : null}
                </Space>
              )
            },
            {
              title: t('logs.size'),
              dataIndex: 'sizeBytes',
              width: 120,
              render: formatBytes
            },
            {
              title: t('logs.updatedAt'),
              dataIndex: 'updatedAt',
              width: 220
            },
            {
              title: t('common.actions'),
              width: 140,
              render: (_, record) => (
                <Button type="link" onClick={() => onRevealFile?.(record.path)}>
                  {t('logs.revealFile')}
                </Button>
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}

export { formatBytes };
