import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Drawer,
  Empty,
  List,
  Space,
  Spin,
  Table,
  Tag,
  Typography
} from 'antd';
import HoverText from '../../components/HoverText.jsx';
import { TABLE_COLUMN_WIDTHS, TABLE_SCROLL_X } from '../../tableLayout.mjs';
import { formatLocalTimestamp } from '../../timeFormatting.mjs';
import {
  buildHistoryPromptItems,
  getHistoryContextSources,
  getHistoryRenderedSystemPrompt,
  getHistoryRenderedUserPrompt,
  shouldShowHistoryActualSentContent
} from '../../appShell.mjs';
import HistoryIssueTags from './HistoryIssueTags.jsx';
import {
  buildHistoryAttemptRows,
  buildHistoryDiagnosticSummary,
  buildHistorySegments,
  formatHistoryThroughputValue,
  formatInsightLatency
} from './historyPresentation.mjs';

const { Text } = Typography;
const HISTORY_DETAIL_DRAWER_WIDTH = 'min(920px, calc(100vw - 32px))';

export default function HistoryDetailDrawer({
  currentHistoryListItem,
  currentHistoryRecord,
  detailError,
  detailLoading,
  historyFilters,
  onClose,
  onDeleteCurrent,
  selectedHistoryId,
  t
}) {
  const historySegments = currentHistoryRecord ? buildHistorySegments(currentHistoryRecord) : [];

  return (
    <Drawer
      title={t('history.details')}
      extra={currentHistoryListItem ? <Button danger onClick={onDeleteCurrent}>{t('common.delete')}</Button> : null}
      open={Boolean(selectedHistoryId)}
      onClose={onClose}
      width={HISTORY_DETAIL_DRAWER_WIDTH}
      destroyOnClose
    >
      {detailLoading ? (
        <div className="app-loading-region">
          <Spin />
        </div>
      ) : detailError ? (
        <Alert type="error" showIcon message={detailError} />
      ) : currentHistoryRecord ? (
        <Space direction="vertical" size={16} className="app-block-space">
          <Card size="small" title={t('history.diagnosticSummary')} className="history-diagnostic-card">
            {(() => {
              const diagnosticSummary = buildHistoryDiagnosticSummary(currentHistoryRecord);
              return (
                <Space direction="vertical" size={12} className="app-block-space">
                  <HistoryIssueTags t={t} record={currentHistoryRecord} activeIssue={historyFilters.issue} />
                  <Descriptions bordered column={1} size="small">
                    <Descriptions.Item label={t('history.diagnosticIssueCount')}>
                      {diagnosticSummary.issueCount}
                    </Descriptions.Item>
                    <Descriptions.Item label={t('history.diagnosticTotalLatency')}>
                      {formatInsightLatency(diagnosticSummary.totalLatencyMs)}
                    </Descriptions.Item>
                    <Descriptions.Item label={t('history.diagnosticAttemptCount')}>
                      {diagnosticSummary.attemptCount}
                    </Descriptions.Item>
                    <Descriptions.Item label={t('history.diagnosticFallback')}>
                      {diagnosticSummary.fallbackActive ? t('common.enabled') : t('common.disabled')}
                    </Descriptions.Item>
                    <Descriptions.Item label={t('history.diagnosticFallbackReasons')}>
                      <HoverText value={diagnosticSummary.fallbackReasons.join(', ') || t('history.none')} />
                    </Descriptions.Item>
                    <Descriptions.Item label={t('history.diagnosticPrimaryError')}>
                      <HoverText value={diagnosticSummary.primaryError || t('history.none')} />
                    </Descriptions.Item>
                  </Descriptions>
                </Space>
              );
            })()}
          </Card>
          <Collapse
            className="history-detail-disclosure"
            items={[{
              key: 'technical-details',
              label: t('history.technicalDetails'),
              children: (
                <Space direction="vertical" size={16} className="app-block-space">
                  <Card size="small" title={t('history.attemptTimeline')}>
                    <Table
                      size="small"
                      pagination={false}
                      scroll={{ x: TABLE_SCROLL_X }}
                      rowKey="key"
                      dataSource={buildHistoryAttemptRows(currentHistoryRecord)}
                      locale={{ emptyText: t('history.noAttempts') }}
                      columns={[
                        { title: '#', dataIndex: 'index', width: TABLE_COLUMN_WIDTHS.rowNumber },
                        {
                          title: t('history.attemptRoute'),
                          width: TABLE_COLUMN_WIDTHS.entityName,
                          render: (_, record) => (
                            <Space direction="vertical" size={0}>
                              <Text>{record.route || t('history.unknown')}</Text>
                              <Text type="secondary">{record.provider || t('history.unknown')}</Text>
                            </Space>
                          )
                        },
                        {
                          title: t('history.model'),
                          dataIndex: 'model',
                          width: TABLE_COLUMN_WIDTHS.entityName,
                          render: (value) => <HoverText value={value || t('history.unknown')} className="table-cell-ellipsis" />
                        },
                        {
                          title: t('history.attemptMode'),
                          dataIndex: 'mode',
                          width: TABLE_COLUMN_WIDTHS.status,
                          render: (value, record) => (
                            <Space wrap size={[4, 4]}>
                              <Tag>{value || t('history.unknown')}</Tag>
                              {record.batchSize ? <Tag>{t('history.attemptBatchSize', { count: record.batchSize })}</Tag> : null}
                            </Space>
                          )
                        },
                        {
                          title: t('history.status'),
                          dataIndex: 'success',
                          width: TABLE_COLUMN_WIDTHS.status,
                          render: (value) => (
                            <Tag className="history-attempt-status-tag" color={value ? 'green' : 'red'}>
                              {value ? t('history.statusSuccess') : t('history.statusFailed')}
                            </Tag>
                          )
                        },
                        {
                          title: t('history.attemptLatency'),
                          dataIndex: 'latencyMs',
                          width: TABLE_COLUMN_WIDTHS.numericMetric,
                          render: (value) => formatInsightLatency(value)
                        },
                        {
                          title: t('history.attemptCache'),
                          dataIndex: 'cacheKind',
                          width: TABLE_COLUMN_WIDTHS.status,
                          render: (value) => value ? <Tag color="green">{value}</Tag> : <Text type="secondary">-</Text>
                        },
                        {
                          title: t('history.attemptError'),
                          dataIndex: 'error',
                          width: TABLE_COLUMN_WIDTHS.diagnostic,
                          render: (value) => <HoverText value={value || '-'} className="table-cell-ellipsis" />
                        },
                        {
                          title: t('history.attemptFallbackStage'),
                          dataIndex: 'fallbackStage',
                          width: TABLE_COLUMN_WIDTHS.fallbackStage,
                          render: (value) => value ? <Tag color="blue">{value}</Tag> : <Text type="secondary">-</Text>
                        }
                      ]}
                    />
                  </Card>
                  <Descriptions bordered column={1} size="small">
                    <Descriptions.Item label={t('history.submittedId')}><HoverText value={currentHistoryRecord.requestId} /></Descriptions.Item>
                    <Descriptions.Item label={t('history.projectId')}><HoverText value={currentHistoryRecord.projectId} /></Descriptions.Item>
                    <Descriptions.Item label={t('history.client')}><HoverText value={currentHistoryRecord.client || currentHistoryRecord.metadata?.client} /></Descriptions.Item>
                    <Descriptions.Item label={t('history.domain')}><HoverText value={currentHistoryRecord.domain || currentHistoryRecord.metadata?.domain} /></Descriptions.Item>
                    <Descriptions.Item label={t('history.subject')}><HoverText value={currentHistoryRecord.subject} /></Descriptions.Item>
                    <Descriptions.Item label={t('history.documentId')}><HoverText value={currentHistoryRecord.documentId || currentHistoryRecord.metadata?.documentId} /></Descriptions.Item>
                    <Descriptions.Item label={t('history.projectGuid')}><HoverText value={currentHistoryRecord.projectGuid || currentHistoryRecord.metadata?.projectGuid} /></Descriptions.Item>
                    <Descriptions.Item label={t('history.model')}><HoverText value={currentHistoryRecord.model} /></Descriptions.Item>
                    <Descriptions.Item label={t('common.provider')}><HoverText value={currentHistoryRecord.providerName} /></Descriptions.Item>
                    <Descriptions.Item label={t('history.submittedAt')}><HoverText value={formatLocalTimestamp(currentHistoryRecord.submittedAt)} /></Descriptions.Item>
                    <Descriptions.Item label={t('history.completedAt')}><HoverText value={formatLocalTimestamp(currentHistoryRecord.completedAt)} /></Descriptions.Item>
                    <Descriptions.Item label={t('history.segmentCount')}><HoverText value={currentHistoryRecord.segmentCount ?? historySegments.length} /></Descriptions.Item>
                    <Descriptions.Item label={t('history.segmentSummary')}><HoverText value={currentHistoryRecord.segmentSummary} /></Descriptions.Item>
                    <Descriptions.Item label={t('history.throughputSummary')}><HoverText value={formatHistoryThroughputValue(currentHistoryRecord, t)} /></Descriptions.Item>
                  </Descriptions>
                  <Card size="small" title={t('history.promptViewTitle')}>
                    <Space direction="vertical" size={12} className="app-block-space">
                      <div>
                        <Text strong>{t('history.renderedSystemPrompt')}</Text>
                        <pre className="history-json">
                          {String(getHistoryRenderedSystemPrompt(currentHistoryRecord) || t('history.promptUnavailable'))}
                        </pre>
                      </div>
                      <div>
                        <Text strong>{t('history.renderedUserPrompt')}</Text>
                        <pre className="history-json">
                          {String(getHistoryRenderedUserPrompt(currentHistoryRecord, t('history.perSegmentPromptInstructions')) || t('history.promptUnavailable'))}
                        </pre>
                      </div>
                    </Space>
                  </Card>
                  <Card size="small" title={t('history.contextSourcesTitle')}>
                    <Descriptions bordered column={1} size="small">
                      <Descriptions.Item label={t('history.contextSourceTranslationStyle')}><HoverText value={getHistoryContextSources(currentHistoryRecord).translationStyle} /></Descriptions.Item>
                      <Descriptions.Item label={t('history.contextSourceDocumentSummary')}><HoverText value={getHistoryContextSources(currentHistoryRecord).documentSummary} /></Descriptions.Item>
                      <Descriptions.Item label={t('history.contextSourceTerminology')}><HoverText value={getHistoryContextSources(currentHistoryRecord).terminology} /></Descriptions.Item>
                      <Descriptions.Item label={t('history.contextSourceTmHints')}><HoverText value={getHistoryContextSources(currentHistoryRecord).tmHints} /></Descriptions.Item>
                      <Descriptions.Item label={t('history.contextSourceCustomTmMatches')}><HoverText value={getHistoryContextSources(currentHistoryRecord).customTmMatches} /></Descriptions.Item>
                      <Descriptions.Item label={t('history.contextSourceTmDiagnostics')}><HoverText value={getHistoryContextSources(currentHistoryRecord).tmDiagnostics} /></Descriptions.Item>
                      <Descriptions.Item label={t('history.contextSourceProjectMetadata')}><HoverText value={getHistoryContextSources(currentHistoryRecord).projectMetadata} /></Descriptions.Item>
                      <Descriptions.Item label={t('history.contextSourcePreviewContext')}><HoverText value={getHistoryContextSources(currentHistoryRecord).previewContext} /></Descriptions.Item>
                    </Descriptions>
                  </Card>
                  {shouldShowHistoryActualSentContent(currentHistoryRecord, historySegments) ? (
                    <Card size="small" title={t('history.actualSentContent')}>
                      <List
                        size="small"
                        dataSource={buildHistoryPromptItems(currentHistoryRecord, historySegments)}
                        renderItem={(item) => (
                          <List.Item>
                            <Space direction="vertical" size={6} className="app-full-width">
                              <Text strong>{t('history.batchItemLabel', { index: item.segmentIndex })}</Text>
                              <div>
                                <Text strong>{t('history.sentSourceText')}</Text>
                                <pre className="history-json">{item.sourceText || '-'}</pre>
                              </div>
                              <div>
                                <Text strong>{t('history.sentPromptInstructions')}</Text>
                                <pre className="history-json">{item.promptInstructions || t('history.promptUnavailable')}</pre>
                              </div>
                            </Space>
                          </List.Item>
                        )}
                      />
                    </Card>
                  ) : null}
                  <Card size="small" title={t('history.segments')}>
                    <List
                      size="small"
                      dataSource={historySegments}
                      renderItem={(segment) => (
                        <List.Item>
                          <Space direction="vertical" size={6} className="app-full-width">
                            <Text strong>{t('history.batchItemLabel', { index: segment.segmentIndex })}</Text>
                            <Text>{`${t('history.source')}: ${segment.source || '-'}`}</Text>
                            <Text>{`${t('history.target')}: ${segment.target || '-'}`}</Text>
                            {(segment.tmSource || segment.tmTarget) ? (
                              <Text type="secondary">{`${t('history.tmSource')}: ${segment.tmSource || '-'} | ${t('history.tmTarget')}: ${segment.tmTarget || '-'}`}</Text>
                            ) : null}
                            {segment.customTmMatches?.length ? (
                              <Text type="secondary">
                                {`${t('history.customTmMatches')}: ${segment.customTmMatches.map((match) => `${match.score || 0}% ${match.bucket || ''} ${match.assetName || ''}`.trim()).join(' | ')}`}
                              </Text>
                            ) : null}
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Card>
                </Space>
              )
            }]}
          />
        </Space>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('history.noSelection')} />
      )}
    </Drawer>
  );
}
