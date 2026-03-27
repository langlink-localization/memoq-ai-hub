import { PlusOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Dropdown,
  Empty,
  Input,
  List,
  Modal,
  Radio,
  Row,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd';
import { useState } from 'react';
import {
  buildCollapsiblePanelEntries,
  buildProviderModelTableRows,
  getPanelColumnSpan,
  getPanelContentSpan
} from '../../appShell.mjs';
import { CollapsibleItemList, CollapsibleSidePanel, SidePanelMeta } from '../../components/CollapsibleSidePanel';
import { useI18n } from '../../i18n';
import { getProviderConnectionHelperText, isProviderConnectionTestDisabled } from '../../providerConnectionUx.mjs';

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
  const addProviderMenu = {
    items: [
      { key: 'openai', label: t('providers.addOpenAIOfficial') },
      { key: 'openai-compatible', label: t('providers.addOpenAICompatible') }
    ],
    onClick: ({ key }) => onCreateProvider?.(key)
  };
  const collapsedEntries = buildCollapsiblePanelEntries(filteredProviders, {
    selectedId: currentProvider?.id,
    emptyLabel: t('providers.untitledProvider'),
    getDescription: (provider) => provider.baseUrl
  });

  return (
    <CollapsibleSidePanel
      title={t('providers.title')}
      collapsed={collapsed}
      onToggle={onToggleCollapsed}
      expandLabel={expandLabel}
      collapseLabel={collapseLabel}
      className="provider-catalog-card"
      extra={(
        <Dropdown
          menu={addProviderMenu}
          trigger={['click']}
        >
          <Button size="small" icon={<PlusOutlined />}>{t('common.add')}</Button>
        </Dropdown>
      )}
      collapsedExtra={(
        <Dropdown menu={addProviderMenu} trigger={['click']}>
          <Button size="small" icon={<PlusOutlined />} aria-label={t('common.add')} />
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
                            <Tooltip title={item.baseUrl}>
                              <Text type="secondary" className="provider-list-subtitle">{item.baseUrl}</Text>
                            </Tooltip>
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

function ProviderHeader({
  currentProvider,
  currentProviderConnectionMeta,
  savingProvider,
  onDeleteProvider,
  onDiscardProviderChanges,
  onPatchProvider,
  onSaveProvider,
  getProviderTypeLabel,
  isDraftProvider
}) {
  const { t } = useI18n();

  return (
    <Card className="page-card provider-inspector-shell">
      <div className="provider-hero">
        <div className="provider-hero-main">
          <Text type="secondary">{t('providers.inspector')}</Text>
          <div className="provider-hero-title-row">
            <Title level={3} style={{ margin: 0 }}>{currentProvider.name}</Title>
            <Space wrap size={[8, 8]}>
              <Text strong>{t('providers.enabled')}</Text>
              <Switch checked={currentProvider.enabled} onChange={(checked) => onPatchProvider?.('enabled', checked)} />
            </Space>
          </div>
          <Space wrap size={[8, 8]}>
            <Tag color="blue">{getProviderTypeLabel(currentProvider.type, t)}</Tag>
            <Tag color={currentProviderConnectionMeta.color}>{currentProviderConnectionMeta.label}</Tag>
            {isDraftProvider(currentProvider) && <Tag>{t('providers.draft')}</Tag>}
          </Space>
        </div>
        <Space wrap size={[10, 10]} className="provider-hero-actions">
          <Button onClick={onDiscardProviderChanges}>{t('providers.discardChanges')}</Button>
          <Button danger onClick={onDeleteProvider}>{t('providers.deleteProvider')}</Button>
          <Button
            loading={savingProvider}
            type="primary"
            icon={<SaveOutlined />}
            onClick={onSaveProvider}
            disabled={currentProviderConnectionMeta.color !== 'green'}
          >
            {t('common.save')}
          </Button>
        </Space>
      </div>
    </Card>
  );
}

function ProviderModelTable({
  currentProvider,
  providerModelSelection,
  onConfirmBulkDeleteModels,
  onOpenProviderModelManager,
  onPatchModel,
  onProviderModelSelectionChange,
  onSetCurrentProviderDefaultModel,
  onConfirmDeleteModel
}) {
  const { t } = useI18n();
  const rows = buildProviderModelTableRows(currentProvider);

  return (
    <>
      <div className="provider-model-toolbar">
        <div>
          <Text strong>{t('providers.modelsTitle')}</Text>
          <div><Text type="secondary">{t('providers.modelsHint')}</Text></div>
        </div>
        <Space wrap size={[10, 10]}>
          <Button icon={<PlusOutlined />} onClick={onOpenProviderModelManager}>{t('providers.addModel')}</Button>
          <Button
            danger
            disabled={!providerModelSelection.length}
            onClick={onConfirmBulkDeleteModels}
          >
            {t('providers.removeSelected', { count: providerModelSelection.length })}
          </Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        pagination={false}
        dataSource={rows}
        rowSelection={{
          selectedRowKeys: providerModelSelection,
          onChange: (selectedRowKeys) => onProviderModelSelectionChange?.(selectedRowKeys)
        }}
        columns={[
          {
            title: t('providers.model'),
            dataIndex: 'modelName',
            render: (_, record) => (
              <Space wrap size={[8, 8]}>
                <Input value={record.modelName} onChange={(event) => onPatchModel?.(record.id, 'modelName', event.target.value)} />
                {record.id === currentProvider.defaultModelId && <Tag color="green">{t('providers.defaultModel')}</Tag>}
              </Space>
            )
          },
          {
            title: t('providers.defaultModel'),
            width: 120,
            align: 'center',
            render: (_, record) => (
              <Radio
                checked={record.isDefault}
                aria-label={t('providers.setDefaultModelFor', { name: record.modelName })}
                onChange={() => onSetCurrentProviderDefaultModel?.(record.id)}
              />
            )
          },
          {
            title: t('providers.modelEnabled'),
            width: 120,
            render: (_, record) => (
              <Switch checked={record.enabled !== false} onChange={(checked) => onPatchModel?.(record.id, 'enabled', checked)} />
            )
          },
          {
            title: t('providers.actions'),
            width: 140,
            render: (_, record) => (
              <Space wrap size={[8, 8]}>
                <Button danger type="link" onClick={() => onConfirmDeleteModel?.(record)}>{t('providers.deleteModel')}</Button>
              </Space>
            )
          }
        ]}
      />
    </>
  );
}

function ProviderModelLibraryModal({
  currentProvider,
  providerModelManagerOpen,
  providerModelSearch,
  discoveringProviderModels,
  filteredCurrentProviderModelCatalog,
  onAddModelToCurrentProvider,
  onCloseProviderModelManager,
  onDiscoverProviderModels,
  onProviderModelSearchChange,
  onRemoveModelFromCurrentProvider
}) {
  const { t } = useI18n();

  return (
    <Modal
      title={t('providers.modelLibraryTitle', { provider: currentProvider.name })}
      open={providerModelManagerOpen}
      onCancel={onCloseProviderModelManager}
      footer={null}
      width={920}
      destroyOnClose={false}
    >
      <Space direction="vertical" size={16} style={{ display: 'flex' }}>
        <div className="provider-model-manager-toolbar">
          <Input.Search
            allowClear
            value={providerModelSearch}
            onChange={(event) => onProviderModelSearchChange?.(event.target.value)}
            placeholder={t('providers.modelLibrarySearchPlaceholder')}
          />
          <Button icon={<ReloadOutlined />} loading={discoveringProviderModels} onClick={onDiscoverProviderModels}>
            {t('providers.discoverModels')}
          </Button>
        </div>
        <div className="provider-model-manager-list">
          <List
            dataSource={filteredCurrentProviderModelCatalog}
            locale={{ emptyText: t('providers.noModelsDiscovered') }}
            renderItem={(modelName) => {
              const existingModel = (currentProvider.models || []).find((model) => String(model.modelName || '').trim().toLowerCase() === modelName.toLowerCase());
              return (
                <List.Item
                  className={existingModel ? 'provider-model-library-item provider-model-library-item-active' : 'provider-model-library-item'}
                  actions={[
                    existingModel ? (
                      <Button
                        key="remove"
                        type="text"
                        danger
                        onClick={() => onRemoveModelFromCurrentProvider?.(existingModel)}
                      >
                        {t('providers.removeModel')}
                      </Button>
                    ) : (
                      <Button key="add" type="primary" ghost onClick={() => onAddModelToCurrentProvider?.(modelName)}>
                        {t('providers.addModel')}
                      </Button>
                    )
                  ]}
                >
                  <Space direction="vertical" size={4}>
                    <Text strong>{modelName}</Text>
                    <Text type="secondary">
                      {existingModel ? t('providers.modelEnabledInList') : t('providers.modelAvailableToAdd')}
                    </Text>
                  </Space>
                </List.Item>
              );
            }}
          />
        </div>
      </Space>
    </Modal>
  );
}

function ProviderHealthPanel({
  connectionSnapshot,
  formatLocalTimestamp
}) {
  const { t } = useI18n();
  const status = String(connectionSnapshot?.status || 'not_tested');
  const testedAt = String(connectionSnapshot?.testedAt || '').trim();
  const lastError = String(connectionSnapshot?.lastError || '').trim();
  const latencyMs = Number.isFinite(connectionSnapshot?.latencyMs) ? connectionSnapshot.latencyMs : null;
  const hasPreviousTest = connectionSnapshot?.hasPreviousTest === true;

  return (
    <>
      <Descriptions column={1} size="small">
        <Descriptions.Item label={t('providers.lastHealthTitle')}>
          {status === 'connected' && Number.isFinite(latencyMs)
            ? t('providers.lastLatencyMs', { value: latencyMs })
            : status === 'failed'
              ? t('providers.statusFailed')
              : hasPreviousTest
                ? t('providers.testAfterChangesHint')
                : t('providers.noHealthData')}
        </Descriptions.Item>
        <Descriptions.Item label={t('providers.lastCheckedAt')}>
          {testedAt ? formatLocalTimestamp(testedAt, t('providers.notAvailable')) : t('providers.notAvailable')}
        </Descriptions.Item>
      </Descriptions>

      {lastError && (
        <Alert
          type="error"
          showIcon
          message={t('providers.lastError')}
          description={lastError}
        />
      )}
    </>
  );
}

export function ProvidersPage(props) {
  const {
    buildProviderRequestPreview,
    currentProvider,
    currentProviderConnectionMeta,
    currentProviderConnectionSnapshot,
    currentProviderConnectionStatus,
    currentProviderHasPreviousTest,
    currentProviderTestMessage,
    discoveringProviderModels,
    filteredCurrentProviderModelCatalog,
    filteredProviders,
    formatLocalTimestamp,
    getEnabledModelCount,
    getProviderModelCount,
    getProviderTypeLabel,
    getStatusTagMeta,
    groupedProviders,
    isDraftProvider,
    onAddModelToCurrentProvider,
    onCloseProviderModelManager,
    onConfirmBulkDeleteModels,
    onConfirmDeleteModel,
    onCreateProvider,
    onDeleteProvider,
    onDiscardProviderChanges,
    onDiscoverProviderModels,
    onOpenProviderModelManager,
    onPatchModel,
    onPatchProvider,
    onProviderModelSearchChange,
    onProviderModelSelectionChange,
    onProviderSearchChange,
    onRemoveModelFromCurrentProvider,
    onSaveProvider,
    onSelectProvider,
    onSetCurrentProviderDefaultModel,
    onTestProvider,
    providerItems,
    providerModelManagerOpen,
    providerModelSearch,
    providerModelSelection,
    providerSearch,
    savingProvider,
    testingProvider
  } = props;
  const { t } = useI18n();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const currentProviderHelperText = getProviderConnectionHelperText({
    provider: currentProvider,
    status: currentProviderConnectionStatus,
    statusLabel: currentProviderConnectionMeta.label,
    message: currentProviderTestMessage,
    hasPreviousTest: currentProviderHasPreviousTest,
    t
  });
  const isTestConnectionDisabled = isProviderConnectionTestDisabled(currentProvider, testingProvider);

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
            <ProviderHeader
              currentProvider={currentProvider}
              currentProviderConnectionMeta={currentProviderConnectionMeta}
              savingProvider={savingProvider}
              onDeleteProvider={onDeleteProvider}
              onDiscardProviderChanges={onDiscardProviderChanges}
              onPatchProvider={onPatchProvider}
              onSaveProvider={onSaveProvider}
              getProviderTypeLabel={getProviderTypeLabel}
              isDraftProvider={isDraftProvider}
            />

            <Card className="page-card" title={t('providers.configuration')}>
              <Space direction="vertical" size={18} style={{ display: 'flex' }}>
                <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                  <Text strong>{t('providers.name')}</Text>
                  <Input value={currentProvider.name || ''} onChange={(event) => onPatchProvider?.('name', event.target.value)} />
                </Space>

                <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                  <Text strong>{t('providers.apiKey')}</Text>
                  <div className="provider-inline-field">
                    <Input.Password
                      value={currentProvider.apiKey || ''}
                      onChange={(event) => onPatchProvider?.('apiKey', event.target.value)}
                      placeholder={t('providers.pasteApiKey')}
                    />
                    <Button
                      loading={testingProvider}
                      disabled={isTestConnectionDisabled}
                      onClick={onTestProvider}
                    >
                      {t('providers.testBeforeSave')}
                    </Button>
                  </div>
                  <Text type={currentProviderConnectionMeta.color === 'red' ? 'danger' : 'secondary'}>
                    {currentProviderHelperText}
                  </Text>
                </Space>

                <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                  <Text strong>{t('providers.baseUrl')}</Text>
                  <Input value={currentProvider.baseUrl} onChange={(event) => onPatchProvider?.('baseUrl', event.target.value)} />
                  <Text type="secondary">
                    {t('providers.requestUrlHint', { value: buildProviderRequestPreview(currentProvider) || t('providers.notAvailable') })}
                  </Text>
                </Space>

                {currentProvider.type === 'openai-compatible' && (
                  <Space direction="vertical" size={8} style={{ display: 'flex' }}>
                    <Text strong>{t('providers.requestPath')}</Text>
                    <Input value={currentProvider.requestPath || ''} onChange={(event) => onPatchProvider?.('requestPath', event.target.value)} />
                  </Space>
                )}

                <ProviderModelTable
                  currentProvider={currentProvider}
                  providerModelSelection={providerModelSelection}
                  onConfirmBulkDeleteModels={onConfirmBulkDeleteModels}
                  onOpenProviderModelManager={onOpenProviderModelManager}
                  onPatchModel={onPatchModel}
                  onProviderModelSelectionChange={onProviderModelSelectionChange}
                  onSetCurrentProviderDefaultModel={onSetCurrentProviderDefaultModel}
                  onConfirmDeleteModel={onConfirmDeleteModel}
                />

                <ProviderModelLibraryModal
                  currentProvider={currentProvider}
                  providerModelManagerOpen={providerModelManagerOpen}
                  providerModelSearch={providerModelSearch}
                  discoveringProviderModels={discoveringProviderModels}
                  filteredCurrentProviderModelCatalog={filteredCurrentProviderModelCatalog}
                  onAddModelToCurrentProvider={onAddModelToCurrentProvider}
                  onCloseProviderModelManager={onCloseProviderModelManager}
                  onDiscoverProviderModels={onDiscoverProviderModels}
                  onProviderModelSearchChange={onProviderModelSearchChange}
                  onRemoveModelFromCurrentProvider={onRemoveModelFromCurrentProvider}
                />

                <ProviderHealthPanel
                  connectionSnapshot={currentProviderConnectionSnapshot}
                  formatLocalTimestamp={formatLocalTimestamp}
                />
              </Space>
            </Card>
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

export default ProvidersPage;
