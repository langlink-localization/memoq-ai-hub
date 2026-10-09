import { DeleteOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Dropdown,
  Flex,
  Input,
  Listy,
  Segmented,
  Space,
  Tag,
  Typography
} from 'antd';
import { EmptyState } from '@langlink-tech/antd-kit/feedback';
import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { LISTY_SMALL_ITEM_STYLE } from '../../tableLayout.mjs';
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
    <Space orientation="vertical" size={16} className="app-block-space">
      <Card
        className="page-card"
        title={t('context.assetLibraryTitle')}
        extra={(
          <Dropdown menu={addAssetMenu} trigger={['click']}>
            <Button type="primary" icon={<PlusOutlined />} loading={Boolean(importingAssetType)}>{t('common.add')}</Button>
          </Dropdown>
        )}
      >
            <Space orientation="vertical" size={12} className="app-block-space">
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
                <EmptyState
                  description={t('context.noAssets')}
                  action={(
                    <Dropdown menu={addAssetMenu} trigger={['click']}>
                      <Button type="primary" icon={<PlusOutlined />} loading={Boolean(importingAssetType)}>
                        {t('common.add')}
                      </Button>
                    </Dropdown>
                  )}
                />
              ) : (
                <Listy
                  items={visibleAssets}
                  rowKey="id"
                  styles={{ item: LISTY_SMALL_ITEM_STYLE }}
                  itemRender={(asset) => {
                    const usageProfiles = assetUsage.get(asset.id) || [];
                    return (
                      <Flex className="asset-library-item" align="center" justify="space-between">
                        <Space orientation="vertical" size={6} className="app-full-width">
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
                        <Space size={8}>
                          <Button type="text" icon={<EyeOutlined />} onClick={() => onPreviewAsset?.(asset.id)}>
                            {t('context.previewAsset')}
                          </Button>
                          <Button danger type="text" icon={<DeleteOutlined />} onClick={() => onDeleteAsset(asset.id)}>
                            {t('common.delete')}
                          </Button>
                        </Space>
                      </Flex>
                    );
                  }}
                />
              )}
            </Space>
      </Card>
    </Space>
  );
}
