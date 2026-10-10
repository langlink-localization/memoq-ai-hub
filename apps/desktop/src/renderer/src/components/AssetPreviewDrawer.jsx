import { EmptyState } from '@langlink-tech/antd-kit/feedback';
import { DataTable } from '@langlink-tech/antd-kit/table';
import { Alert, Button, Card, Checkbox, Collapse, Descriptions, Drawer, Empty, Form, Select, Space, Typography } from 'antd';
import { buildAssetPreviewRows, formatAssetPreviewMapping } from '../pages/assets/assetPresentation.mjs';
import { buildAssetLanguageOptions, getAssetColumnDetails, getLanguageColumnIssues, isValidLanguageColumnDraft } from '../pages/assets/assetLanguages.mjs';
import { useI18n } from '../i18n';

const { Text } = Typography;
const WIDE_SIDE_DRAWER_WIDTH = 'min(920px, calc(100vw - 32px))';

export function AssetRowDetails({ row, t }) {
  const groups = [...new Set((row.details || []).map((item) => item.group))];
  return <Space orientation="vertical" size={12} className="app-block-space asset-preview-details">
    <Text type="secondary">{t('context.assetMetadataHint')}</Text>
    {groups.map((group) => <Descriptions key={group} title={group.startsWith('language:') ? `${t('context.assetDetailGroup.language')} · ${group.slice(9)}` : t(`context.assetDetailGroup.${group}`)} bordered column={1} size="small"
      items={row.details.filter((item) => item.group === group).map((item, index) => ({
        key: `${group}-${index}`, label: ['rules', 'scope'].includes(group) ? t(`context.assetPreviewField.${item.label}`) : item.label,
        children: <Text className="asset-preview-value" copyable>{item.value}</Text>
      }))} />)}
  </Space>;
}

export default function AssetPreviewDrawer({ controller }) {
  const { t, locale } = useI18n();
  const { assetPreviewOpen, assetPreviewLoading, assetPreviewRecord, assetPreviewData: data,
    assetPreviewManualDraft: draft, assetPreviewSaving, retryAssetPreview, setAssetPreviewManualDraft,
    closeAssetPreview, saveAssetPreviewTbConfig } = controller;
  const columns = getAssetColumnDetails(data || {}, draft.hasHeader !== false);
  const mappings = draft.languageColumns || [];
  const languageOptions = buildAssetLanguageOptions(locale, mappings.map((column) => column.language));
  const automatic = draft.directionMode === 'automatic';
  const ruleOptions = languageOptions.filter((option) => mappings.some((column) => column.language === option.value));
  const rulePair = draft.ruleLanguagePair || {};
  const rulesNeedDirection = automatic && data?.hasDirectionalRules === true;
  const validRulePair = !rulesNeedDirection || (rulePair.source !== rulePair.target && ruleOptions.some((option) => option.value === rulePair.source) && ruleOptions.some((option) => option.value === rulePair.target));
  const editable = assetPreviewRecord?.type === 'glossary' && columns.length > 0;
  const warnings = [...new Set([...(data?.mappingWarnings || []), ...(data?.tbStructureWarnings || [])])];
  const ready = !assetPreviewLoading && !data?.error && !data?.unsupported;
  const languageIssues = getLanguageColumnIssues(mappings);

  return (
    <Drawer title={assetPreviewRecord?.name || t('context.assetPreviewTitle')} placement="right"
      open={assetPreviewOpen} onClose={closeAssetPreview} closable={!assetPreviewSaving}
      mask={{ closable: !assetPreviewSaving }} keyboard={!assetPreviewSaving}
      size={WIDE_SIDE_DRAWER_WIDTH} destroyOnHidden>
      <Space orientation="vertical" size={16} className="app-block-space">
        {assetPreviewLoading ? <Text role="status">{t('app.loading')}</Text> : data?.error ? (
          <Alert type="error" showIcon title={data.error} action={<Button onClick={retryAssetPreview}>{t('common.retry')}</Button>} />
        ) : data?.unsupported ? <Alert type="info" showIcon title={t('context.assetPreviewUnavailable')} /> : null}
        {ready && editable ? (
          <Card size="small" title={t('context.assetLanguageColumnsTitle')}>
            <Space orientation="vertical" size={16} className="app-block-space">
              <Text type="secondary">{t('context.assetLanguageColumnsHint')}</Text>
              <Checkbox checked={automatic} disabled={assetPreviewSaving}
                onChange={(event) => setAssetPreviewManualDraft((current) => ({ ...current, directionMode: event.target.checked ? 'automatic' : 'legacy' }))}>
                {t('context.assetAutomaticDirection')}
              </Checkbox>
              <Text type="secondary">{t(automatic ? 'context.assetAutomaticDirectionHint' : 'context.assetLegacyDirectionHint')}</Text>
              <Checkbox checked={draft.hasHeader !== false} disabled={assetPreviewSaving}
                onChange={(event) => setAssetPreviewManualDraft((current) => ({ ...current, hasHeader: event.target.checked }))}>
                {t('context.assetFirstRowHeader')}
              </Checkbox>
              <Text type="secondary">{t('context.assetSelectedLanguages', { count: mappings.length })}</Text>
              <Form layout="vertical" disabled={assetPreviewSaving}>
                {columns.map((column) => (
                  <Form.Item key={column.columnIndex} label={`${column.columnIndex + 1}. ${column.columnName || t('context.assetUnnamedColumn')}`}
                    extra={<Text className="asset-column-samples" type="secondary">{column.samples.filter(Boolean).join(' · ')}</Text>}>
                    <Select allowClear showSearch={{ optionFilterProp: 'searchLabel' }}
                      aria-label={`${t('context.assetColumnLanguage')} ${column.columnName || column.columnIndex + 1}`}
                      placeholder={t('context.assetIgnoreColumn')}
                      value={mappings.find((mapping) => mapping.columnIndex === column.columnIndex)?.language}
                      options={languageOptions}
                      onChange={(language) => setAssetPreviewManualDraft((current) => ({ ...current,
                        languageColumns: [...(current.languageColumns || []).filter((mapping) => mapping.columnIndex !== column.columnIndex),
                          ...(language ? [{ columnIndex: column.columnIndex, language }] : [])].sort((a, b) => a.columnIndex - b.columnIndex)
                      }))} />
                  </Form.Item>
                ))}
              </Form>
              {rulesNeedDirection ? <Form layout="vertical" disabled={assetPreviewSaving}>
                <Alert type="info" showIcon title={t('context.assetRuleDirectionHint')} />
                {['source', 'target'].map((side) => <Form.Item key={side} label={t(`context.assetRuleLanguage.${side}`)} required>
                  <Select aria-label={t(`context.assetRuleLanguage.${side}`)} options={ruleOptions} value={rulePair[side] || undefined}
                    onChange={(value) => setAssetPreviewManualDraft((current) => ({ ...current, ruleLanguagePair: { ...current.ruleLanguagePair, [side]: value } }))} />
                </Form.Item>)}
              </Form> : null}
              {languageIssues.map((issue) => <Alert key={issue.columnIndex} type="warning" showIcon
                title={t(issue.kind === 'duplicate' ? 'context.assetDuplicateLanguageColumns' : 'context.assetInvalidColumnLanguage', {
                  column: issue.columnIndex + 1, other: issue.otherColumnIndex + 1, language: issue.language
                })} />)}
              <Button type="primary" loading={assetPreviewSaving} disabled={!isValidLanguageColumnDraft(mappings) || !validRulePair}
                onClick={() => void saveAssetPreviewTbConfig()}>{t('context.assetPreviewManualSave')}</Button>
              <Text type="secondary">{t('context.assetSavedPreviewHint')}</Text>
            </Space>
          </Card>
        ) : null}
        {ready && data?.ruleDirectionRequired ? <Alert type="warning" showIcon title={t('context.assetRuleDirectionRequired')} /> : null}
        {ready && warnings.length ? <Alert type="warning" showIcon title={t('context.assetPreviewWarnings')} description={warnings.join(' ')} /> : null}
        {ready && Array.isArray(data?.rows) && data.rows.length ? (
          <Card size="small" title={t('context.assetPreviewTitle')} extra={<Text type="secondary">{t('context.assetPreviewRowCount')}: {data.rowCount}</Text>}>
            <Space orientation="vertical" size={12} className="app-block-space">
              <DataTable size="small" pagination={{ pageSize: 10, hideOnSinglePage: true }} tableLayout="fixed" scroll={{ x: Math.max(760, (data.columns?.length || 4) * 160) }}
                dataSource={buildAssetPreviewRows(data)}
                expandable={{
                  columnTitle: t('context.assetRowDetails'), columnWidth: 72,
                  rowExpandable: (row) => Boolean(row.details?.length),
                  expandedRowRender: (row) => <AssetRowDetails row={row} t={t} />
                }}
                columns={(data.columns || Object.keys(data.rows[0] || {})).map((columnKey) => ({
                  width: ['note', 'rules'].includes(columnKey) ? 240 : 160,
                  title: data.columnLanguages?.[columnKey] ? (languageOptions.find((option) => option.value === data.columnLanguages[columnKey])?.label || data.columnLanguages[columnKey]) : t(`context.assetPreviewColumn.${columnKey}`), dataIndex: columnKey, key: columnKey,
                  render: (value) => columnKey === 'rules' && Array.isArray(value)
                    ? value.map((rule) => `${t(`context.assetPreviewField.${rule.role}`)}: ${rule.value}`).join(' · ') || '—'
                    : columnKey === 'forbidden' ? t(value ? 'context.assetBooleanYes' : 'context.assetBooleanNo')
                      : <span className="asset-preview-value">{String(value ?? '') || '—'}</span>
                }))} />
              {data.truncated ? <Text type="secondary">{t('context.assetPreviewTruncated')}</Text> : null}
            </Space>
          </Card>
        ) : ready && data?.text ? <pre className="history-json">{data.text}</pre>
          : ready ? <EmptyState image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('context.assetPreviewEmpty')} /> : null}
        {ready && data ? (
          <Collapse items={[{ key: 'details', label: t('context.assetTechnicalDetails'), children: (
            <Descriptions bordered column={1} size="small">
              <Descriptions.Item label={t('context.assetPreviewParsingMode')}>{data.parsingMode || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('context.assetPreviewTbStructureSummary')}>{data.tbStructureSummary || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('context.assetPreviewTbStructureFingerprint')}>{data.tbStructureFingerprint || '-'}</Descriptions.Item>
              {formatAssetPreviewMapping(data.detectedMapping).map((item) => (
                <Descriptions.Item key={item.key} label={t(`context.assetPreviewField.${item.role}`)}>{item.columnName}</Descriptions.Item>
              ))}
            </Descriptions>
          ) }]} />
        ) : null}
      </Space>
    </Drawer>
  );
}
