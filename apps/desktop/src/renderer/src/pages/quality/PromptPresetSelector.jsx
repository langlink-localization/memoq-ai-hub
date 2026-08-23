import { useEffect, useMemo, useState } from 'react';
import { EditOutlined } from '@ant-design/icons';
import { Alert, App as AntdApp, Button, Drawer, Form, Input, Select, Space, Tag, Typography } from 'antd';
import { useI18n } from '../../i18n';

const { Text } = Typography;

export default function PromptPresetSelector({ api, presets = [], scope, value, onChange, onPresetsChange, label }) {
  const { t } = useI18n();
  const { message, modal } = AntdApp.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);
  const scoped = useMemo(() => presets.filter((item) => item.scope === scope), [presets, scope]);
  const selected = scoped.find((item) => item.id === value) || scoped[0] || null;
  const defaultPresetId = scoped[0]?.id || '';

  useEffect(() => {
    if (!value && defaultPresetId) onChange?.(defaultPresetId);
  }, [defaultPresetId, onChange, value]);

  function edit() {
    if (!selected) return;
    setDraft({ ...selected, rulesText: (selected.rules || []).map((rule) => rule.instruction).join('\n') });
    setOpen(true);
  }

  async function persist(asCopy = false) {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await api.savePromptPreset({
        ...draft,
        id: asCopy ? '' : draft.id,
        name: asCopy ? `${draft.name} Copy` : draft.name,
        builtin: asCopy ? false : draft.builtin,
        rules: String(draft.rulesText || '').split(/\r?\n/).map((instruction) => ({ instruction: instruction.trim() })).filter((item) => item.instruction)
      });
      const next = asCopy ? [...presets, saved] : presets.map((item) => item.id === saved.id ? saved : item);
      onPresetsChange?.(next);
      onChange?.(saved.id);
      setDraft({ ...saved, rulesText: (saved.rules || []).map((rule) => rule.instruction).join('\n') });
      message.success(t('promptPresets.saved'));
    } catch (error) {
      message.error(String(error?.message || t('promptPresets.saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  async function restore() {
    const restored = await api.restoreBuiltinPromptPreset(draft.id);
    onPresetsChange?.(presets.map((item) => item.id === restored.id ? restored : item));
    setDraft({ ...restored, rulesText: (restored.rules || []).map((rule) => rule.instruction).join('\n') });
    message.success(t('promptPresets.restored'));
  }

  function remove() {
    modal.confirm({
      title: t('promptPresets.deleteTitle'),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      async onOk() {
        await api.deletePromptPreset(draft.id);
        const next = presets.filter((item) => item.id !== draft.id);
        onPresetsChange?.(next);
        onChange?.(next.find((item) => item.scope === scope)?.id || '');
        setOpen(false);
      }
    });
  }

  return (
    <>
      <Space.Compact block>
        <Select
          value={selected?.id}
          onChange={onChange}
          placeholder={label || t('promptPresets.select')}
          options={scoped.map((item) => ({ value: item.id, label: item.name }))}
          style={{ width: '100%' }}
        />
        <Button icon={<EditOutlined />} disabled={!selected} onClick={edit} aria-label={t('promptPresets.edit')} />
      </Space.Compact>
      <Drawer title={t('promptPresets.editorTitle')} open={open} onClose={() => setOpen(false)} width="min(680px, calc(100vw - 32px))" destroyOnHidden>
        {draft ? (
          <Form layout="vertical" onFinish={() => persist(false)}>
            <Alert type="info" showIcon message={t('promptPresets.placeholderHint')} />
            <Form.Item label={t('promptPresets.name')} required><Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></Form.Item>
            <Form.Item label={t('promptPresets.scope')}><Space><Tag>{draft.scope}</Tag>{draft.builtin ? <Tag color="blue">{t('promptPresets.builtin')}</Tag> : null}</Space></Form.Item>
            {draft.scope !== 'qa' ? <Form.Item label={t('promptPresets.style')}><Input.TextArea rows={3} value={draft.style} onChange={(event) => setDraft((current) => ({ ...current, style: event.target.value }))} /></Form.Item> : null}
            <Form.Item label={t('promptPresets.systemPrompt')} required><Input.TextArea rows={6} value={draft.systemPrompt} onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))} /></Form.Item>
            <Form.Item label={t('promptPresets.userPrompt')} required><Input.TextArea rows={9} value={draft.userPrompt} onChange={(event) => setDraft((current) => ({ ...current, userPrompt: event.target.value }))} /></Form.Item>
            {draft.scope === 'qa' ? <Form.Item label={t('promptPresets.rules')} extra={t('promptPresets.rulesHint')}><Input.TextArea rows={4} value={draft.rulesText} onChange={(event) => setDraft((current) => ({ ...current, rulesText: event.target.value }))} /></Form.Item> : null}
            <Space wrap>
              <Button type="primary" htmlType="submit" loading={saving}>{t('common.save')}</Button>
              <Button onClick={() => persist(true)} loading={saving}>{t('promptPresets.saveCopy')}</Button>
              {draft.builtin ? <Button onClick={restore}>{t('quality.restoreDefault')}</Button> : <Button danger onClick={remove}>{t('common.delete')}</Button>}
            </Space>
            <Text type="secondary">{t('promptPresets.guardrails')}</Text>
          </Form>
        ) : null}
      </Drawer>
    </>
  );
}
