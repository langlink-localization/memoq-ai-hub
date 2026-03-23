import { DeleteOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Dropdown,
  Empty,
  List,
  Row,
  Col,
  Space,
  Tag,
  Typography
} from 'antd';
import { useMemo, useState } from 'react';
import {
  buildCollapsiblePanelEntries,
  getPanelColumnSpan,
  getPanelContentSpan
} from '../../appShell.mjs';
import { CollapsibleItemList, CollapsibleSidePanel, ProfileListRow } from '../../components/CollapsibleSidePanel';
import { useI18n } from '../../i18n';

const { Text } = Typography;

const ASSET_CATEGORIES = [
  { id: 'all', assetType: '', translationKey: 'context.assetCategoryAll' },
  { id: 'glossary', assetType: 'glossary', translationKey: 'context.assetType.glossary' }
];

function AssetCategoryPanel({
  assets,
  currentCategoryId,
  onSelectCategory,
  onImportAsset,
  collapsed,
  onToggleCollapsed,
  expandLabel,
  collapseLabel
}) {
  const { t } = useI18n();
  const addAssetMenu = {
    items: [
      { key: 'glossary', label: t('context.uploadGlossary') }
    ],
    onClick: ({ key }) => onImportAsset?.(key)
  };
  const entries = buildCollapsiblePanelEntries(ASSET_CATEGORIES, {
    selectedId: currentCategoryId,
    emptyLabel: t('context.assetCategoryAll'),
    getLabel: (category) => t(category.translationKey),
    getTags: (category) => {
      const count = category.assetType
        ? assets.filter((asset) => asset?.type === category.assetType).length
        : assets.length;
      return [{ key: `${category.id}-count`, label: String(count), color: 'blue' }];
    }
  });

  return (
    <CollapsibleSidePanel
      title={t('context.assetLibraryTitle')}
      collapsed={collapsed}
      onToggle={onToggleCollapsed}
      expandLabel={expandLabel}
      collapseLabel={collapseLabel}
      extra={(
        <Dropdown
          menu={addAssetMenu}
          trigger={['click']}
        >
          <Button icon={<PlusOutlined />}>{t('common.add')}</Button>
        </Dropdown>
      )}
      collapsedExtra={(
        <Dropdown menu={addAssetMenu} trigger={['click']}>
          <Button icon={<PlusOutlined />} aria-label={t('common.add')} />
        </Dropdown>
      )}
    >
      <CollapsibleItemList
        entries={entries}
        collapsed={collapsed}
        emptyText={t('context.noAssets')}
        onSelect={onSelectCategory}
        renderExpandedItem={(entry, { compact }) => (
          <ProfileListRow entry={entry} compact={compact} onClick={() => onSelectCategory(entry.id)} />
        )}
      />
    </CollapsibleSidePanel>
  );
}

function buildAssetUsageMap(profileItems = [], fallbackLabel = '-') {
  return profileItems.reduce((usageMap, profile) => {
    for (const binding of profile?.assetBindings || []) {
      const existing = usageMap.get(binding.assetId) || [];
      usageMap.set(binding.assetId, [...existing, profile.name || fallbackLabel]);
    }
    return usageMap;
  }, new Map());
}

export default function AssetsPage({
  profileItems = [],
  assets = [],
  assetImportRules = {},
  onImportAsset,
  onDeleteAsset,
  onPreviewAsset
}) {
  const { t } = useI18n();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [assetCategoryId, setAssetCategoryId] = useState('all');
  const assetUsage = buildAssetUsageMap(profileItems, t('providers.notAvailable'));
  const visibleAssets = useMemo(() => (
    assetCategoryId === 'all'
      ? assets
      : assets.filter((asset) => asset?.type === assetCategoryId)
  ), [assetCategoryId, assets]);

  return (
    <Space direction="vertical" size={18} style={{ display: 'flex' }}>
      <Row gutter={16} align="top">
        <Col xs={24} xl={getPanelColumnSpan(sidebarCollapsed)}>
          <AssetCategoryPanel
            assets={assets}
            currentCategoryId={assetCategoryId}
            onSelectCategory={setAssetCategoryId}
            onImportAsset={onImportAsset}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
            expandLabel={t('common.expandSidebar')}
            collapseLabel={t('common.collapseSidebar')}
          />
        </Col>
        <Col xs={24} xl={getPanelContentSpan(sidebarCollapsed)}>
          <Card className="page-card">
            <Space direction="vertical" size={12} style={{ display: 'flex' }}>
              <Text type="secondary">{t('context.assetLibraryHint')}</Text>
              <Text type="secondary">
                {t('context.assetAllowedExtensions', {
                  glossary: (assetImportRules?.glossary?.extensions || []).join(', '),
                  customTm: '',
                  brief: ''
                })}
              </Text>

              {visibleAssets.length === 0 ? (
                <Empty description={t('context.noAssets')} />
              ) : (
                <List
                  size="small"
                  dataSource={visibleAssets}
                  renderItem={(asset) => {
                    const usageProfiles = assetUsage.get(asset.id) || [];
                    return (
                      <List.Item
                        actions={[
                          <Button key={`preview-${asset.id}`} type="text" icon={<EyeOutlined />} onClick={() => onPreviewAsset?.(asset.id)}>
                            {t('context.previewAsset')}
                          </Button>,
                          <Button key={`delete-${asset.id}`} danger type="text" icon={<DeleteOutlined />} onClick={() => onDeleteAsset(asset.id)}>
                            {t('common.delete')}
                          </Button>
                        ]}
                      >
                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
                          <Space wrap size={[8, 8]}>
                            <Text strong>{asset.name}</Text>
                            <Tag>{t(`context.assetType.${asset.type}`)}</Tag>
                            {usageProfiles.length > 0 && <Tag color="blue">{usageProfiles.length}</Tag>}
                          </Space>
                          {usageProfiles.length > 0 ? (
                            <Space wrap size={[8, 8]}>
                              {usageProfiles.map((profileName) => (
                                <Tag key={`${asset.id}-${profileName}`}>{profileName}</Tag>
                              ))}
                            </Space>
                          ) : (
                            <Text type="secondary">{t('providers.notAvailable')}</Text>
                          )}
                        </Space>
                      </List.Item>
                    );
                  }}
                />
              )}
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
