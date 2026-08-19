import { Alert, Button, Card, Col, Collapse, DatePicker, Empty, Form, Input, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import HoverText from '../../components/HoverText.jsx';
import { TABLE_COLUMN_WIDTHS, TABLE_SCROLL_X } from '../../tableLayout.mjs';
import { formatLocalTimestamp } from '../../timeFormatting.mjs';
import HistoryDetailDrawer from './HistoryDetailDrawer.jsx';
import HistoryIssueTags from './HistoryIssueTags.jsx';
import {
  formatInsightLatency,
  getHistoryInsightFocusMessage,
  getHistoryIssueLabel,
  HISTORY_ISSUE_OPTIONS
} from './historyPresentation.mjs';

const { Text } = Typography;

export default function HistoryPage({
  activeHistoryFilterTags,
  applyHistoryFilters,
  confirmDeleteCurrentHistoryEntry,
  confirmDeleteSelectedHistoryEntries,
  confirmHistoryDeletion,
  currentHistoryListItem,
  currentHistoryRecord,
  deletingHistory,
  exportHistory,
  exportingHistoryFormat,
  historyDetailError,
  historyDetailLoading,
  historyFilterDraft,
  historyFilterModelOptions,
  historyFilterProviderOptions,
  historyFilters,
  historyInsightFocus,
  historyInsights,
  historyRefreshing,
  onCloseHistoryDetail,
  refreshHistory,
  resetHistoryFilters,
  selectedHistoryIds,
  selectedHistoryId,
  setHistoryInsightFocus,
  setSelectedHistoryId,
  setSelectedHistoryIds,
  t,
  updateHistoryFilterDraftField,
  visibleHistoryItems
}) {
  return (
    <>
      <Space direction="vertical" size={16} className="app-block-space">
              <Card
                className="page-card"
                title={t('history.title')}
                extra={(
                  <Space wrap>
                    <Button danger loading={deletingHistory} disabled={!selectedHistoryIds.length} onClick={confirmDeleteSelectedHistoryEntries}>
                      {t('history.deleteSelected')}
                    </Button>
                    <Button
                      loading={exportingHistoryFormat === 'csv'}
                      disabled={!selectedHistoryIds.length || Boolean(exportingHistoryFormat)}
                      onClick={() => exportHistory('csv', 'selected')}
                    >
                      {t('history.exportSelectedCsv')}
                    </Button>
                    <Button
                      loading={exportingHistoryFormat === 'xlsx'}
                      disabled={Boolean(exportingHistoryFormat)}
                      onClick={() => exportHistory('xlsx', 'filtered')}
                    >
                      {t('history.exportFilteredXlsx')}
                    </Button>
                  </Space>
                )}
              >
                <Space direction="vertical" size={16} className="app-block-space history-filter-stack">
                  <div className="history-insights-panel">
                    <div className="history-insights-header">
                      <div>
                        <Text strong>{t('history.insights.title')}</Text>
                        <div><Text type="secondary">{t('history.insights.subtitle')}</Text></div>
                      </div>
                      <Tag color="blue">{t('history.insights.scope', { count: historyInsights.totalRequests || 0 })}</Tag>
                    </div>
                    {activeHistoryFilterTags.length ? (
                      <Space wrap size={[8, 8]} className="history-active-filter-bar">
                        {activeHistoryFilterTags.map((item) => (
                          <Tag key={item.field} color="blue">{item.label}</Tag>
                        ))}
                        <Button size="small" type="link" onClick={resetHistoryFilters}>
                          {t('history.clearInsightFilters')}
                        </Button>
                      </Space>
                    ) : null}
                    {historyInsightFocus ? (
                      <Alert
                        className="history-insight-focus-alert"
                        type="info"
                        showIcon
                        message={t('history.insights.focusTitle')}
                        description={t('history.insights.focusDescription', {
                          source: getHistoryInsightFocusMessage(t, historyInsightFocus),
                          count: historyInsights.totalRequests || 0
                        })}
                        action={(
                          <Button size="small" onClick={() => setHistoryInsightFocus(null)}>
                            {t('common.dismiss')}
                          </Button>
                        )}
                      />
                    ) : null}
                    {(historyInsights.totalRequests || 0) > 0 ? (
                      <Space direction="vertical" size={14} className="app-block-space">
                        <Row gutter={[16, 16]}>
                          <Col xs={24} md={8}>
                            <div className="history-insight-stat">
                              <Statistic title={t('history.insights.avgLatency')} value={formatInsightLatency(historyInsights.avgLatencyMs)} />
                              <Text type="secondary">{t('history.insights.scope', { count: historyInsights.totalRequests || 0 })}</Text>
                            </div>
                          </Col>
                          <Col xs={24} md={8}>
                            <div className="history-insight-stat">
                              <Statistic title={t('history.insights.slowRequests')} value={historyInsights.slowRequestCount || 0} />
                              <Text type="secondary">{t('history.issueTag.slow')}</Text>
                            </div>
                          </Col>
                          <Col xs={24} md={8}>
                            <div className="history-insight-stat">
                              <Statistic title={t('history.insights.failedRequestsTitle')} value={historyInsights.failedCount || 0} />
                              <Text type="secondary">{t('history.statusFailed')}</Text>
                            </div>
                          </Col>
                        </Row>
                      </Space>
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('history.insights.empty')} />
                    )}
                  </div>
                  <Form layout="vertical" component={false}>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} lg={12}>
                      <Form.Item label={t('history.search')}>
                        <Input.Search
                          allowClear
                          value={historyFilterDraft.search}
                          onChange={(event) => updateHistoryFilterDraftField('search', event.target.value)}
                          onSearch={applyHistoryFilters}
                          placeholder={t('history.searchPlaceholder')}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                      <Form.Item label={t('history.providerFilter')}>
                        <Select
                          allowClear
                          showSearch
                          value={historyFilterDraft.provider || undefined}
                          options={historyFilterProviderOptions}
                          onChange={(value) => updateHistoryFilterDraftField('provider', value || '')}
                          placeholder={t('history.providerPlaceholder')}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12} lg={6}>
                      <Form.Item label={t('history.modelFilter')}>
                        <Select
                          allowClear
                          showSearch
                          value={historyFilterDraft.model || undefined}
                          options={historyFilterModelOptions}
                          onChange={(value) => updateHistoryFilterDraftField('model', value || '')}
                          placeholder={t('history.modelPlaceholder')}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Collapse
                    className="history-advanced-filters"
                    items={[{
                      key: 'advanced',
                      label: t('history.advancedFilters'),
                      children: (
                  <Row gutter={[16, 16]}>
                    <Col xs={24} sm={12} lg={8} xl={4}>
                      <Form.Item label={t('history.projectIdFilter')}>
                        <Input
                          allowClear
                          value={historyFilterDraft.projectId}
                          onChange={(event) => updateHistoryFilterDraftField('projectId', event.target.value)}
                          placeholder={t('history.projectIdPlaceholder')}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12} lg={8} xl={4}>
                      <Form.Item label={t('history.subjectFilter')}>
                        <Input
                          allowClear
                          value={historyFilterDraft.subject}
                          onChange={(event) => updateHistoryFilterDraftField('subject', event.target.value)}
                          placeholder={t('history.subjectPlaceholder')}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12} lg={8} xl={4}>
                      <Form.Item label={t('history.statusFilter')}>
                        <Select
                          allowClear
                          value={historyFilterDraft.status || undefined}
                          options={[
                            { value: 'success', label: t('history.statusSuccess') },
                            { value: 'failed', label: t('history.statusFailed') }
                          ]}
                          onChange={(value) => updateHistoryFilterDraftField('status', value || '')}
                          placeholder={t('history.statusPlaceholder')}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12} lg={8} xl={4}>
                      <Form.Item label={t('history.issueFilter')}>
                        <Select
                          allowClear
                          value={historyFilterDraft.issue || undefined}
                          options={HISTORY_ISSUE_OPTIONS.map((issue) => ({
                            value: issue,
                            label: getHistoryIssueLabel(t, issue)
                          }))}
                          onChange={(value) => updateHistoryFilterDraftField('issue', value || '')}
                          placeholder={t('history.issuePlaceholder')}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12} lg={8} xl={4}>
                      <Form.Item label={t('history.dateFrom')}>
                        <DatePicker
                          allowClear
                          value={historyFilterDraft.dateFrom ? dayjs(historyFilterDraft.dateFrom) : null}
                          onChange={(_value, dateString) => updateHistoryFilterDraftField('dateFrom', dateString)}
                          format="YYYY-MM-DD"
                          className="history-date-picker"
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12} lg={8} xl={4}>
                      <Form.Item label={t('history.dateTo')}>
                        <DatePicker
                          allowClear
                          value={historyFilterDraft.dateTo ? dayjs(historyFilterDraft.dateTo) : null}
                          onChange={(_value, dateString) => updateHistoryFilterDraftField('dateTo', dateString)}
                          format="YYYY-MM-DD"
                          className="history-date-picker"
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                      )
                    }]}
                  />
                  </Form>
                  <Space wrap className="responsive-action-bar">
                    <Button type="primary" loading={historyRefreshing} onClick={applyHistoryFilters}>{t('history.applyFilters')}</Button>
                    <Button disabled={historyRefreshing} onClick={resetHistoryFilters}>{t('history.resetFilters')}</Button>
                    <Button disabled={historyRefreshing} onClick={refreshHistory}>{t('app.refresh')}</Button>
                  </Space>
                </Space>
                <Table
                  rowKey="id"
                  loading={historyRefreshing}
                  scroll={{ x: TABLE_SCROLL_X }}
                  rowSelection={{ selectedRowKeys: selectedHistoryIds, onChange: setSelectedHistoryIds }}
                  dataSource={visibleHistoryItems}
                  locale={{
                    emptyText: (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('history.insights.empty')}>
                        <Button
                          loading={historyRefreshing}
                          onClick={activeHistoryFilterTags.length ? resetHistoryFilters : refreshHistory}
                        >
                          {activeHistoryFilterTags.length ? t('history.resetFilters') : t('app.refresh')}
                        </Button>
                      </Empty>
                    )
                  }}
                  onRow={(record) => ({
                    className: 'history-interactive-row',
                    onClick: () => setSelectedHistoryId(record.id)
                  })}
                  columns={[
                    {
                      title: t('history.submittedId'),
                      dataIndex: 'requestId',
                      width: TABLE_COLUMN_WIDTHS.identifier,
                      render: (value) => <HoverText value={value} className="table-cell-ellipsis" />
                    },
                    {
                      title: t('common.provider'),
                      dataIndex: 'providerName',
                      width: TABLE_COLUMN_WIDTHS.entityName,
                      render: (value) => <HoverText value={value} className="table-cell-ellipsis" />
                    },
                    {
                      title: t('history.model'),
                      dataIndex: 'model',
                      width: TABLE_COLUMN_WIDTHS.entityName,
                      render: (value) => <HoverText value={value} className="table-cell-ellipsis" />
                    },
                    { title: t('history.segmentCount'), dataIndex: 'segmentCount', width: TABLE_COLUMN_WIDTHS.numericMetric },
                    {
                      title: t('history.status'),
                      dataIndex: 'status',
                      width: TABLE_COLUMN_WIDTHS.status,
                      render: (value) => <Tag color={value === 'success' ? 'green' : 'red'}>{value === 'success' ? t('history.statusSuccess') : t('history.statusFailed')}</Tag>
                    },
                    {
                      title: t('history.issues'),
                      width: TABLE_COLUMN_WIDTHS.diagnostic,
                      render: (_, record) => <HistoryIssueTags t={t} record={record} activeIssue={historyFilters.issue} maxVisible={3} />
                    },
                    {
                      title: t('history.submittedAt'),
                      dataIndex: 'submittedAt',
                      width: TABLE_COLUMN_WIDTHS.timestamp,
                      render: (value) => <HoverText value={formatLocalTimestamp(value)} className="table-cell-ellipsis" />
                    },
                    {
                      title: t('common.actions'),
                      width: TABLE_COLUMN_WIDTHS.inlineActions,
                      render: (_, record) => (
                        <Space size={0}>
                          <Button
                            type="link"
                            aria-label={t('history.openRecord', { id: record.requestId || record.id || '-' })}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedHistoryId(record.id);
                            }}
                          >
                            {t('common.review')}
                          </Button>
                        <Button
                          danger
                          type="link"
                          disabled={deletingHistory}
                          onClick={(event) => {
                            event.stopPropagation();
                            confirmHistoryDeletion({
                              entryIds: [record.id],
                              title: t('history.deleteEntry'),
                              content: t('history.confirmDeleteEntry', { id: record.requestId || record.id || '-' })
                            });
                          }}
                        >
                          {t('common.delete')}
                        </Button>
                        </Space>
                      )
                    }
                  ]}
                />
              </Card>
      </Space>
      <HistoryDetailDrawer
        currentHistoryListItem={currentHistoryListItem}
        currentHistoryRecord={currentHistoryRecord}
        detailError={historyDetailError}
        detailLoading={historyDetailLoading}
        historyFilters={historyFilters}
        onClose={onCloseHistoryDetail}
        onDeleteCurrent={confirmDeleteCurrentHistoryEntry}
        selectedHistoryId={selectedHistoryId}
        t={t}
      />
    </>
  );
}
