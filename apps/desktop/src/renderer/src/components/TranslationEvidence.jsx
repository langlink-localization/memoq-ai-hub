import { Alert, Descriptions, Space, Tag, Typography } from 'antd';

export default function TranslationEvidence({ evidence, t }) {
  if (!evidence || evidence.version !== 1) return <Alert type="info" showIcon title={t('evidence.notRecorded')} />;
  const status = evidence.terminologyStatus;
  return <Space orientation="vertical" className="app-block-space translation-evidence">
    <Alert showIcon type={status === 'violated' ? 'warning' : status === 'compliant' ? 'success' : 'info'} title={t(`evidence.${status}`)} description={t(`evidence.${status}Hint`)} />
    <Space wrap>
      <Tag>{evidence.profile?.name}</Tag>
      <Tag>{t(`evidence.${evidence.resultSource}`)}{evidence.cacheKind ? ` (${evidence.cacheKind})` : ''}</Tag>
      {evidence.provider ? <Tag>{evidence.provider.name} · {evidence.provider.model}</Tag> : null}
    </Space>
    {evidence.resultSource === 'cache' ? <Typography.Text type="secondary">{t('evidence.cacheHint')}</Typography.Text> : null}
    {evidence.assets.map((asset) => <Descriptions key={asset.id} bordered size="small" column={1} title={asset.name}>
      <Descriptions.Item label={t('evidence.assetState')}>{t(`evidence.${asset.matchStatus}`)} · {t(asset.deliveryStatus === 'unknown' ? 'evidence.deliveryUnknown' : asset.sentToModel ? 'evidence.sent' : 'evidence.notSent')}</Descriptions.Item>
      {asset.ruleDirectionRequired ? <Descriptions.Item label={t('context.assetRuleScope')}>{t('context.assetRuleDirectionRequired')}</Descriptions.Item> : null}
      <Descriptions.Item label={t('evidence.matches')}>{asset.matches.length ? asset.matches.map((match, index) => <div key={index}>{match.sourceTerm || match.sourceText} → {match.targetTerm || match.targetText}{match.sourceLanguage && match.targetLanguage ? ` (${match.sourceLanguage} → ${match.targetLanguage})` : ''}{match.directionalRule ? ` · ${t('context.assetRuleScope')}` : ''}{match.forbidden ? ` (${t('evidence.forbidden')})` : ''}</div>) : '—'}</Descriptions.Item>
      <Descriptions.Item label={t('evidence.version')}><Typography.Text copyable className="translation-result-text">{asset.fingerprint}</Typography.Text></Descriptions.Item>
    </Descriptions>)}
  </Space>;
}
