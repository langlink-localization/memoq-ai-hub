import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyOutlined, EyeOutlined, MoreOutlined } from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Descriptions,
  Drawer,
  Dropdown,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd';
import { useI18n } from '../../i18n';
import { applyQaFindingFeedback, feedbackMapFromEntries, filterQaFindings } from './qaFindingReview.mjs';
import { useLatestCallback } from '../../hooks/useAppLifecycle.mjs';

const { Text } = Typography;
const SEVERITY_COLOR = { critical: 'error', major: 'warning', minor: 'gold', info: 'blue' };

function uniqueOptions(findings, field) {
  return [...new Set(findings.map((finding) => String(finding?.[field] || '').trim()).filter(Boolean))]
    .sort()
    .map((value) => ({ value, label: value }));
}

export default function QaFindingReview({
  findings = [],
  requestId = '',
  profileId = '',
  feedbackEntries = [],
  onCopy,
  onLoadFeedback,
  onSaveFeedback,
  onDisableRule,
  canDisableRule,
  compact = false,
  embedded = false
}) {
  const { t } = useI18n();
  const { message, modal } = AntdApp.useApp();
  const [filters, setFilters] = useState({ severity: '', category: '', origin: '', reviewState: '' });
  const [feedbackByFinding, setFeedbackByFinding] = useState(() => feedbackMapFromEntries(feedbackEntries));
  const [selectedFinding, setSelectedFinding] = useState(null);
  const [pendingFindingId, setPendingFindingId] = useState('');
  const [error, setError] = useState('');
  const feedbackSignature = JSON.stringify((feedbackEntries || []).map((entry) => [entry?.findingId, entry?.state]));
  const feedbackEntriesRef = useRef(feedbackEntries);
  feedbackEntriesRef.current = feedbackEntries;
  const canLoadFeedback = typeof onLoadFeedback === 'function';
  const loadFeedback = useLatestCallback(onLoadFeedback);
  const translate = useLatestCallback(t);

  useEffect(() => {
    setFeedbackByFinding(feedbackMapFromEntries(feedbackEntriesRef.current));
    setFilters({ severity: '', category: '', origin: '', reviewState: '' });
    setSelectedFinding(null);
    setError('');
    if (requestId && canLoadFeedback) {
      void loadFeedback(requestId)
        .then((response) => setFeedbackByFinding(feedbackMapFromEntries(response?.feedback || [])))
        .catch(() => setError(translate('quality.feedbackLoadFailed')));
    }
  }, [canLoadFeedback, feedbackSignature, loadFeedback, requestId, translate]);

  const visibleFindings = useMemo(
    () => filterQaFindings(findings, filters, feedbackByFinding),
    [findings, filters, feedbackByFinding]
  );
  const reviewedCount = Object.keys(feedbackByFinding).filter((findingId) => findings.some((finding) => finding.id === findingId)).length;
  const severityOptions = useMemo(() => uniqueOptions(findings, 'severity'), [findings]);
  const categoryOptions = useMemo(() => uniqueOptions(findings, 'category'), [findings]);
  const originOptions = useMemo(() => uniqueOptions(findings, 'origin'), [findings]);

  function feedbackLabel(state) {
    return state ? t(`quality.feedbackState.${state}`) : t('quality.feedbackState.unreviewed');
  }

  function errorMessage(action, actionError) {
    if (actionError?.code === 'QA_PROFILE_NOT_FOUND') return t('quality.profileMissing');
    if (actionError?.code === 'QA_RULE_NOT_FOUND' || actionError?.code === 'QA_RULE_UNAVAILABLE') return t('quality.ruleMissing');
    return action === 'rule-disabled' ? t('quality.ruleDisableFailed') : t('quality.feedbackSaveFailed');
  }

  async function applyFeedback(finding, state) {
    setPendingFindingId(finding.id);
    setError('');
    try {
      await applyQaFindingFeedback({
        finding,
        requestId,
        state,
        onDisableRule,
        onSaveFeedback
      });
      setFeedbackByFinding((current) => ({ ...current, [finding.id]: state }));
      message.success(state === 'rule-disabled' ? t('quality.ruleDisabled') : t('quality.feedbackSaved'));
    } catch (actionError) {
      setError(actionError?.ruleDisabled ? t('quality.ruleDisabledFeedbackFailed') : errorMessage(state, actionError));
      throw actionError;
    } finally {
      setPendingFindingId('');
    }
  }

  function chooseFeedback(finding, state) {
    if (state !== 'rule-disabled') {
      void applyFeedback(finding, state).catch(() => {});
      return;
    }
    modal.confirm({
      title: t('quality.disableRuleTitle'),
      content: t('quality.disableRuleDescription'),
      okText: t('quality.feedbackDisableRule'),
      okButtonProps: { danger: true },
      onOk: () => applyFeedback(finding, state)
    });
  }

  async function copySuggestion(finding) {
    setError('');
    try {
      await onCopy?.(finding.suggestedTranslation || finding.message || '');
      message.success(t('quality.suggestionCopied'));
    } catch {
      setError(t('quality.copyFailed'));
    }
  }

  const columns = [
    { title: t('quality.severity'), dataIndex: 'severity', width: 112, render: (value) => <Tag color={SEVERITY_COLOR[value] || 'default'}>{value}</Tag> },
    { title: t('quality.issue'), key: 'issue', ellipsis: true, render: (_, finding) => <Space direction="vertical" size={0}><Text>{finding.title || finding.message}</Text><Text type="secondary" ellipsis>{finding.message}</Text></Space> },
    { title: t('quality.category'), dataIndex: 'category', width: 140, render: (value) => <Tag>{value}</Tag> },
    { title: t('quality.reviewState'), key: 'feedback', width: 130, render: (_, finding) => <Tag>{feedbackLabel(feedbackByFinding[finding.id])}</Tag> },
    {
      title: t('common.actions'), key: 'actions', width: 132,
      render: (_, finding) => {
        const pending = pendingFindingId === finding.id;
        const allowRuleDisable = Boolean(finding.ruleId && profileId && canDisableRule?.(finding));
        return (
          <Space size="small">
            <Tooltip title={t('common.review')}><Button type="text" icon={<EyeOutlined />} aria-label={t('common.review')} onClick={() => setSelectedFinding(finding)} /></Tooltip>
            <Tooltip title={t('quality.copySuggestion')}><Button type="text" icon={<CopyOutlined />} aria-label={t('quality.copySuggestion')} onClick={() => copySuggestion(finding)} /></Tooltip>
            <Dropdown trigger={['click']} menu={{
              items: [
                { key: 'accepted', label: t('quality.feedbackAccepted') },
                { key: 'false-positive', label: t('quality.feedbackFalsePositive') },
                { key: 'fixed', label: t('quality.feedbackFixed') },
                { key: 'ignored', label: t('quality.feedbackIgnored') },
                { type: 'divider' },
                { key: 'rule-disabled', danger: true, label: allowRuleDisable ? t('quality.feedbackDisableRule') : <Tooltip title={t('quality.ruleUnavailableHint')}><span>{t('quality.feedbackDisableRule')}</span></Tooltip>, disabled: !allowRuleDisable }
              ],
              onClick: ({ key }) => chooseFeedback(finding, key)
            }}>
              <Button type="text" loading={pending} icon={<MoreOutlined />} aria-label={t('quality.moreFeedback')} disabled={!onSaveFeedback} />
            </Dropdown>
          </Space>
        );
      }
    }
  ];

  return (
    <Space direction="vertical" size="middle" className="qa-finding-review">
      {error ? <Alert type="error" showIcon closable message={error} onClose={() => setError('')} /> : null}
      {!compact ? (
        <Space wrap>
          <Select allowClear value={filters.severity || undefined} onChange={(value) => setFilters((current) => ({ ...current, severity: value || '' }))} placeholder={t('quality.allSeverities')} options={severityOptions} className="quality-select" />
          <Select allowClear value={filters.category || undefined} onChange={(value) => setFilters((current) => ({ ...current, category: value || '' }))} placeholder={t('quality.allCategories')} options={categoryOptions} className="quality-select" />
          <Select allowClear value={filters.origin || undefined} onChange={(value) => setFilters((current) => ({ ...current, origin: value || '' }))} placeholder={t('quality.allOrigins')} options={originOptions} className="quality-select" />
          <Select allowClear value={filters.reviewState || undefined} onChange={(value) => setFilters((current) => ({ ...current, reviewState: value || '' }))} placeholder={t('quality.allReviewStates')} options={[
            { value: 'reviewed', label: t('quality.reviewed') },
            { value: 'unreviewed', label: t('quality.unreviewed') },
            { value: 'accepted', label: feedbackLabel('accepted') },
            { value: 'false-positive', label: feedbackLabel('false-positive') },
            { value: 'fixed', label: feedbackLabel('fixed') },
            { value: 'ignored', label: feedbackLabel('ignored') },
            { value: 'rule-disabled', label: feedbackLabel('rule-disabled') }
          ]} className="quality-select" />
        </Space>
      ) : null}
      <Text type="secondary">{t('quality.findingReviewSummary', { visible: visibleFindings.length, total: findings.length, reviewed: reviewedCount })}</Text>
      <Table
        rowKey="id"
        size="small"
        columns={compact ? columns.filter((column) => !['category', 'feedback'].includes(column.dataIndex || column.key)) : columns}
        dataSource={compact ? visibleFindings.slice(0, 3) : visibleFindings}
        pagination={compact ? false : { pageSize: 25 }}
        scroll={compact ? undefined : { x: 820 }}
      />
      {embedded && selectedFinding ? <Card size="small" title={selectedFinding.title || selectedFinding.message} extra={<Button type="link" onClick={() => setSelectedFinding(null)}>{t('common.close')}</Button>}><Descriptions column={1} bordered size="small" items={[
        { key: 'severity', label: t('quality.severity'), children: <Tag color={SEVERITY_COLOR[selectedFinding.severity] || 'default'}>{selectedFinding.severity}</Tag> },
        { key: 'category', label: t('quality.category'), children: selectedFinding.category || '-' },
        { key: 'message', label: t('quality.issue'), children: selectedFinding.message || '-' },
        { key: 'source', label: t('quality.sourceEvidence'), children: selectedFinding.sourceEvidence || '-' },
        { key: 'target', label: t('quality.targetEvidence'), children: selectedFinding.targetEvidence || '-' },
        { key: 'suggestion', label: t('quality.suggestion'), children: selectedFinding.suggestedTranslation || '-' },
        { key: 'origin', label: t('quality.origin'), children: selectedFinding.origin || '-' },
        { key: 'feedback', label: t('quality.reviewState'), children: feedbackLabel(feedbackByFinding[selectedFinding.id]) }
      ]} /></Card> : null}
      {!embedded ? <Drawer title={selectedFinding?.title || selectedFinding?.message} open={Boolean(selectedFinding)} onClose={() => setSelectedFinding(null)} width="min(640px, calc(100vw - 32px))" destroyOnHidden>
        {selectedFinding ? <Descriptions column={1} bordered size="small" items={[
          { key: 'severity', label: t('quality.severity'), children: <Tag color={SEVERITY_COLOR[selectedFinding.severity] || 'default'}>{selectedFinding.severity}</Tag> },
          { key: 'category', label: t('quality.category'), children: selectedFinding.category || '-' },
          { key: 'message', label: t('quality.issue'), children: selectedFinding.message || '-' },
          { key: 'source', label: t('quality.sourceEvidence'), children: selectedFinding.sourceEvidence || '-' },
          { key: 'target', label: t('quality.targetEvidence'), children: selectedFinding.targetEvidence || '-' },
          { key: 'suggestion', label: t('quality.suggestion'), children: <Space><Text>{selectedFinding.suggestedTranslation || '-'}</Text><Button type="text" icon={<CopyOutlined />} aria-label={t('quality.copySuggestion')} onClick={() => copySuggestion(selectedFinding)} /></Space> },
          { key: 'origin', label: t('quality.origin'), children: selectedFinding.origin || '-' },
          { key: 'feedback', label: t('quality.reviewState'), children: feedbackLabel(feedbackByFinding[selectedFinding.id]) }
        ]} /> : null}
      </Drawer> : null}
    </Space>
  );
}
