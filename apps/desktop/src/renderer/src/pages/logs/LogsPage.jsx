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
import { TABLE_COLUMN_WIDTHS } from '../../tableLayout.mjs';
import { flattenLogFiles, formatLogBytes } from './logPresentation.mjs';

const { Text } = Typography;
const TABLE_SCROLL_X = 'max-content';

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
    <Space direction="vertical" size={16} className="app-block-space">
      <Card
        className="page-card logs-summary-card"
        title={t('logs.title')}
        extra={(
          <Space wrap className="responsive-action-bar">
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
        <Space direction="vertical" size={16} className="app-block-space">
          <Alert type="info" showIcon message={t('logs.supportHint')} />
          <Descriptions column={1} className="wrap-descriptions">
            <Descriptions.Item label={t('logs.directory')}>
              <Text copyable className="long-value">{logState?.logsDir || '-'}</Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('logs.totalSize')}>
              {formatLogBytes(logState?.totalSizeBytes)}
            </Descriptions.Item>
            <Descriptions.Item label={t('logs.latestUpdatedAt')}>
              {logState?.latestUpdatedAt || '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('logs.policy')}>
              {t('logs.policyValue', {
                size: formatLogBytes(policy.maxFileBytes),
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
          scroll={{ x: TABLE_SCROLL_X }}
          dataSource={files}
          pagination={false}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('logs.noFiles')}>
                <Button icon={<ReloadOutlined />} loading={loading} onClick={onRefresh}>{t('logs.refresh')}</Button>
              </Empty>
            )
          }}
          columns={[
            {
              title: t('logs.source'),
              dataIndex: 'source',
              width: TABLE_COLUMN_WIDTHS.entityName,
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
              width: TABLE_COLUMN_WIDTHS.numericMetric,
              render: formatLogBytes
            },
            {
              title: t('logs.updatedAt'),
              dataIndex: 'updatedAt',
              width: TABLE_COLUMN_WIDTHS.timestamp
            },
            {
              title: t('common.actions'),
              width: TABLE_COLUMN_WIDTHS.singleAction,
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

export { formatLogBytes as formatBytes } from './logPresentation.mjs';
