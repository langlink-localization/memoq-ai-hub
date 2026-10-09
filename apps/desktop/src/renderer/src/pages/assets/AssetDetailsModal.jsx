import { useEffect, useRef, useState } from 'react';
import { Alert, App, Checkbox, Form, Input, Modal, Select, Space, Typography } from 'antd';
import { useI18n } from '../../i18n';
import { requestEditorDeparture } from '../../editorNavigation.mjs';
import { describeBindingChanges, snapshotAssetBindings } from './assetManagement.mjs';

export default function AssetDetailsModal({ asset, profiles, assets, bindingsBlocked, onSave, onClose, onDirtyChange, onBusyChange }) {
  const { t } = useI18n();
  const { modal } = App.useApp();
  const [snapshot] = useState(() => snapshotAssetBindings(profiles, asset.type));
  const [name, setName] = useState(asset.name);
  const [profileIds, setProfileIds] = useState(() => snapshot.filter((entry) => entry.assetIds.includes(asset.id)).map((entry) => entry.profileId));
  const [enableBindings, setEnableBindings] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const changes = describeBindingChanges(asset.id, profileIds, snapshot, enableBindings);
  const dirty = name.trim() !== asset.name || changes.length > 0;
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(saving); return () => onBusyChange?.(false); }, [saving, onBusyChange]);
  const disabledProfiles = snapshot.filter((entry) => profileIds.includes(entry.profileId) && !entry.enabled);
  const close = () => requestEditorDeparture({ dirty, busy: savingRef.current, name: asset.name, modal, t, proceed: onClose });
  async function save() {
    if (savingRef.current || !name.trim() || (bindingsBlocked && changes.length)) return;
    savingRef.current = true; setSaving(true);
    try {
      const saved = await onSave({ assetId: asset.id, name: name.trim(), expectedName: asset.name, profileIds,
        expectedBindings: snapshot, enableBindings, bindingsChanged: changes.length > 0 });
      if (saved) onClose();
    } finally { savingRef.current = false; setSaving(false); }
  }
  return (
    <Modal open title={t('context.assetManage')} onCancel={close} onOk={() => void save()}
      okText={t('common.save')} cancelText={t('common.cancel')} confirmLoading={saving}
      okButtonProps={{ disabled: !dirty || !name.trim() || (bindingsBlocked && changes.length > 0) }}
      closable={!saving} mask={{ closable: !saving }} keyboard={!saving}>
      <Space orientation="vertical" size={16} className="app-block-space">
        <Form layout="vertical" disabled={saving}>
          <Form.Item label={t('context.name')} required extra={t('context.assetRenameHint', { file: asset.fileName })}>
            <Input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} aria-label={t('context.name')} />
          </Form.Item>
          <Form.Item label={t('context.assetBoundProfiles')} extra={t('context.assetBindingHint')}>
            <Select mode="multiple" allowClear showSearch={{ optionFilterProp: 'label' }} value={profileIds}
              disabled={bindingsBlocked || saving} onChange={setProfileIds} aria-label={t('context.assetBoundProfiles')}
              placeholder={t('context.assetChooseProfiles')}
              options={profiles.map((profile) => ({ value: profile.id, label: `${profile.name} (${profile.id})` }))} />
          </Form.Item>
        </Form>
        {bindingsBlocked ? <Alert type="info" showIcon title={t('context.assetBindingsDraftBlocked')} /> : null}
        {profiles.length === 0 ? <Alert type="info" showIcon title={t('context.assetNoProfiles')} /> : null}
        {disabledProfiles.length ? (
          <Space orientation="vertical" className="app-block-space">
            <Typography.Text type="secondary">{t('context.assetDisabledFeature', { names: disabledProfiles.map((entry) => profiles.find((profile) => profile.id === entry.profileId)?.name || entry.profileId).join(', ') })}</Typography.Text>
            <Checkbox checked={enableBindings} disabled={bindingsBlocked || saving} onChange={(event) => setEnableBindings(event.target.checked)}>{t('context.assetEnableBindings')}</Checkbox>
          </Space>
        ) : null}
        {changes.length ? <Alert type="warning" showIcon title={t('context.assetBindingChanges')}
          description={<ul>{changes.map((change) => <li key={change.profileId}>{t(`context.assetBindingAction.${change.action}`, {
            profile: profiles.find((profile) => profile.id === change.profileId)?.name || change.profileId,
            assets: change.assetIds.map((id) => assets.find((item) => item.id === id)?.name || id).join(', ')
          })}</li>)}</ul>} /> : null}
      </Space>
    </Modal>
  );
}
