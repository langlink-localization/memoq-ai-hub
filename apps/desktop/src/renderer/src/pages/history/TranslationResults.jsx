import { useState } from 'react';
import { Alert, Button, Col, Collapse, Form, Popconfirm, Row, Select, Space, Typography } from 'antd';
import TranslationEvidence from '../../components/TranslationEvidence.jsx';
import { useRequestLifecycle } from '../../hooks/useRequestLifecycle.mjs';
import { runLatestRequest } from '../../requestLifecycle.mjs';

function HighlightedText({ text = '', terms = [] }) {
  const tokens = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!tokens.length) return text || '—';
  const escaped = tokens.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return String(text).split(new RegExp(`(${escaped.join('|')})`, 'gu')).map((part, index) => tokens.includes(part) ? <mark key={index}>{part}</mark> : part);
}

function SegmentResult({ record, segment, profiles = [], t }) {
  const [profileId, setProfileId] = useState(profiles.some((profile) => profile.id === record.profileId) ? record.profileId : '');
  const [pending, setPending] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState('');
  const lifecycle = useRequestLifecycle();
  const matches = segment.evidence?.assets.flatMap((asset) => asset.matches) || [];
  async function retranslate() {
    if (pending) return;
    setPending(true); setError(''); setComparison(null);
    await runLatestRequest(lifecycle, {
      load: () => window.memoqDesktop.retranslateHistory({ historyId: record.id, segmentIndex: segment.segmentIndex, profileId }),
      resolve: setComparison, reject: (failure) => setError(failure.message), settle: () => setPending(false)
    });
  }
  return <Space orientation="vertical" size={16} className="app-block-space">
    <Typography.Text strong>{t('history.batchItemLabel', { index: segment.segmentIndex })}</Typography.Text>
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}><Typography.Text strong>{t('history.source')}</Typography.Text><Typography.Paragraph copyable={{ text: segment.sourceText || '' }} className="translation-result-text"><HighlightedText text={segment.sourceText} terms={matches.map((match) => match.sourceTerm)} /></Typography.Paragraph></Col>
      <Col xs={24} lg={12}><Typography.Text strong>{t('history.target')}</Typography.Text><Typography.Paragraph copyable={{ text: segment.targetText || '' }} className="translation-result-text"><HighlightedText text={segment.targetText} terms={matches.map((match) => match.targetTerm)} /></Typography.Paragraph></Col>
    </Row>
    {segment.rejectedTranslation ? <Alert type="warning" title={t('evidence.rejected')} description={<Typography.Paragraph copyable className="translation-result-text">{segment.rejectedTranslation}</Typography.Paragraph>} /> : null}
    <TranslationEvidence evidence={segment.evidence} t={t} />
    <Form layout="vertical" component="div"><Form.Item label={t('evidence.currentProfile')}><Select aria-label={t('evidence.currentProfile')} value={profileId || undefined} disabled={pending} options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))} onChange={(value) => { setProfileId(value); setComparison(null); setError(''); }} /></Form.Item></Form>
    <Popconfirm title={t('evidence.retranslate')} description={t('evidence.retranslateHint')} onConfirm={retranslate} disabled={pending || !profileId}>
      <Button loading={pending} disabled={!profileId}>{t('evidence.retranslate')}</Button>
    </Popconfirm>
    {error ? <Alert type="error" showIcon title={error} /> : null}
    {comparison ? <Space orientation="vertical" className="app-block-space">
      <Alert type={comparison.statusCode === 200 ? 'success' : 'warning'} showIcon title={t('evidence.comparison')} description={comparison.error?.message || t('evidence.comparisonHint')} />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}><Typography.Text strong>{t('evidence.before')}</Typography.Text><Typography.Paragraph copyable className="translation-result-text">{comparison.originalText || '—'}</Typography.Paragraph></Col>
        <Col xs={24} lg={12}><Typography.Text strong>{t('evidence.after')}</Typography.Text><Typography.Paragraph copyable className="translation-result-text">{comparison.translatedText || '—'}</Typography.Paragraph></Col>
      </Row>
      <TranslationEvidence evidence={comparison.evidence} t={t} />
    </Space> : null}
  </Space>;
}

export default function TranslationResults({ record, profiles, t }) {
  return <Space orientation="vertical" size={16} className="app-block-space">
    <Typography.Title level={4}>{t('evidence.results')}</Typography.Title>
    <Typography.Text copyable>{record.requestId}</Typography.Text>
    {record.parentHistoryId ? <Typography.Text type="secondary">{t('evidence.retranslationRecord')}</Typography.Text> : null}
    {(record.segments || []).map((segment) => <Collapse key={segment.segmentIndex} defaultActiveKey={['result']} items={[{ key: 'result', label: t('history.batchItemLabel', { index: segment.segmentIndex }), children: <SegmentResult record={record} segment={segment} profiles={profiles} t={t} /> }]} />)}
  </Space>;
}
