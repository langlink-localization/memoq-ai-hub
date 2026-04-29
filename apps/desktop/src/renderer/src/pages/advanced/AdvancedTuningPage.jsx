import { PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  Dropdown,
  Empty,
  Input,
  List,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography
} from 'antd';
import { useState } from 'react';
import {
  buildCollapsiblePanelEntries,
  getPanelColumnSpan,
  getPanelContentSpan
} from '../../appShell.mjs';
import { CollapsibleItemList, CollapsibleSidePanel, SidePanelMeta } from '../../components/CollapsibleSidePanel';
import { useI18n } from '../../i18n';

const { Text, Title } = Typography;

function ProviderCatalog({
  filteredProviders,
  groupedProviders,
  providerItems,
  providerSearch,
  currentProvider,
  onCreateProvider,
  onProviderSearchChange,
  onSelectProvider,
  getEnabledModelCount,
  getProviderModelCount,
  getStatusTagMeta,
  isDraftProvider,
  collapsed,
  onToggleCollapsed,
  expandLabel,
  collapseLabel
}) {
  const { t } = useI18n();
  const collapsedEntries = buildCollapsiblePanelEntries(filteredProviders, {
    selectedId: currentProvider?.id,
    emptyLabel: t('providers.untitledProvider'),
    getDescription: (provider) => provider.baseUrl
  });

  return (
    <CollapsibleSidePanel
      title={t('nav.providers')}
      collapsed={collapsed}
      onToggle={onToggleCollapsed}
      expandLabel={expandLabel}
      collapseLabel={collapseLabel}
      className="provider-catalog-card"
      extra={(
        <Dropdown
          menu={{
            items: [
              { key: 'openai', label: t('providers.addOpenAIOfficial') },
              { key: 'openai-compatible', label: t('providers.addOpenAICompatible') }
            ],
            onClick: ({ key }) => onCreateProvider?.(key)
          }}
          trigger={['click']}
        >
          <Button size="small" icon={<PlusOutlined />}>{t('common.add')}</Button>
        </Dropdown>
      )}
    >
      <Space direction="vertical" size={16} style={{ display: 'flex' }}>
        {!collapsed ? (
          <>
            <SidePanelMeta>
              {t('providers.providerCount')}: {providerItems.length}
              {' · '}
              {t('providers.enabledModels')}: {providerItems.reduce((sum, provider) => sum + getEnabledModelCount(provider), 0)}
            </SidePanelMeta>
            <Input.Search
              allowClear
              value={providerSearch}
              onChange={(event) => onProviderSearchChange?.(event.target.value)}
              placeholder={t('providers.searchPlaceholder')}
            />
            <div className="provider-list">
              {groupedProviders.map((group) => (
                <div key={group.key} className="provider-list-group">
                  <div className="provider-list-group-label">
                    <Text type="secondary">{group.label}</Text>
                  </div>
                  <List
                    dataSource={group.items}
                    renderItem={(item) => {
                      const tagMeta = getStatusTagMeta(item.status, t);
                      return (
                        <List.Item
                          onClick={() => onSelectProvider?.(item.id)}
                          className={item.id === currentProvider?.id ? 'provider-list-item provider-list-item-active' : 'provider-list-item'}
                        >
                          <Space direction="vertical" size={6} style={{ width: '100%' }}>
                            <div className="provider-list-header">
                              <Space wrap size={[8, 8]}>
                                <Text strong>{item.name}</Text>
                                {isDraftProvider(item) && <Tag bordered={false}>{t('providers.draft')}</Tag>}
                              </Space>
                              <Tag color={tagMeta.color}>{tagMeta.label}</Tag>
                            </div>
                            <Text type="secondary" className="provider-list-subtitle">{item.baseUrl}</Text>
                            <Text type="secondary">
                              {t('providers.modelCount', { value: getProviderModelCount(item) })}
                              {' · '}
                              {item.enabled ? t('common.enabled') : t('common.disabled')}
                            </Text>
                          </Space>
                        </List.Item>
                      );
                    }}
                  />
                </div>
              ))}
            </div>
            {!filteredProviders.length && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={providerSearch ? t('providers.noSearchResults') : t('providers.noProviders')}
              />
            )}
          </>
        ) : (
          <CollapsibleItemList
            entries={collapsedEntries}
            collapsed={collapsed}
            emptyText={providerSearch ? t('providers.noSearchResults') : t('providers.noProviders')}
            onSelect={onSelectProvider}
            renderExpandedItem={(entry, { compact }) => (
              <List.Item
                key={entry.id}
                onClick={() => onSelectProvider?.(entry.id)}
                className={entry.isSelected ? `side-panel-row side-panel-row-active ${compact ? 'side-panel-row-compact' : ''}`.trim() : `side-panel-row ${compact ? 'side-panel-row-compact' : ''}`.trim()}
              >
                <Tooltip placement="right" title={compact ? entry.label : null}>
                  <Text ellipsis>{entry.label}</Text>
                </Tooltip>
              </List.Item>
            )}
          />
        )}
      </Space>
    </CollapsibleSidePanel>
  );
}

function ModelTuningCard({
  currentProvider,
  model,
  onPatchModel
}) {
  const { t } = useI18n();

  return (
    <Card
      key={model.id}
      className="page-card"
      size="small"
      title={(
        <Space wrap size={[8, 8]}>
          <Title level={5} style={{ margin: 0 }}>{model.modelName}</Title>
          {model.id === currentProvider.defaultModelId && <Tag color="green">{t('providers.defaultModel')}</Tag>}
          {model.enabled === false && <Tag>{t('common.disabled')}</Tag>}
        </Space>
      )}
    >
      <Space direction="vertical" size={16} style={{ display: 'flex' }}>
        <Input
          addonBefore={t('providers.concurrencyLimit')}
          value={model.concurrencyLimit ?? 1}
          onChange={(event) => onPatchModel?.(model.id, 'concurrencyLimit', Math.max(1, Number(event.target.value || 1)))}
        />
        <Input
          addonBefore={t('providers.retryAttempts')}
          value={model.retryAttempts ?? 2}
          onChange={(event) => onPatchModel?.(model.id, 'retryAttempts', Math.max(0, Number(event.target.value || 0)))}
        />
        <Space wrap size={[8, 8]}>
          <Switch checked={model.retryEnabled !== false} onChange={(checked) => onPatchModel?.(model.id, 'retryEnabled', checked)} />
          <Text>{t('providers.retryEnabled')}</Text>
        </Space>
        <Input
          placeholder={t('providers.rateLimitHint')}
          value={model.rateLimitHint || ''}
          onChange={(event) => onPatchModel?.(model.id, 'rateLimitHint', event.target.value)}
        />
        <Select
          value={model.responseFormat || ''}
          onChange={(value) => onPatchModel?.(model.id, 'responseFormat', value)}
          options={[
            { value: '', label: t('providers.responseFormatInherit') },
            { value: 'auto', label: t('providers.responseFormatAuto') },
            { value: 'json_schema', label: t('providers.responseFormatJsonSchema') },
            { value: 'json_object', label: t('providers.responseFormatJsonObject') },
            { value: 'text', label: t('providers.responseFormatText') }
          ]}
        />
        <Space wrap size={[8, 8]}>
          <Switch checked={model.promptCacheEnabled === true} onChange={(checked) => onPatchModel?.(model.id, 'promptCacheEnabled', checked)} />
          <Text>{t('providers.promptCacheEnabled')}</Text>
        </Space>
        <Input
          placeholder={t('providers.promptCacheTtlHint')}
          value={model.promptCacheTtlHint || ''}
          onChange={(event) => onPatchModel?.(model.id, 'promptCacheTtlHint', event.target.value)}
        />
        <Input.TextArea
          rows={3}
          value={model.notes || ''}
          placeholder={t('providers.modelNotesHint')}
          onChange={(event) => onPatchModel?.(model.id, 'notes', event.target.value)}
        />
      </Space>
    </Card>
  );
}

export function AdvancedTuningPage(props) {
  const {
    currentProvider,
    filteredProviders,
    groupedProviders,
    providerItems,
    providerSearch,
    getEnabledModelCount,
    getProviderModelCount,
    getStatusTagMeta,
    isDraftProvider,
    onCreateProvider,
    onPatchModel,
    onProviderSearchChange,
    onSelectProvider
  } = props;
  const { t } = useI18n();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <Row gutter={[20, 20]}>
      <Col xs={24} xl={getPanelColumnSpan(sidebarCollapsed)}>
        <ProviderCatalog
          filteredProviders={filteredProviders}
          groupedProviders={groupedProviders}
          providerItems={providerItems}
          providerSearch={providerSearch}
          currentProvider={currentProvider}
          onCreateProvider={onCreateProvider}
          onProviderSearchChange={onProviderSearchChange}
          onSelectProvider={onSelectProvider}
          getEnabledModelCount={getEnabledModelCount}
          getProviderModelCount={getProviderModelCount}
          getStatusTagMeta={getStatusTagMeta}
          isDraftProvider={isDraftProvider}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
          expandLabel={t('common.expandSidebar')}
          collapseLabel={t('common.collapseSidebar')}
        />
      </Col>
      <Col xs={24} xl={getPanelContentSpan(sidebarCollapsed)}>
        {currentProvider ? (
          <Space direction="vertical" size={18} style={{ display: 'flex' }}>
            <Card className="page-card">
              <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                <Text type="secondary">{t('providers.inspector')}</Text>
                <Title level={3} style={{ margin: 0 }}>{currentProvider.name}</Title>
                <Text type="secondary">{t('providers.modelsHint')}</Text>
              </Space>
            </Card>

            {(currentProvider.models || []).length ? (
              (currentProvider.models || []).map((model) => (
                <ModelTuningCard
                  key={model.id}
                  currentProvider={currentProvider}
                  model={model}
                  onPatchModel={onPatchModel}
                />
              ))
            ) : (
              <Card className="page-card">
                <Empty description={t('providers.noModelsDiscovered')} />
              </Card>
            )}
          </Space>
        ) : (
          <Card className="page-card">
            <Empty description={t('providers.createProviderFirst')} />
          </Card>
        )}
      </Col>
    </Row>
  );
}

export default AdvancedTuningPage;
