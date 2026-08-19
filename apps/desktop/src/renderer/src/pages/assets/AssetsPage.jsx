import { DeleteOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Dropdown,
  Empty,
  Input,
  List,
  Segmented,
  Space,
  Tag,
  Typography
} from 'antd';
import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { ASSET_CATEGORIES, buildAssetUsageMap } from './assetPresentation.mjs';

const { Text } = Typography;

export default function AssetsPage({
  profileItems = [],
  assets = [],
  assetImportRules = {},
  importingAssetType = '',
  onImportAsset,
  onDeleteAsset,
  onPreviewAsset
}) {
  const { t } = useI18n();
  const [assetCategoryId, setAssetCategoryId] = useState('all');
  const [assetSearch, setAssetSearch] = useState('');
  const assetUsage = buildAssetUsageMap(profileItems, t('context.unnamedProfile'));
  const normalizedSearch = assetSearch.trim().toLowerCase();
  const visibleAssets = useMemo(() => assets.filter((asset) => {
    const matchesCategory = assetCategoryId === 'all' || asset?.type === assetCategoryId;
    const matchesSearch = !normalizedSearch || [asset?.name, asset?.type]
      .some((value) => String(value || '').toLowerCase().includes(normalizedSearch));
    return matchesCategory && matchesSearch;
  }), [assetCategoryId, assets, normalizedSearch]);
  const categoryOptions = ASSET_CATEGORIES.map((category) => ({
    value: category.id,
    label: `${t(category.translationKey)} (${category.assetType ? assets.filter((asset) => asset?.type === category.assetType).length : assets.length})`
  }));
  const addAssetMenu = {
    items: [
      { key: 'glossary', label: t('context.uploadGlossary'), disabled: Boolean(importingAssetType) },
      { key: 'custom_tm', label: t('context.uploadCustomTm'), disabled: Boolean(importingAssetType) }
    ],
    onClick: ({ key }) => onImportAsset?.(key)
  };

  return (
    <Space direction="vertical" size={16} className="app-block-space">
      <Card
        className="page-card"
        title={t('context.assetLibraryTitle')}
        extra={(
          <Dropdown menu={addAssetMenu} trigger={['click']}>
            <Button type="primary" icon={<PlusOutlined />} loading={Boolean(importingAssetType)}>{t('common.add')}</Button>
          </Dropdown>
        )}
      >
            <Space direction="vertical" size={12} className="app-block-space">
              <div className="asset-library-toolbar">
                <Segmented
                  options={categoryOptions}
                  value={assetCategoryId}
                  onChange={setAssetCategoryId}
                />
                <Input.Search
                  allowClear
                  value={assetSearch}
                  onChange={(event) => setAssetSearch(event.target.value)}
                  placeholder={t('context.assetSearchPlaceholder')}
                />
              </div>
              <Text type="secondary">{t('context.assetLibraryHint')}</Text>
              <Text type="secondary">
                {t('context.assetAllowedExtensions', {
                  glossary: (assetImportRules?.glossary?.extensions || []).join(', '),
                  customTm: (assetImportRules?.customTm?.extensions || []).join(', '),
                  brief: ''
                })}
              </Text>

              {visibleAssets.length === 0 ? (
                <Empty description={t('context.noAssets')}>
                  <Dropdown menu={addAssetMenu} trigger={['click']}>
                    <Button type="primary" icon={<PlusOutlined />} loading={Boolean(importingAssetType)}>
                      {t('common.add')}
                    </Button>
                  </Dropdown>
                </Empty>
              ) : (
                <List
                  size="small"
                  dataSource={visibleAssets}
                  renderItem={(asset) => {
                    const usageProfiles = assetUsage.get(asset.id) || [];
                    return (
                      <List.Item
                        className="asset-library-item"
                        actions={[
                          <Button key={`preview-${asset.id}`} type="text" icon={<EyeOutlined />} onClick={() => onPreviewAsset?.(asset.id)}>
                            {t('context.previewAsset')}
                          </Button>,
                          <Button key={`delete-${asset.id}`} danger type="text" icon={<DeleteOutlined />} onClick={() => onDeleteAsset(asset.id)}>
                            {t('common.delete')}
                          </Button>
                        ]}
                      >
                        <Space direction="vertical" size={6} className="app-full-width">
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
                            <Text type="secondary">{t('context.assetNotAttached')}</Text>
                          )}
                        </Space>
                      </List.Item>
                    );
                  }}
                />
              )}
            </Space>
      </Card>
    </Space>
  );
}
