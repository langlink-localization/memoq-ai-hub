import { MoreOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Dropdown,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Radio,
  Row,
  Select,
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
import { TABLE_COLUMN_WIDTHS } from '../../tableLayout.mjs';
import { getProviderConnectionHelperText, isProviderConnectionTestDisabled } from '../../providerConnectionUx.mjs';
import { activateOnKeyboard } from '../../uiBehavior.mjs';

const { Text, Title } = Typography;
const TABLE_SCROLL_X = 'max-content';
const MODEL_LIBRARY_MODAL_WIDTH = 'min(920px, calc(100vw - 32px))';

function getProviderThroughputSummary(provider, t) {
  const capabilities = provider?.capabilities || {};
  const mode = capabilities.throughputMode || 'auto';
  const maxBatchSegments = Number(capabilities.maxBatchSegments || (provider?.type === 'openai-compatible' ? 5 : 8));
  const maxBatchCharacters = Number(capabilities.maxBatchCharacters || (provider?.type === 'openai-compatible' ? 6000 : 12000));
  const defaultModel = (provider?.models || []).find((model) => model?.id === provider?.defaultModelId)
    || (provider?.models || []).find((model) => model?.enabled !== false)
    || {};
  const concurrency = Number(defaultModel.providerConcurrency || (provider?.type === 'openai-compatible' ? 2 : 2));
  return t('providers.throughputStatusValue', {
    mode: t(`providers.throughputMode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`),
    segments: maxBatchSegments,
    concurrency
  }) + ` (${t('providers.characterCount', { count: maxBatchCharacters })})`;
}

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
      <Space direction="vertical" size={16} className="app-block-space">
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
                    role="listbox"
                    dataSource={group.items}
                    renderItem={(item) => {
                      const tagMeta = getStatusTagMeta(item.status, t);
                      return (
                        <List.Item
                          role="option"
                          tabIndex={0}
                          aria-selected={item.id === currentProvider?.id}
                          onClick={() => onSelectProvider?.(item.id)}
                          onKeyDown={(event) => activateOnKeyboard(event, () => onSelectProvider?.(item.id))}
                          className={item.id === currentProvider?.id ? 'provider-list-item provider-list-item-active' : 'provider-list-item'}
                        >
                          <Space direction="vertical" size={6} className="app-full-width">
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
                role="option"
                tabIndex={0}
                aria-selected={entry.isSelected}
                onClick={() => onSelectProvider?.(entry.id)}
                onKeyDown={(event) => activateOnKeyboard(event, () => onSelectProvider?.(entry.id))}
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
  isDirty,
  isDraftProvider
}) {
  const { t } = useI18n();
  const editorActionMenu = {
    items: [
      { key: 'discard', danger: true, label: t('providers.discardChanges'), disabled: !isDirty || savingProvider },
      { key: 'delete', danger: true, label: t('providers.deleteProvider'), disabled: savingProvider }
    ],
    onClick: ({ key }) => {
      if (key === 'discard') onDiscardProviderChanges();
      if (key === 'delete') onDeleteProvider();
    }
  };

  return (
    <Card
      className="page-card provider-inspector-shell"
      extra={(
        <Space wrap className="responsive-action-bar">
          <Button
            loading={savingProvider}
            type="primary"
            icon={<SaveOutlined />}
            onClick={onSaveProvider}
            disabled={currentProviderConnectionMeta.color !== 'green'}
          >
            {t('common.save')}
          </Button>
          <Dropdown menu={editorActionMenu} trigger={['click']}>
            <Button icon={<MoreOutlined />}>{t('common.more')}</Button>
          </Dropdown>
        </Space>
      )}
    >
      <div className="provider-hero">
        <div className="provider-hero-main">
          <Text type="secondary">{t('providers.inspector')}</Text>
          <div className="provider-hero-title-row">
            <Title level={3} className="provider-title">{currentProvider.name}</Title>
            <Space wrap size={[8, 8]}>
              <Text strong>{t('providers.enabled')}</Text>
              <Switch checked={currentProvider.enabled} onChange={(checked) => onPatchProvider?.('enabled', checked)} />
            </Space>
          </div>
          <Space wrap size={[8, 8]}>
            <Tag color="blue">{getProviderTypeLabel(currentProvider.type, t)}</Tag>
            <Tag color={currentProviderConnectionMeta.color}>{currentProviderConnectionMeta.label}</Tag>
            {isDraftProvider(currentProvider) && <Tag>{t('providers.draft')}</Tag>}
            {isDirty ? <Tag color="orange">{t('common.unsavedChanges')}</Tag> : null}
          </Space>
        </div>
      </div>
    </Card>
  );
}

function ProviderModelTable({
  currentProvider,
  focusedModelName,
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
  const normalizedFocusedModelName = String(focusedModelName || '').trim().toLowerCase();

  return (
    <>
      <div className="provider-model-toolbar">
        <div>
          <Text strong>{t('providers.modelsTitle')}</Text>
          <div><Text type="secondary">{t('providers.modelsHint')}</Text></div>
        </div>
        <Space wrap size={[10, 10]} className="responsive-action-bar">
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
        scroll={{ x: TABLE_SCROLL_X }}
        dataSource={rows}
        rowClassName={(record) => (
          normalizedFocusedModelName && String(record.modelName || '').trim().toLowerCase() === normalizedFocusedModelName
            ? 'provider-model-row-focused'
            : ''
        )}
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
                {normalizedFocusedModelName && String(record.modelName || '').trim().toLowerCase() === normalizedFocusedModelName && <Tag color="blue">{t('providers.focusedModel')}</Tag>}
              </Space>
            )
          },
          {
            title: t('providers.defaultModel'),
            width: TABLE_COLUMN_WIDTHS.booleanControl,
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
            width: TABLE_COLUMN_WIDTHS.booleanControl,
            render: (_, record) => (
              <Switch checked={record.enabled !== false} onChange={(checked) => onPatchModel?.(record.id, 'enabled', checked)} />
            )
          },
          {
            title: t('providers.actions'),
            width: TABLE_COLUMN_WIDTHS.singleAction,
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
      width={MODEL_LIBRARY_MODAL_WIDTH}
      destroyOnClose={false}
    >
      <Space direction="vertical" size={16} className="app-block-space">
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
    focusedModelName,
    insightFocus,
    isDirty,
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
    onBackToHistory,
    onClearInsightFocus,
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
  const insightFocusProviderName = String(insightFocus?.provider || currentProvider?.name || '').trim();
  const insightFocusModelName = String(insightFocus?.model || focusedModelName || '').trim();
  const addProviderMenu = {
    items: [
      { key: 'openai', label: t('providers.addOpenAIOfficial') },
      { key: 'openai-compatible', label: t('providers.addOpenAICompatible') }
    ],
    onClick: ({ key }) => onCreateProvider?.(key)
  };

  return (
    <Row gutter={[16, 16]}>
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
          <Space direction="vertical" size={16} className="app-block-space">
            {insightFocus ? (
              <Alert
                type="info"
                showIcon
                className="provider-insight-focus-alert"
                message={t('providers.insightFocusTitle')}
                description={insightFocusModelName
                  ? t('providers.insightFocusDescription', { provider: insightFocusProviderName || '-', model: insightFocusModelName })
                  : t('providers.insightFocusProviderDescription', { provider: insightFocusProviderName || '-' })}
                action={(
                  <Space wrap size={[8, 8]}>
                    <Button size="small" onClick={onBackToHistory}>{t('providers.backToHistory')}</Button>
                    <Button size="small" onClick={onClearInsightFocus}>{t('common.dismiss')}</Button>
                  </Space>
                )}
              />
            ) : null}
            <ProviderHeader
              currentProvider={currentProvider}
              currentProviderConnectionMeta={currentProviderConnectionMeta}
              savingProvider={savingProvider}
              onDeleteProvider={onDeleteProvider}
              onDiscardProviderChanges={onDiscardProviderChanges}
              onPatchProvider={onPatchProvider}
              onSaveProvider={onSaveProvider}
              getProviderTypeLabel={getProviderTypeLabel}
              isDirty={isDirty}
              isDraftProvider={isDraftProvider}
            />
            <ProviderHealthPanel
              connectionSnapshot={currentProviderConnectionSnapshot}
              formatLocalTimestamp={formatLocalTimestamp}
            />

            <Card className="page-card" title={t('providers.configuration')}>
              <Form layout="vertical" component="div" className="provider-configuration-form">
                <Form.Item label={t('providers.name')}>
                  <Input value={currentProvider.name || ''} onChange={(event) => onPatchProvider?.('name', event.target.value)} />
                </Form.Item>

                <Form.Item
                  label={t('providers.apiKey')}
                  validateStatus={currentProviderConnectionMeta.color === 'red' ? 'error' : undefined}
                  help={currentProviderHelperText}
                >
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
                </Form.Item>

                <Form.Item
                  label={t('providers.baseUrl')}
                  extra={t('providers.requestUrlHint', { value: buildProviderRequestPreview(currentProvider) || t('providers.notAvailable') })}
                >
                  <Input value={currentProvider.baseUrl} onChange={(event) => onPatchProvider?.('baseUrl', event.target.value)} />
                </Form.Item>

                {currentProvider.type === 'openai-compatible' && (
                  <Form.Item label={t('providers.requestPath')}>
                    <Input value={currentProvider.requestPath || ''} onChange={(event) => onPatchProvider?.('requestPath', event.target.value)} />
                  </Form.Item>
                )}

                <Collapse
                  className="provider-advanced-collapse"
                  items={[{
                    key: 'advanced',
                    label: (
                      <Space direction="vertical" size={0}>
                        <Text strong>{t('providers.advancedConfiguration')}</Text>
                        <Text type="secondary">{t('providers.advancedConfigurationHint')}</Text>
                      </Space>
                    ),
                    children: (
                      <Space direction="vertical" size={16} className="app-block-space">
                        <Space direction="vertical" size={8} className="app-block-space">
                  <Text strong>{t('providers.responseFormatDefault')}</Text>
                  <Select
                    value={currentProvider.capabilities?.responseFormat || (currentProvider.type === 'openai-compatible' ? 'auto' : 'json_schema')}
                    onChange={(value) => onPatchProvider?.('capabilities', {
                      ...(currentProvider.capabilities || {}),
                      responseFormat: value
                    })}
                    options={[
                      { value: 'auto', label: t('providers.responseFormatAuto') },
                      { value: 'json_schema', label: t('providers.responseFormatJsonSchema') },
                      { value: 'json_object', label: t('providers.responseFormatJsonObject') },
                      { value: 'text', label: t('providers.responseFormatText') }
                    ]}
                  />
                  <Text type="secondary">{t('providers.responseFormatDefaultHint')}</Text>
                        </Space>

                <Space direction="vertical" size={8} className="app-block-space">
                  <Text strong>{t('providers.throughputModeDefault')}</Text>
                  <Select
                    value={currentProvider.capabilities?.throughputMode || 'auto'}
                    onChange={(value) => onPatchProvider?.('capabilities', {
                      ...(currentProvider.capabilities || {}),
                      throughputMode: value
                    })}
                    options={[
                      { value: 'auto', label: t('providers.throughputModeAuto') },
                      { value: 'reliable', label: t('providers.throughputModeReliable') },
                      { value: 'fast', label: t('providers.throughputModeFast') },
                      { value: 'custom', label: t('providers.throughputModeCustom') }
                    ]}
                  />
                  <Text type="secondary">{getProviderThroughputSummary(currentProvider, t)}</Text>
                  <Alert
                    type="info"
                    showIcon
                    message={t('providers.memoqParallelismNoticeTitle')}
                    description={t('providers.memoqParallelismNotice')}
                  />
                        </Space>
                      </Space>
                    )
                  }]}
                />

                <ProviderModelTable
                  currentProvider={currentProvider}
                  focusedModelName={focusedModelName}
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
              </Form>
            </Card>
          </Space>
        ) : (
          <Card className="page-card">
            <Empty description={t('providers.createProviderFirst')}>
              <Dropdown menu={addProviderMenu} trigger={['click']}>
                <Button type="primary" icon={<PlusOutlined />}>{t('common.add')}</Button>
              </Dropdown>
            </Empty>
          </Card>
        )}
      </Col>
    </Row>
  );
}

export default ProvidersPage;
