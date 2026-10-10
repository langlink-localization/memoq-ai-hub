import { Alert, Space, Tag, Typography } from 'antd';

export default function TermRuleSummary({ rule, label, t }) {
  if (!rule) return null;
  return <Space orientation="vertical" size={4} className="app-block-space">
    <Typography.Text strong>{label}</Typography.Text>
    <Typography.Text className="asset-preview-value" copyable>{rule.raw?.join('; ') || t('evidence.ruleDefaults')}</Typography.Text>
    {rule.status === 'unsupported' ? <Alert type="warning" showIcon title={t('evidence.rules_unsupported')} description={`${t('evidence.rules_unsupportedHint')} ${rule.unsupported?.join(', ') || ''}`} /> : <Space wrap>
      <Tag>{t(`evidence.ruleCase_${rule.caseMode}`)}</Tag><Tag>{t(`evidence.ruleMatch_${rule.matching}`)}</Tag>
      {rule.forbidden ? <Tag color="warning">NonTerm</Tag> : null}
      {rule.defaults?.caseMode || rule.defaults?.matching ? <Tag>{t('evidence.ruleDefaults')}</Tag> : null}
    </Space>}
  </Space>;
}
