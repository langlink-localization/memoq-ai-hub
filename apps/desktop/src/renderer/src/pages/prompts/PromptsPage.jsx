import { PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Empty, Input, List, Row, Col, Space, Typography } from 'antd';
import { useState } from 'react';
import {
  buildCollapsiblePanelEntries,
  getPanelColumnSpan,
  getPanelContentSpan
} from '../../appShell.mjs';
import { CollapsibleItemList, CollapsibleSidePanel, ProfileListRow } from '../../components/CollapsibleSidePanel';
import { useI18n } from '../../i18n';

const { Text } = Typography;
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

function getLocalizedPlaceholderText(t, item, kind) {
  const key = `context.placeholder${kind}.${item.token}`;
  const localized = t(key);
  return localized === key ? item?.[kind.toLowerCase()] || '' : localized;
}

function ProfileListPanel({
  profileItems,
  currentProfileId,
  defaultProfileId,
  onSelectProfile,
  onCreateProfile,
  title,
  emptyText,
  createLabel,
  collapsed,
  onToggleCollapsed,
  expandLabel,
  collapseLabel
}) {
  const { t } = useI18n();
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
        <Button icon={<PlusOutlined />} onClick={onCreateProfile}>{createLabel}</Button>
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

export default function PromptsPage({
  profileItems = [],
  defaultProfileId = '',
  currentProfile = null,
  supportedPlaceholders = [],
  templateIssues = [],
  onSelectProfile,
  onCreateProfile,
  onChangeProfile,
  onSaveProfile,
  onDiscardProfile,
  onDuplicateProfile,
  onDeleteProfile,
  onInsertPlaceholder
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
            onCreateProfile={onCreateProfile}
            title={t('context.panelTitle')}
            emptyText={t('context.noProfiles')}
            createLabel={t('context.newProfile')}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
            expandLabel={t('common.expandSidebar')}
            collapseLabel={t('common.collapseSidebar')}
          />
        </Col>
        <Col xs={24} xl={getPanelContentSpan(sidebarCollapsed)}>
          {currentProfile ? (
            <Card
              className="page-card"
              title={t('context.profileEditor')}
              extra={(
                <Space>
                  <Button onClick={onDuplicateProfile}>{t('common.duplicate')}</Button>
                  <Button onClick={onDiscardProfile}>{t('context.discardChanges')}</Button>
                  <Button danger onClick={onDeleteProfile}>{t('context.deleteProfile')}</Button>
                  <Button type="primary" icon={<SaveOutlined />} onClick={onSaveProfile}>{t('context.saveProfile')}</Button>
                </Space>
              )}
            >
              <Space direction="vertical" size={18} style={{ display: 'flex' }}>
                <Input addonBefore={t('context.name')} value={currentProfile?.name} onChange={(event) => onChangeProfile('name', event.target.value)} />

                <Alert
                  type="info"
                  showIcon
                  message={t('context.promptManagedTitle')}
                  description={t('context.promptManagedDescription')}
                />

                <Card size="small" title={t('context.translationStyleTitle')}>
                  <Space direction="vertical" size={12} style={{ display: 'flex' }}>
                    <Text type="secondary">{t('context.translationStyleHint')}</Text>
                    <Input
                      list="translation-style-presets"
                      value={currentProfile?.translationStyle || ''}
                      onChange={(event) => onChangeProfile('translationStyle', event.target.value)}
                      placeholder={t('context.translationStylePlaceholder')}
                    />
                    <datalist id="translation-style-presets">
                      {STYLE_PRESETS.map((item) => (
                        <option key={item.key} value={item.text}>{t(`context.translationStylePreset.${item.key}`)}</option>
                      ))}
                    </datalist>
                  </Space>
                </Card>

                <Card size="small" title={t('context.advancedPromptTemplatesLabel')}>
                  <Space direction="vertical" size={12} style={{ display: 'flex' }}>
                    <Text type="secondary">{t('context.advancedPromptTemplatesHint')}</Text>
                    <Alert
                      type="info"
                      showIcon
                      message={t('context.promptManagedTitle')}
                      description={t('context.advancedPromptTemplatesHint')}
                    />
                  </Space>
                </Card>

                {templateIssues.length > 0 && (
                  <Alert
                    type="error"
                    showIcon
                    message={t('context.placeholderValidationTitle')}
                    description={(
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {templateIssues.map((issue) => <li key={issue}>{issue}</li>)}
                      </ul>
                    )}
                  />
                )}

                <Card size="small" title={t('context.placeholderPanelTitle')}>
                  <Space direction="vertical" size={12} style={{ display: 'flex' }}>
                    <Text type="secondary">{t('context.placeholderPanelHint')}</Text>
                    <List
                      size="small"
                      dataSource={supportedPlaceholders || []}
                      renderItem={(item) => (
                        <List.Item>
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
                </Card>
              </Space>
            </Card>
          ) : (
            <Card className="page-card"><Empty description={t('context.createProfileFirst')} /></Card>
          )}
        </Col>
      </Row>
    </Space>
  );
}
