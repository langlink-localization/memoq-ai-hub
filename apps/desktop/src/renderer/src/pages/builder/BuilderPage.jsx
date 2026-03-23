import { PlusOutlined, SaveOutlined, StarOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Dropdown,
  Drawer,
  Empty,
  Input,
  List,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography
} from 'antd';
import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  buildCollapsiblePanelEntries,
  getPanelColumnSpan,
  getPanelContentSpan
} from '../../appShell.mjs';
import { CollapsibleItemList, CollapsibleSidePanel, ProfileListRow } from '../../components/CollapsibleSidePanel';

const { Paragraph, Text } = Typography;

const STYLE_PRESETS = [
  {
    key: 'natural',
    text: 'Prefer natural, concise, production-ready translations that stay consistent with product terminology.'
  },
  {
    key: 'formal',
    text: 'Prefer formal, precise wording with a professional tone and stable terminology.'
  },
  {
    key: 'technical',
    text: 'Prefer technically accurate, explicit phrasing that preserves instructions, constraints, and domain terminology.'
  },
  {
    key: 'marketing',
    text: 'Prefer fluent, appealing copy that reads naturally to end users while keeping required terms intact.'
  },
  {
    key: 'ui',
    text: 'Prefer short, clear UI-style wording suitable for buttons, menus, labels, and product microcopy.'
  }
];
const ROUTE_CONFIGS = [
  { key: 'interactive', providerField: 'interactiveProviderId', modelField: 'interactiveModelId', titleKey: 'context.routeInteractiveTitle', hintKey: 'context.routeInteractiveHint' },
  { key: 'pretranslate', providerField: 'pretranslateProviderId', modelField: 'pretranslateModelId', titleKey: 'context.routePretranslateTitle', hintKey: 'context.routePretranslateHint' },
  { key: 'fallback', providerField: 'fallbackProviderId', modelField: 'fallbackModelId', titleKey: 'context.routeFallbackTitle', hintKey: 'context.routeFallbackHint' }
];
const ASSET_ROLE_CONFIGS = [
  {
    key: 'tb',
    type: 'glossary',
    titleKey: 'context.assetRoleTbTitle',
    hintKey: 'context.assetRoleTbHint',
    fieldCandidates: ['tbAssetId', 'glossaryAssetId']
  }
];

function getRouteProviderId(profile = {}, route) {
  return String(
    profile?.[route.providerField]
    || profile?.providerId
    || ''
  ).trim();
}

function getRouteModelId(profile = {}, route) {
  return String(profile?.[route.modelField] || '').trim();
}

function isSelectableProfileProvider(provider = {}) {
  return Boolean(provider?.id) && !String(provider.id || '').startsWith('draft_provider_');
}

function getPreferredProviderModel(provider, preferredModelId = '') {
  const models = Array.isArray(provider?.models) ? provider.models : [];
  const preferredId = String(preferredModelId || provider?.defaultModelId || '').trim();

  if (preferredId) {
    const explicit = models.find((model) => model?.id === preferredId && model?.enabled !== false);
    if (explicit) {
      return explicit;
    }
  }

  return models.find((model) => model?.enabled !== false) || models[0] || null;
}

function getLocalizedPlaceholderText(t, item, kind) {
  const key = `context.placeholder${kind}.${item.token}`;
  const localized = t(key);
  return localized === key ? item?.[kind.toLowerCase()] || '' : localized;
}

function getRoleAssetId(profile = {}, role) {
  const directField = role.fieldCandidates.find((fieldName) => profile?.[fieldName]);
  if (directField) {
    return String(profile[directField] || '');
  }

  const compositeSelections = profile?.assetRoleSelections && typeof profile.assetRoleSelections === 'object'
    ? profile.assetRoleSelections
    : profile?.selectedAssetsByRole && typeof profile.selectedAssetsByRole === 'object'
      ? profile.selectedAssetsByRole
      : null;

  if (compositeSelections?.[role.key]) {
    return String(compositeSelections[role.key] || '');
  }

  const matchingBinding = (profile?.assetBindings || []).find((binding) => binding?.purpose === role.type);
  return String(matchingBinding?.assetId || '');
}

function buildNextAssetSelections(profile = {}, role, assetId) {
  const currentSelections = profile?.assetSelections && typeof profile.assetSelections === 'object'
    ? profile.assetSelections
    : {};
  const nextSelections = {
    glossaryAssetId: String(currentSelections.glossaryAssetId || '')
  };
  const normalizedAssetId = String(assetId || '').trim();
  const fieldName = 'glossaryAssetId';

  nextSelections[fieldName] = normalizedAssetId;

  return Object.fromEntries(
    Object.entries(nextSelections).filter(([, value]) => String(value || '').trim())
  );
}

function ProfileListPanel({
  profileItems,
  currentProfileId,
  defaultProfileId,
  onSelectProfile,
  onCreateBlankProfile,
  onCreatePresetProfile,
  title,
  emptyText,
  collapsed,
  onToggleCollapsed,
  expandLabel,
  collapseLabel
}) {
  const { t } = useI18n();
  const addProfileMenu = {
    items: [
      { key: 'blank', label: t('context.createBlank') },
      { key: 'preset', label: t('context.createFromPreset') }
    ],
    onClick: ({ key }) => {
      if (key === 'blank') {
        onCreateBlankProfile?.();
        return;
      }
      onCreatePresetProfile?.();
    }
  };
  const entries = buildCollapsiblePanelEntries(profileItems, {
    selectedId: currentProfileId,
    emptyLabel: 'Untitled Profile',
    getTags: (profile) => {
      const tags = [];
      if (profile?.isPresetDerived === true) {
        tags.push({ key: 'preset', label: t('context.presetTag'), color: 'blue' });
      } else {
        tags.push({ key: 'custom', label: t('context.customTag') });
      }
      if (profile?.id === defaultProfileId) {
        tags.push({ key: 'default', label: t('context.defaultTag'), color: 'green' });
      }
      return tags;
    }
  });

  return (
    <CollapsibleSidePanel
      title={title}
      collapsed={collapsed}
      onToggle={onToggleCollapsed}
      expandLabel={expandLabel}
      collapseLabel={collapseLabel}
      extra={(
        <Dropdown
          menu={addProfileMenu}
          trigger={['click']}
        >
          <Button icon={<PlusOutlined />}>{t('common.add')}</Button>
        </Dropdown>
      )}
      collapsedExtra={(
        <Dropdown menu={addProfileMenu} trigger={['click']}>
          <Button icon={<PlusOutlined />} aria-label={t('common.add')} />
        </Dropdown>
      )}
    >
      <CollapsibleItemList
        entries={entries}
        collapsed={collapsed}
        emptyText={emptyText}
        onSelect={onSelectProfile}
        renderExpandedItem={(entry, { compact }) => (
          <ProfileListRow entry={entry} compact={compact} onClick={() => onSelectProfile(entry.id)} />
        )}
      />
    </CollapsibleSidePanel>
  );
}

function StepCard({ index, title, description, children, extra }) {
  return (
    <Card
      className="page-card builder-step-card"
      title={(
        <div className="builder-step-heading">
          <span className="builder-step-badge">{index}</span>
          <div>
            <div className="builder-step-title">{title}</div>
            {description ? <div className="builder-step-description">{description}</div> : null}
          </div>
        </div>
      )}
      extra={extra}
    >
      {children}
    </Card>
  );
}

function RouteSelectorCard({ route, profile, providers, onChange }) {
  const { t } = useI18n();
  const providerId = getRouteProviderId(profile, route);
  const modelId = getRouteModelId(profile, route);
  const providerOptions = providers
    .filter((provider) => isSelectableProfileProvider(provider))
    .map((provider) => ({ label: provider.name, value: provider.id }));
  const selectedProvider = providers.find((provider) => provider.id === providerId && isSelectableProfileProvider(provider)) || null;
  const selectedModelId = getPreferredProviderModel(selectedProvider, modelId)?.id || undefined;
  const modelOptions = (selectedProvider?.models || [])
    .filter((model) => model?.enabled !== false)
    .map((model) => ({ label: model.modelName, value: model.id }));

  return (
    <Card size="small" className="builder-subcard" title={t(route.titleKey)}>
      <Space direction="vertical" size={10} style={{ display: 'flex' }}>
        <Select
          value={providerId || undefined}
          options={providerOptions}
          placeholder={t('context.executionProviderPlaceholder')}
          onChange={(value) => onChange(route.providerField, value)}
        />
        <Select
          value={selectedModelId}
          options={modelOptions}
          placeholder={t('context.executionModelPlaceholder')}
          disabled={!providerId}
          onChange={(value) => onChange(route.modelField, value)}
        />
        <Text type="secondary">{t(route.hintKey)}</Text>
      </Space>
    </Card>
  );
}

function TranslationStyleCard({ profile, onChange }) {
  const { t } = useI18n();
  const currentStyle = String(profile?.translationStyle || '');
  const matchedPreset = STYLE_PRESETS.find((item) => item.text === currentStyle)?.key;

  return (
    <Card size="small" className="builder-subcard">
      <Space direction="vertical" size={12} style={{ display: 'flex' }}>
        <Text strong>{t('context.translationStyleTitle')}</Text>
        <Text type="secondary">{t('context.translationStyleHint')}</Text>
        <Select
          allowClear
          value={matchedPreset}
          placeholder={t('context.translationStylePresetPlaceholder')}
          options={STYLE_PRESETS.map((item) => ({
            value: item.key,
            label: t(`context.translationStylePreset.${item.key}`)
          }))}
          onChange={(value) => {
            const selected = STYLE_PRESETS.find((item) => item.key === value);
            if (selected) {
              onChange('translationStyle', selected.text);
            }
          }}
          onClear={() => onChange('translationStyle', '')}
        />
        <Input.TextArea
          rows={5}
          value={currentStyle}
          onChange={(event) => onChange('translationStyle', event.target.value)}
          placeholder={t('context.translationStylePlaceholder')}
        />
      </Space>
    </Card>
  );
}

function AssetRoleCard({ role, profile, assets, onChange }) {
  const { t } = useI18n();
  const selectedAssetId = getRoleAssetId(profile, role) || undefined;
  const options = assets
    .filter((asset) => asset?.type === role.type)
    .map((asset) => ({ label: asset.name, value: asset.id }));

  return (
    <Card size="small" className="builder-subcard" title={t(role.titleKey)}>
      <Space direction="vertical" size={10} style={{ display: 'flex' }}>
        <Select
          allowClear
          value={selectedAssetId}
          options={options}
          placeholder={t('context.assetSelectorPlaceholder')}
          onChange={(value) => onChange(role, value)}
        />
        <Text type="secondary">{t(role.hintKey)}</Text>
      </Space>
    </Card>
  );
}

function PlaceholderDrawer({ open, targetField, supportedPlaceholders, onClose, onInsert }) {
  const { t } = useI18n();

  return (
    <Drawer
      title={t('context.placeholderPanelTitle')}
      placement="right"
      width={420}
      open={open}
      onClose={onClose}
    >
      <Space direction="vertical" size={14} style={{ display: 'flex' }}>
        <Text type="secondary">
          {targetField ? t('context.placeholderDrawerHint', { field: t(`context.${targetField}`) }) : t('context.placeholderPanelHint')}
        </Text>
        <List
          size="small"
          dataSource={supportedPlaceholders}
          renderItem={(item) => (
            <List.Item
              className="builder-placeholder-item"
              onClick={() => onInsert(item.token)}
            >
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                <Text strong>{`{{${item.token}}}`}</Text>
                <Text>{getLocalizedPlaceholderText(t, item, 'Label')}</Text>
                <Text type="secondary">{getLocalizedPlaceholderText(t, item, 'Description')}</Text>
              </Space>
            </List.Item>
          )}
        />
        <Text type="secondary">{t('context.placeholderRequiredHint')}</Text>
        <Text type="secondary">{t('context.placeholderWrapperHint')}</Text>
      </Space>
    </Drawer>
  );
}

function BuilderEditor({
  profile,
  providers,
  assets,
  supportedPlaceholders,
  templateIssues,
  onChange,
  onSave,
  onDiscard,
  onDuplicate,
  onDelete,
  onSetDefault,
  isDefaultProfile
}) {
  const { t } = useI18n();
  const assetCounts = useMemo(() => ASSET_ROLE_CONFIGS.reduce((counts, role) => ({
    ...counts,
    [role.key]: assets.filter((asset) => asset?.type === role.type).length
  }), {}), [assets]);
  const toggleItems = [
    { field: 'useBestFuzzyTm', label: t('context.bestFuzzyLabel'), hint: t('context.bestFuzzyHint'), checked: profile?.useBestFuzzyTm },
    { field: 'useMetadata', label: t('context.metadataLabel'), hint: t('context.metadataHint'), checked: profile?.useMetadata },
    { field: 'cacheEnabled', label: t('context.cacheLabel'), hint: t('context.cacheHint'), checked: profile?.cacheEnabled !== false },
    { field: 'usePreviewContext', label: t('context.previewContextLabel'), hint: t('context.previewContextToggleHint'), checked: profile?.usePreviewContext === true },
    { field: 'usePreviewFullText', label: t('context.previewFullTextLabel'), hint: t('context.previewFullTextHint'), checked: profile?.usePreviewFullText === true, disabled: profile?.usePreviewContext !== true },
    { field: 'usePreviewSummary', label: t('context.previewSummaryLabel'), hint: t('context.previewSummaryHint'), checked: profile?.usePreviewSummary === true, disabled: profile?.usePreviewContext !== true },
    { field: 'usePreviewAboveBelow', label: t('context.previewWindowLabel'), hint: t('context.previewWindowHint'), checked: profile?.usePreviewAboveBelow === true, disabled: profile?.usePreviewContext !== true },
    { field: 'usePreviewTargetText', label: t('context.currentTargetLabel'), hint: t('context.currentTargetHint'), checked: profile?.usePreviewTargetText === true, disabled: profile?.usePreviewContext !== true }
  ];

  function handleAssetRoleChange(role, assetId) {
    onChange('assetSelections', buildNextAssetSelections(profile, role, assetId));
  }

  return (
    <>
      <Card
        className="page-card"
        title={t('context.profileEditor')}
        extra={(
          <Space wrap>
            <Button icon={<StarOutlined />} onClick={onSetDefault} disabled={isDefaultProfile}>
              {t('context.setAsDefaultProfile')}
            </Button>
            <Button onClick={onDuplicate}>{t('common.duplicate')}</Button>
            <Button onClick={onDiscard}>{t('context.discardChanges')}</Button>
            <Button danger onClick={onDelete}>{t('context.deleteProfile')}</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={onSave}>{t('context.saveProfile')}</Button>
          </Space>
        )}
      >
        <Space direction="vertical" size={18} style={{ display: 'flex' }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Input addonBefore={t('context.name')} value={profile?.name} onChange={(event) => onChange('name', event.target.value)} />
            </Col>
            <Col xs={24} md={12}>
              <Input addonBefore={t('context.description')} value={profile?.description} onChange={(event) => onChange('description', event.target.value)} />
            </Col>
          </Row>

          <div className="builder-step-stack">
            <StepCard
              index="01"
              title={t('context.builderStepProviderTitle')}
              description={t('context.builderStepProviderDescription')}
            >
              <Row gutter={[16, 16]}>
                {ROUTE_CONFIGS.map((route) => (
                  <Col xs={24} xl={8} key={route.key}>
                    <RouteSelectorCard route={route} profile={profile} providers={providers} onChange={onChange} />
                  </Col>
                ))}
              </Row>
            </StepCard>

            <StepCard
              index="02"
              title={t('context.builderStepPromptsTitle')}
              description={t('context.builderStepPromptsDescription')}
              extra={(
                <Space wrap>
                  <Tag color="blue">{t('context.promptManagedTag')}</Tag>
                  <Tag>{t('context.translationStyleTag')}</Tag>
                </Space>
              )}
            >
              <Space direction="vertical" size={16} style={{ display: 'flex' }}>
                <Alert
                  type="info"
                  showIcon
                  message={t('context.promptManagedTitle')}
                  description={t('context.promptManagedDescription')}
                />
                <Row gutter={[16, 16]}>
                  <Col xs={24} xl={14}>
                    <TranslationStyleCard profile={profile} onChange={onChange} />
                  </Col>
                  <Col xs={24} xl={10}>
                    <Card size="small" className="builder-subcard">
                      <Space direction="vertical" size={10} style={{ display: 'flex' }}>
                        <Text strong>{t('context.promptIncludedTitle')}</Text>
                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                          {t('context.promptIncludedHint')}
                        </Paragraph>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          <li>{t('context.promptIncludedItems.role')}</li>
                          <li>{t('context.promptIncludedItems.format')}</li>
                          <li>{t('context.promptIncludedItems.terminology')}</li>
                          <li>{t('context.promptIncludedItems.metadata')}</li>
                          <li>{t('context.promptIncludedItems.summary')}</li>
                          <li>{t('context.promptIncludedItems.segmentPayload')}</li>
                        </ul>
                      </Space>
                    </Card>
                  </Col>
                </Row>
              </Space>
            </StepCard>

            <StepCard
              index="03"
              title={t('context.builderStepAssetsTitle')}
              description={t('context.builderStepAssetsDescription')}
            >
              <Space direction="vertical" size={14} style={{ display: 'flex' }}>
                <div className="builder-asset-summary">
                  {ASSET_ROLE_CONFIGS.map((role) => (
                    <Tag key={role.key}>{`${t(role.titleKey)}: ${assetCounts[role.key] || 0}`}</Tag>
                  ))}
                </div>
                <Row gutter={[16, 16]}>
                  {ASSET_ROLE_CONFIGS.map((role) => (
                    <Col xs={24} xl={8} key={role.key}>
                      <AssetRoleCard role={role} profile={profile} assets={assets} onChange={handleAssetRoleChange} />
                    </Col>
                  ))}
                </Row>
                <Text type="secondary">{t('context.assetModuleHint')}</Text>
              </Space>
            </StepCard>

            <StepCard
              index="04"
              title={t('context.builderStepAdvancedTitle')}
              description={t('context.builderStepAdvancedDescription')}
            >
              <Collapse
                className="builder-advanced-collapse"
                defaultActiveKey={[]}
                items={[
                  {
                    key: 'advanced',
                    label: t('context.advancedCollapsedLabel'),
                    children: (
                      <Space direction="vertical" size={18} style={{ display: 'flex' }}>
                        <Alert
                          type="info"
                          showIcon
                          message={t('context.promptManagedTitle')}
                          description={t('context.advancedPromptTemplatesHint')}
                        />

                        <Row gutter={[16, 16]}>
                          {toggleItems.map((item) => (
                            <Col xs={24} md={12} key={item.field}>
                              <div className="profile-toggle-card">
                                <div className="profile-toggle-head">
                                  <Text strong>{item.label}</Text>
                                  <Switch checked={item.checked} disabled={item.disabled} onChange={(checked) => onChange(item.field, checked)} />
                                </div>
                                <Text type="secondary">{item.hint}</Text>
                              </div>
                            </Col>
                          ))}
                        </Row>

                        {profile?.usePreviewContext === true && profile?.usePreviewAboveBelow === true && (
                          <Space direction="vertical" size={14} style={{ display: 'flex' }}>
                            <Text type="secondary">{t('context.previewContextHint')}</Text>
                            <Row gutter={[16, 16]}>
                              <Col xs={24} md={12} xl={6}>
                                <Input addonBefore={t('context.previewAboveSegments')} value={profile?.previewAboveSegments} onChange={(event) => onChange('previewAboveSegments', Number(event.target.value || 0))} />
                              </Col>
                              <Col xs={24} md={12} xl={6}>
                                <Input addonBefore={t('context.previewAboveCharacters')} value={profile?.previewAboveCharacters} onChange={(event) => onChange('previewAboveCharacters', Number(event.target.value || 0))} />
                              </Col>
                              <Col xs={24} md={12} xl={6}>
                                <div className="builder-switch-line">
                                  <Switch checked={profile?.previewAboveIncludeSource === true} onChange={(checked) => onChange('previewAboveIncludeSource', checked)} />
                                  <Text>{t('context.previewAboveIncludeSource')}</Text>
                                </div>
                              </Col>
                              <Col xs={24} md={12} xl={6}>
                                <div className="builder-switch-line">
                                  <Switch checked={profile?.previewAboveIncludeTarget !== false} onChange={(checked) => onChange('previewAboveIncludeTarget', checked)} />
                                  <Text>{t('context.previewAboveIncludeTarget')}</Text>
                                </div>
                              </Col>
                            </Row>
                            <Row gutter={[16, 16]}>
                              <Col xs={24} md={12} xl={6}>
                                <Input addonBefore={t('context.previewBelowSegments')} value={profile?.previewBelowSegments} onChange={(event) => onChange('previewBelowSegments', Number(event.target.value || 0))} />
                              </Col>
                              <Col xs={24} md={12} xl={6}>
                                <Input addonBefore={t('context.previewBelowCharacters')} value={profile?.previewBelowCharacters} onChange={(event) => onChange('previewBelowCharacters', Number(event.target.value || 0))} />
                              </Col>
                              <Col xs={24} md={12} xl={6}>
                                <div className="builder-switch-line">
                                  <Switch checked={profile?.previewBelowIncludeSource === true} onChange={(checked) => onChange('previewBelowIncludeSource', checked)} />
                                  <Text>{t('context.previewBelowIncludeSource')}</Text>
                                </div>
                              </Col>
                              <Col xs={24} md={12} xl={6}>
                                <div className="builder-switch-line">
                                  <Switch checked={profile?.previewBelowIncludeTarget !== false} onChange={(checked) => onChange('previewBelowIncludeTarget', checked)} />
                                  <Text>{t('context.previewBelowIncludeTarget')}</Text>
                                </div>
                              </Col>
                            </Row>
                          </Space>
                        )}
                      </Space>
                    )
                  }
                ]}
              />
            </StepCard>
          </div>
        </Space>
      </Card>
    </>
  );
}

export default function BuilderPage({
  profileItems = [],
  defaultProfileId = '',
  currentProfile = null,
  providers = [],
  assets = [],
  supportedPlaceholders = [],
  templateIssues = [],
  onSelectProfile,
  onCreateBlankProfile,
  onCreatePresetProfile,
  onChangeProfile,
  onSaveProfile,
  onSetDefaultProfile,
  onDiscardProfile,
  onDuplicateProfile,
  onDeleteProfile
}) {
  const { t } = useI18n();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <Space direction="vertical" size={18} style={{ display: 'flex' }}>
      <Row gutter={16} align="top">
        <Col xs={24} xl={getPanelColumnSpan(sidebarCollapsed)}>
          <ProfileListPanel
            profileItems={profileItems}
            currentProfileId={currentProfile?.id}
            defaultProfileId={defaultProfileId}
            onSelectProfile={onSelectProfile}
            onCreateBlankProfile={onCreateBlankProfile}
            onCreatePresetProfile={onCreatePresetProfile}
            title={t('context.panelTitle')}
            emptyText={t('context.noProfiles')}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
            expandLabel={t('common.expandSidebar')}
            collapseLabel={t('common.collapseSidebar')}
          />
        </Col>
        <Col xs={24} xl={getPanelContentSpan(sidebarCollapsed)}>
          {currentProfile ? (
            <BuilderEditor
              profile={currentProfile}
              providers={providers}
              assets={assets}
              supportedPlaceholders={supportedPlaceholders}
              templateIssues={templateIssues}
              onChange={onChangeProfile}
              onSave={onSaveProfile}
              onSetDefault={onSetDefaultProfile}
              isDefaultProfile={currentProfile?.id === defaultProfileId}
              onDiscard={onDiscardProfile}
              onDuplicate={onDuplicateProfile}
              onDelete={onDeleteProfile}
            />
          ) : (
            <Card className="page-card"><Empty description={t('context.createProfileFirst')} /></Card>
          )}
        </Col>
      </Row>
    </Space>
  );
}
