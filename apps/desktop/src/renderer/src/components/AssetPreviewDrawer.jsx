import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd';
import {
  buildAssetPreviewRows,
  canApplyTbStructurePreview,
  formatAssetPreviewMapping,
  getAssetPreviewConfidenceLabel,
  hasTbStructurePreview
} from '../pages/assets/assetPresentation.mjs';
import { useI18n } from '../i18n';
import { TABLE_SCROLL_X } from '../tableLayout.mjs';

const { Text } = Typography;
const WIDE_SIDE_DRAWER_WIDTH = 'min(920px, calc(100vw - 32px))';

// Read-only asset preview drawer driven by useAssetPreviewController: asset
// metadata, parse warnings, manual TB mapping form, detected-structure apply,
// and the preview rows themselves.
export default function AssetPreviewDrawer({ controller }) {
  const { t } = useI18n();
  const {
    assetPreviewOpen,
    assetPreviewLoading,
    assetPreviewRecord,
    assetPreviewData,
    assetPreviewManualDraft,
    assetPreviewSaving,
    setAssetPreviewManualDraft,
    closeAssetPreview,
    saveAssetPreviewTbConfig,
    applyDetectedAssetPreviewTbStructure
  } = controller;

  return (
    <Drawer
      title={t('context.assetPreviewTitle')}
      placement="right"
      open={assetPreviewOpen}
      onClose={closeAssetPreview}
      width={WIDE_SIDE_DRAWER_WIDTH}
      destroyOnClose
    >
      <Space direction="vertical" size={16} className="app-block-space">
        {assetPreviewRecord ? (
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label={t('context.name')}>{assetPreviewRecord.name || '-'}</Descriptions.Item>
            <Descriptions.Item label={t('context.assetTypeLabel')}>{t(`context.assetType.${assetPreviewRecord.type}`)}</Descriptions.Item>
            <Descriptions.Item label={t('context.assetPreviewRowCount')}>{assetPreviewData?.rowCount ?? '-'}</Descriptions.Item>
            <Descriptions.Item label={t('context.assetPreviewParsingMode')}>
              {assetPreviewData?.parsingMode ? t(`context.assetPreviewMode.${assetPreviewData.parsingMode}`) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('context.assetPreviewSmartAvailability')}>
              {typeof assetPreviewData?.smartParsingAvailable === 'boolean'
                ? (assetPreviewData.smartParsingAvailable ? t('common.enabled') : t('common.disabled'))
                : '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('context.assetPreviewConfidenceLabel')}>
              {assetPreviewData?.mappingConfidence ? getAssetPreviewConfidenceLabel(t, assetPreviewData.mappingConfidence) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('context.assetPreviewLanguagePair')}>
              {assetPreviewData?.languagePair?.source || assetPreviewData?.languagePair?.target
                ? `${assetPreviewData?.languagePair?.source || '-'} -> ${assetPreviewData?.languagePair?.target || '-'}`
                : '-'}
            </Descriptions.Item>
            {hasTbStructurePreview(assetPreviewData) ? (
              <Descriptions.Item label={t('context.assetPreviewTbStructureMode')}>
                {t(`context.assetPreviewTbStructureModeValue.${assetPreviewData.tbStructuringMode || 'ai_structured'}`)}
              </Descriptions.Item>
            ) : null}
          </Descriptions>
        ) : null}
        {assetPreviewLoading ? (
          <Text type="secondary">{t('app.loading')}</Text>
        ) : assetPreviewData?.unsupported ? (
          <Alert type="info" showIcon message={t('context.assetPreviewUnavailable')} />
        ) : assetPreviewData?.error ? (
          <Alert type="error" showIcon message={assetPreviewData.error} />
        ) : assetPreviewData?.smartParsingAvailable === false && assetPreviewData?.smartParsingRecommended ? (
          <Alert
            type="info"
            showIcon
            message={t('context.assetPreviewSmartUpgradeTitle')}
            description={t('context.assetPreviewSmartUpgradeDescription')}
          />
        ) : null}
        {Array.isArray(assetPreviewData?.mappingWarnings) && assetPreviewData.mappingWarnings.length ? (
          <Alert
            type="warning"
            showIcon
            message={t('context.assetPreviewWarnings')}
            description={assetPreviewData.mappingWarnings.join(' ')}
          />
        ) : null}
        {Array.isArray(assetPreviewData?.tbStructureWarnings) && assetPreviewData.tbStructureWarnings.length ? (
          <Alert
            type="warning"
            showIcon
            message={t('context.assetPreviewTbStructureWarnings')}
            description={assetPreviewData.tbStructureWarnings.join(' ')}
          />
        ) : null}
        {assetPreviewData?.manualMappingRequired ? (
          <Card size="small" title={t('context.assetPreviewManualMappingTitle')}>
            <Space direction="vertical" size={12} className="app-block-space">
              <Text type="secondary">{t('context.assetPreviewManualMappingDescription')}</Text>
              <Select
                value={assetPreviewManualDraft.srcColumn || undefined}
                placeholder={t('context.assetPreviewManualSource')}
                options={(assetPreviewData?.availableColumns || []).map((columnName) => ({ value: columnName, label: columnName }))}
                onChange={(value) => setAssetPreviewManualDraft((current) => ({ ...current, srcColumn: value || '' }))}
              />
              <Select
                value={assetPreviewManualDraft.tgtColumn || undefined}
                placeholder={t('context.assetPreviewManualTarget')}
                options={(assetPreviewData?.availableColumns || []).map((columnName) => ({ value: columnName, label: columnName }))}
                onChange={(value) => setAssetPreviewManualDraft((current) => ({ ...current, tgtColumn: value || '' }))}
              />
              <Input
                value={assetPreviewManualDraft.sourceLanguage}
                placeholder={t('context.assetPreviewManualSourceLanguage')}
                onChange={(event) => setAssetPreviewManualDraft((current) => ({ ...current, sourceLanguage: event.target.value }))}
              />
              <Input
                value={assetPreviewManualDraft.targetLanguage}
                placeholder={t('context.assetPreviewManualTargetLanguage')}
                onChange={(event) => setAssetPreviewManualDraft((current) => ({ ...current, targetLanguage: event.target.value }))}
              />
              <Button
                type="primary"
                loading={assetPreviewSaving}
                onClick={() => void saveAssetPreviewTbConfig()}
                disabled={!assetPreviewManualDraft.srcColumn || !assetPreviewManualDraft.tgtColumn || !assetPreviewManualDraft.sourceLanguage || !assetPreviewManualDraft.targetLanguage}
              >
                {t('context.assetPreviewManualSave')}
              </Button>
            </Space>
          </Card>
        ) : null}
        {hasTbStructurePreview(assetPreviewData) ? (
          <Descriptions bordered column={1} size="small" title={t('context.assetPreviewTbStructureTitle')}>
            <Descriptions.Item label={t('context.assetPreviewTbStructureSummary')}>
              {assetPreviewData?.tbStructureSummary || '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('context.assetPreviewTbStructureFingerprint')}>
              {assetPreviewData?.tbStructureFingerprint || '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('context.assetPreviewTbStructureApplied')}>
              {assetPreviewData?.tbStructureApplied === true ? t('common.enabled') : t('common.disabled')}
            </Descriptions.Item>
          </Descriptions>
        ) : null}
        {canApplyTbStructurePreview(assetPreviewData) ? (
          <Card size="small" title={t('context.assetPreviewApplyDetectedTitle')}>
            <Space direction="vertical" size={12} className="app-block-space">
              <Text type="secondary">{t('context.assetPreviewApplyDetectedDescription')}</Text>
              <Button
                type="primary"
                loading={assetPreviewSaving}
                onClick={() => void applyDetectedAssetPreviewTbStructure()}
              >
                {t('context.assetPreviewApplyDetectedAction')}
              </Button>
            </Space>
          </Card>
        ) : null}
        {formatAssetPreviewMapping(assetPreviewData?.detectedMapping).length ? (
          <Descriptions bordered column={1} size="small" title={t('context.assetPreviewDetectedMapping')}>
            {formatAssetPreviewMapping(assetPreviewData?.detectedMapping).map((item) => (
              <Descriptions.Item key={item.key} label={t(`context.assetPreviewField.${item.role}`)}>
                <Space>
                  <Text>{item.columnName}</Text>
                  <Tag>{t(`context.assetPreviewConfidence.${item.confidence}`)}</Tag>
                </Space>
              </Descriptions.Item>
            ))}
            <Descriptions.Item label={t('context.assetPreviewUnmappedColumns')}>
              {(assetPreviewData?.unmappedColumns || []).map((item) => item.columnName).filter(Boolean).join(', ') || '-'}
            </Descriptions.Item>
          </Descriptions>
        ) : null}
        {Array.isArray(assetPreviewData?.rows) && assetPreviewData.rows.length ? (
          <>
            <Table
              size="small"
              pagination={false}
              scroll={{ x: TABLE_SCROLL_X }}
              dataSource={buildAssetPreviewRows(assetPreviewData)}
              columns={(assetPreviewData.columns || Object.keys(assetPreviewData.rows[0] || {})).map((columnKey) => ({
                title: t(`context.assetPreviewColumn.${columnKey}`),
                dataIndex: columnKey,
                key: columnKey,
                render: (value) => String(value ?? '')
              }))}
            />
            {assetPreviewData?.truncated ? <Text type="secondary">{t('context.assetPreviewTruncated')}</Text> : null}
          </>
        ) : Array.isArray(assetPreviewData?.rows) ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('context.assetPreviewEmpty')} />
        ) : assetPreviewData?.text ? (
          <pre className="history-json">{assetPreviewData.text}</pre>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('context.assetPreviewEmpty')} />
        )}
      </Space>
    </Drawer>
  );
}
