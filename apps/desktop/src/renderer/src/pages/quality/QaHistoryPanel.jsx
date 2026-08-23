import { useEffect, useMemo, useState } from 'react';
import {
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography
} from 'antd';
import { useI18n } from '../../i18n';
import QualityExecutionSummary from './QualityExecutionSummary.jsx';
import QaFindingReview from './QaFindingReview.jsx';
import { disableQaRule } from './qaFindingReview.mjs';
import { useLatestCallback } from '../../hooks/useAppLifecycle.mjs';

const { Paragraph, Text } = Typography;
const AUTOMATIC_TRIGGER = 'preview-target-changed';
const SEVERITY_COLOR = { critical: 'error', major: 'warning', minor: 'gold', info: 'blue' };

function formatTimestamp(value) {
  if (!value) return '-';
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
}

function SeverityCounts({ counts = {} }) {
  return (
    <Space size={[4, 4]} wrap>
      {['critical', 'major', 'minor', 'info'].map((severity) => (
        <Tag key={severity} color={SEVERITY_COLOR[severity]}>{severity}: {counts[severity] || 0}</Tag>
      ))}
    </Space>
  );
}

function triggerLabel(trigger, t) {
  return t(`quality.history.trigger.${trigger || 'manual'}`);
}

export default function QaHistoryPanel({ api, profiles = [], onProfileSaved, refreshKey = 0 }) {
  const { t } = useI18n();
  const { message, modal } = AntdApp.useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [documentId, setDocumentId] = useState('');
  const [trigger, setTrigger] = useState('');
  const [dateRange, setDateRange] = useState(null);
  const [showAutomatic, setShowAutomatic] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function loadHistory() {
    setLoading(true);
    setError('');
    try {
      const response = await api?.getQaHistory?.({
        dateFrom: dateRange?.[0]?.startOf('day').toISOString() || '',
        dateTo: dateRange?.[1]?.endOf('day').toISOString() || '',
        limit: 200
      });
      setItems(Array.isArray(response?.items) ? response.items : []);
      setSelectedIds([]);
    } catch (loadError) {
      setError(String(loadError?.message || t('quality.history.loadFailed')));
    } finally {
      setLoading(false);
    }
  }

  const runLoadHistory = useLatestCallback(loadHistory);
  const dateFromTimestamp = dateRange?.[0]?.valueOf() ?? null;
  const dateToTimestamp = dateRange?.[1]?.valueOf() ?? null;

  useEffect(() => {
    void runLoadHistory();
  }, [dateFromTimestamp, dateToTimestamp, refreshKey, runLoadHistory]);

  const documentOptions = useMemo(() => {
    const values = new Map();
    items.forEach((item) => {
      const id = String(item.documentId || '');
      if (id) values.set(id, item.documentName || id);
    });
    return [...values.entries()].map(([value, label]) => ({ value, label }));
  }, [items]);

  const visibleItems = useMemo(() => items.filter((item) => (
    (showAutomatic || item.trigger !== AUTOMATIC_TRIGGER)
    && (!documentId || item.documentId === documentId)
    && (!trigger || item.trigger === trigger)
  )), [items, showAutomatic, documentId, trigger]);

  const statistics = useMemo(() => {
    const findingCount = visibleItems.reduce((total, item) => total + Number(item.findingCounts?.total || 0), 0);
    const aiCount = visibleItems.filter((item) => item.execution?.aiStatus && !['disabled', 'not-requested'].includes(item.execution.aiStatus)).length;
    return {
      checks: visibleItems.length,
      findings: findingCount,
      aiRate: visibleItems.length ? Math.round((aiCount / visibleItems.length) * 100) : 0
    };
  }, [visibleItems]);

  async function openDetail(requestId) {
    setDetailLoading(true);
    try {
      const response = await api.getQaHistoryEntry(requestId);
      if (!response?.result) {
        message.warning(t('quality.history.detailNotFound'));
        return;
      }
      setDetail(response);
    } catch (detailError) {
      message.error(String(detailError?.message || t('quality.history.detailLoadFailed')));
    } finally {
      setDetailLoading(false);
    }
  }

  function confirmDelete() {
    if (!selectedIds.length) return;
    modal.confirm({
      title: t('quality.history.deleteTitle'),
      content: t('quality.history.deleteDescription', { count: selectedIds.length }),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      async onOk() {
        const response = await api.deleteQaHistory(selectedIds);
        message.success(t('quality.history.deleteSuccess', { count: response?.deletedCount || selectedIds.length }));
        await loadHistory();
      }
    });
  }

  async function exportHistory(format) {
    try {
      const response = await api.exportQaHistory({
        format,
        scope: selectedIds.length ? 'selected' : 'filtered',
        selectedIds,
        filters: {
          documentId,
          trigger,
          dateFrom: dateRange?.[0]?.startOf('day').toISOString() || '',
          dateTo: dateRange?.[1]?.endOf('day').toISOString() || ''
        }
      });
      message.success(t('quality.history.exportSuccess', { path: response?.path || '' }));
    } catch (exportError) {
      message.error(String(exportError?.message || t('quality.history.exportFailed')));
    }
  }

  async function disableFindingRule(finding) {
    const result = await disableQaRule({
      api,
      profileId: detail?.result?.configuration?.profileId || '',
      ruleId: finding.ruleId
    });
    if (result.profile?.id) onProfileSaved?.(result.profile);
    return result;
  }

  function canDisableFindingRule(finding) {
    const profileId = detail?.result?.configuration?.profileId || '';
    const profile = profiles.find((item) => item.id === profileId);
    return Boolean(profile?.qaRules?.some((rule) => rule.id === finding.ruleId));
  }

  const columns = [
    { title: t('quality.history.checkedAt'), dataIndex: 'updatedAt', width: 180, render: formatTimestamp },
    { title: t('quality.history.document'), key: 'document', width: 180, ellipsis: true, render: (_, item) => item.documentName || item.documentId || '-' },
    { title: t('quality.history.source'), dataIndex: 'trigger', width: 150, render: (value) => <Tag>{triggerLabel(value, t)}</Tag> },
    {
      title: t('quality.history.segment'), key: 'segment', ellipsis: true,
      render: (_, item) => <Space direction="vertical" size={0}><Text ellipsis>{item.segment?.source || '-'}</Text><Text type="secondary" ellipsis>{item.segment?.target || '-'}</Text></Space>
    },
    { title: t('quality.history.findings'), dataIndex: 'findingCounts', width: 260, render: (counts) => <SeverityCounts counts={counts} /> },
    { title: t('quality.history.status'), dataIndex: 'status', width: 110, render: (value) => <Tag color={value === 'complete' ? 'success' : 'warning'}>{value}</Tag> },
    { title: t('common.actions'), key: 'actions', width: 90, render: (_, item) => <Button type="link" icon={<EyeOutlined />} loading={detailLoading} onClick={() => openDetail(item.requestId)}>{t('common.review')}</Button> }
  ];

  const detailResult = detail?.result;

  return (
    <Space direction="vertical" size="large" className="quality-page">
      {error ? <Alert type="error" showIcon message={error} action={<Button size="small" onClick={loadHistory}>{t('common.retry')}</Button>} /> : null}
      <Card>
        <Space direction="vertical" size="middle" className="quality-controls">
          <Space wrap>
            <Select allowClear value={documentId || undefined} onChange={(value) => setDocumentId(value || '')} placeholder={t('quality.history.allDocuments')} options={documentOptions} className="quality-select" />
            <Select allowClear value={trigger || undefined} onChange={(value) => setTrigger(value || '')} placeholder={t('quality.history.allSources')} options={['manual', 'batch', 'import', AUTOMATIC_TRIGGER].map((value) => ({ value, label: triggerLabel(value, t) }))} className="quality-select" />
            <DatePicker.RangePicker value={dateRange} onChange={setDateRange} />
          </Space>
          <Space wrap>
            <label className="quality-switch-row"><Switch checked={showAutomatic} onChange={setShowAutomatic} /><Text>{t('quality.history.showAutomatic')}</Text></label>
            <Button icon={<ReloadOutlined />} onClick={loadHistory}>{t('app.refresh')}</Button>
            <Button danger disabled={!selectedIds.length} icon={<DeleteOutlined />} onClick={confirmDelete}>{t('quality.history.deleteSelected')}</Button>
            <Dropdown menu={{ items: [{ key: 'csv', label: 'CSV' }, { key: 'xlsx', label: 'XLSX' }], onClick: ({ key }) => exportHistory(key) }}>
              <Button icon={<DownloadOutlined />}>{t('common.export')}</Button>
            </Dropdown>
          </Space>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}><Card size="small"><Statistic title={t('quality.history.checkCount')} value={statistics.checks} /></Card></Col>
        <Col xs={24} sm={8}><Card size="small"><Statistic title={t('quality.history.findingCount')} value={statistics.findings} /></Card></Col>
        <Col xs={24} sm={8}><Card size="small"><Statistic title={t('quality.history.aiParticipation')} value={statistics.aiRate} suffix="%" /></Card></Col>
      </Row>

      <Table
        rowKey="requestId"
        loading={loading}
        dataSource={visibleItems}
        columns={columns}
        rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds }}
        pagination={{ pageSize: 25, showSizeChanger: true }}
        locale={{ emptyText: <Empty description={t('quality.history.empty')} /> }}
        scroll={{ x: 1180 }}
      />

      <Drawer
        title={t('quality.history.detailTitle')}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        width="min(760px, calc(100vw - 32px))"
        destroyOnHidden
      >
        {detailResult ? (
          <Space direction="vertical" size="large" className="quality-page">
            <Descriptions bordered size="small" column={1} items={[
              { key: 'time', label: t('quality.history.checkedAt'), children: formatTimestamp(detail.item?.updatedAt || detailResult.updatedAt || detailResult.createdAt) },
              { key: 'document', label: t('quality.history.document'), children: detailResult.document?.name || detailResult.document?.id || '-' },
              { key: 'source', label: t('quality.sourceEvidence'), children: detailResult.segment?.source || '-' },
              { key: 'target', label: t('quality.targetEvidence'), children: detailResult.segment?.target || '-' }
            ]} />
            <QualityExecutionSummary execution={detailResult.execution} />
            {(detailResult.findings || []).length ? <QaFindingReview
              embedded
              findings={detailResult.findings || []}
              requestId={detailResult.requestId}
              profileId={detailResult?.configuration?.profileId || ''}
              feedbackEntries={detail?.feedback || []}
              onCopy={(value) => api.copyText(value)}
              onSaveFeedback={(payload) => api.saveQaFeedback(payload)}
              onDisableRule={disableFindingRule}
              canDisableRule={canDisableFindingRule}
            /> : <Empty description={t('quality.checkCompleteNoFindings')} />}
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
