import { EmptyState } from '@langlink-tech/antd-kit/feedback';
import { LISTY_SMALL_ITEM_STYLE } from '../../tableLayout.mjs';
import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Flex,
  Input,
  Listy,
  Segmented,
  Space,
  Tag,
  Typography,
  Tooltip
} from 'antd';
import { useState } from 'react';
import { useI18n } from '../../i18n';
import { ASSET_CATEGORIES, buildAssetUsageMap } from './assetPresentation.mjs';

import { buildAssetLanguageOptions, getConfiguredAssetLanguages, matchesAssetSearch } from './assetLanguages.mjs';

import AssetDetailsModal from './AssetDetailsModal';

const { Text } = Typography;

export default function AssetsPage({
  profileItems = [],
  assets = [],
  assetImportRules = {},
  importingAssetType = '',
  onImportAsset,
  onDeleteAsset,
  onPreviewAsset,
  onSaveAsset,
  bindingsBlocked = false,
  onDirtyChange,
  onBusyChange
}) {
  const { t, locale } = useI18n();
  const [assetCategoryId, setAssetCategoryId] = useState('all');
  const [editingAsset, setEditingAsset] = useState(null);
  const [usageFilter, setUsageFilter] = useState('all');
  const [assetSearch, setAssetSearch] = useState('');
  const assetUsage = buildAssetUsageMap(profileItems, t('context.unnamedProfile'));
  const languageOptions = new Map(buildAssetLanguageOptions(locale, assets.flatMap(getConfiguredAssetLanguages)).map((option) => [option.value, option]));
  const visibleAssets = assets.filter((asset) => {
    const matchesCategory = assetCategoryId === 'all' || asset?.type === assetCategoryId;
    const used = (assetUsage.get(asset.id) || []).length > 0;
    return matchesCategory && (usageFilter === 'all' || (usageFilter === 'used' ? used : !used)) && matchesAssetSearch(asset, assetSearch, assetUsage.get(asset.id) || [],
      getConfiguredAssetLanguages(asset).map((language) => languageOptions.get(language)?.searchLabel || language), t(`context.assetType.${asset.type}`));
  });
  const categoryOptions = ASSET_CATEGORIES.map((category) => ({
    value: category.id,
    label: `${t(category.translationKey)} (${category.assetType ? assets.filter((asset) => asset?.type === category.assetType).length : assets.length})`
  }));
  const importActions = (
    <Space wrap>
      <Button type="primary" icon={<PlusOutlined />} disabled={Boolean(importingAssetType)} loading={importingAssetType === 'glossary'} onClick={() => onImportAsset?.('glossary')}>{t('context.assetImportGlossary')}</Button>
      <Button disabled={Boolean(importingAssetType)} loading={importingAssetType === 'custom_tm'} onClick={() => onImportAsset?.('custom_tm')}>{t('context.assetImportTm')}</Button>
    </Space>
  );

  return (
    <Space orientation="vertical" size={16} className="app-block-space">
      <Card
        className="page-card"
        title={t('context.assetLibraryTitle')}
      >
            <Space orientation="vertical" size={12} className="app-block-space">
              {importActions}
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
              <Segmented value={usageFilter} onChange={setUsageFilter} options={['all', 'used', 'unused'].map((value) => ({ value, label: t(`context.assetUsageFilter.${value}`) }))} />
              <Text type="secondary">{t('context.assetLibraryHint')}</Text>
              <Text type="secondary">
                {t('context.assetAllowedExtensions', {
                  glossary: (assetImportRules?.glossary?.extensions || []).join(', '),
                  customTm: (assetImportRules?.customTm?.extensions || []).join(', '),
                  brief: ''
                })}
              </Text>

              {visibleAssets.length === 0 ? (
                <EmptyState description={t(assets.length ? 'context.assetNoSearchResults' : 'context.noAssets')} />
              ) : (
                <Listy
                  items={visibleAssets}
                  rowKey="id"
                  styles={{ item: LISTY_SMALL_ITEM_STYLE }}
                  itemRender={(asset) => {
                    const usageProfiles = assetUsage.get(asset.id) || [];
                    const languages = getConfiguredAssetLanguages(asset);
                    return (
                      <Flex className="asset-library-item" align="center" justify="space-between" wrap gap="small">
                        <Space orientation="vertical" size={6} className="app-full-width">
                          <Space wrap size={[8, 8]}>
                            <Text strong>{asset.name}</Text>
                            <Tag>{t(`context.assetType.${asset.type}`)}</Tag>
                            {usageProfiles.length > 0 && <Tag color="blue">{usageProfiles.length}</Tag>}
                          </Space>
                          {asset.type === 'glossary' ? <Text type="secondary">{t(asset.tbDirectionMode === 'automatic' ? 'context.assetAutomaticDirection' : 'context.assetLegacyDirection')}</Text> : null}
                          {languages.length ? (
                            <Space wrap size={[8, 8]} aria-label={t('context.assetConfiguredLanguages')}>
                              {languages.map((language) => <Tag key={language}>{languageOptions.get(language)?.label || language}</Tag>)}
                            </Space>
                          ) : null}
                          {usageProfiles.length > 0 ? (
                            <Space wrap size={[8, 8]}>
                              <Text type="secondary">{t('context.assetUsedDeleteHint')}</Text>
                              {usageProfiles.map((profileName) => (
                                <Tag key={`${asset.id}-${profileName}`}>{profileName}</Tag>
                              ))}
                            </Space>
                          ) : (
                            <Text type="secondary">{t('context.assetNotAttached')}</Text>
                          )}
                        </Space>
                        <Space wrap size={8}>

                          <Button key={`preview-${asset.id}`} type="text" icon={<EyeOutlined />} onClick={() => onPreviewAsset?.(asset.id)}>
                            {t('context.previewAsset')}
                          </Button>
                          <Button key={`manage-${asset.id}`} type="text" icon={<EditOutlined />} onClick={() => setEditingAsset(asset)}>{t('context.assetManage')}</Button>
                          <Tooltip key={`delete-${asset.id}`} title={usageProfiles.length ? t('context.assetUnbindBeforeDelete', { names: usageProfiles.join(', ') }) : ''}>
                            <span><Button disabled={usageProfiles.length > 0} danger type="text" icon={<DeleteOutlined />} onClick={() => onDeleteAsset(asset.id)}>{t('common.delete')}</Button></span>
                          </Tooltip>
                        </Space>
                      </Flex>
                    );
                  }}
                />
              )}
            </Space>
      </Card>
      {editingAsset ? <AssetDetailsModal key={editingAsset.id} asset={editingAsset} profiles={profileItems} assets={assets}
        bindingsBlocked={bindingsBlocked} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} onSave={onSaveAsset} onClose={() => setEditingAsset(null)} /> : null}
    </Space>
  );
}
