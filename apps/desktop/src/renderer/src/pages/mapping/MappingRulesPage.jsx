import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography
} from 'antd';
import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { TABLE_COLUMN_WIDTHS, TABLE_SCROLL_X } from '../../tableLayout.mjs';
import {
  MEMOQ_METADATA_FIELDS,
  buildMappingRuleConditionSummary,
  buildMappingRulePayload,
  createMappingRuleDraft,
  createMappingTestInput,
  findNextRulePriority,
  getMappingTestResultKind,
  hasDuplicateRulePriority,
  hasMappingRuleConditions,
  sortMappingRules,
  validateDocumentIdRegex
} from './mappingRules.mjs';

const { Paragraph, Text } = Typography;
const RULE_EDITOR_WIDTH = 'min(760px, calc(100vw - 32px))';

export default function MappingRulesPage({
  api = window.memoqDesktop,
  rules = [],
  profiles = [],
  defaultProfileId = '',
  onRefresh
}) {
  const { t } = useI18n();
  const { message, modal } = App.useApp();
  const [editorForm] = Form.useForm();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingRuleId, setPendingRuleId] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testInput, setTestInput] = useState(() => createMappingTestInput());
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState('');

  const sortedRules = useMemo(() => sortMappingRules(rules), [rules]);
  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const profileOptions = profiles.map((profile) => ({ value: profile.id, label: profile.name }));

  async function refreshRules() {
    setRefreshing(true);
    setError('');
    try {
      await onRefresh?.();
    } catch (refreshError) {
      setError(String(refreshError?.message || t('mapping.refreshFailed')));
    } finally {
      setRefreshing(false);
    }
  }

  function openRuleEditor(rule = null, copy = false) {
    const priority = findNextRulePriority(sortedRules);
    const draft = createMappingRuleDraft(rule || {}, {
      copy,
      priority,
      profileId: rule?.profileId || defaultProfileId || profiles[0]?.id || '',
      defaultName: t('mapping.newRuleName')
    });
    if (copy) draft.ruleName = t('mapping.copiedRuleName', { name: rule?.ruleName || t('mapping.newRuleName') });
    setEditingRule(draft);
    editorForm.resetFields();
    editorForm.setFieldsValue(draft);
    setError('');
    setEditorOpen(true);
  }

  async function persistRule(payload) {
    setSaving(true);
    setError('');
    try {
      await api.saveRule(payload);
      await onRefresh?.();
      setEditorOpen(false);
      setEditingRule(null);
      message.success(t('mapping.ruleSaved'));
    } catch (saveError) {
      const text = String(saveError?.message || t('mapping.saveFailed'));
      setError(text);
      message.error(text);
      throw saveError;
    } finally {
      setSaving(false);
    }
  }

  async function submitRule() {
    let values;
    try {
      values = await editorForm.validateFields();
    } catch {
      return;
    }
    const payload = buildMappingRulePayload({ ...editingRule, ...values });
    const warnings = [];
    if (!hasMappingRuleConditions(payload)) warnings.push(t('mapping.catchAllWarning'));
    if (hasDuplicateRulePriority(sortedRules, payload)) warnings.push(t('mapping.duplicatePriorityWarning'));
    if (warnings.length) {
      modal.confirm({
        title: t('mapping.confirmSaveTitle'),
        content: <Space direction="vertical">{warnings.map((warning) => <Text key={warning}>{warning}</Text>)}</Space>,
        okText: t('common.save'),
        cancelText: t('common.cancel'),
        onOk: () => persistRule(payload)
      });
      return;
    }
    await persistRule(payload).catch(() => {});
  }

  async function toggleRule(rule) {
    setPendingRuleId(rule.id);
    setError('');
    try {
      await api.saveRule({ ...rule, enabled: rule.enabled === false });
      await onRefresh?.();
      message.success(t(rule.enabled === false ? 'mapping.ruleEnabled' : 'mapping.ruleDisabled'));
    } catch (toggleError) {
      const text = String(toggleError?.message || t('mapping.saveFailed'));
      setError(text);
      message.error(text);
    } finally {
      setPendingRuleId('');
    }
  }

  function confirmDeleteRule(rule) {
    modal.confirm({
      title: t('mapping.deleteRuleTitle', { name: rule.ruleName }),
      content: t('mapping.deleteRuleDescription'),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setPendingRuleId(rule.id);
        setError('');
        try {
          await api.deleteRule(rule.id);
          await onRefresh?.();
          message.success(t('mapping.ruleDeleted'));
        } catch (deleteError) {
          const text = String(deleteError?.message || t('mapping.deleteFailed'));
          setError(text);
          message.error(text);
          throw deleteError;
        } finally {
          setPendingRuleId('');
        }
      }
    });
  }

  async function runTestMatch() {
    setTesting(true);
    setError('');
    setTestResult(null);
    try {
      setTestResult(await api.testMatch(createMappingTestInput(testInput)));
    } catch (testError) {
      setError(String(testError?.message || t('mapping.testFailed')));
    } finally {
      setTesting(false);
    }
  }

  const resultKind = getMappingTestResultKind(testResult);
  const resultAlert = testResult ? {
    rule: {
      type: 'success',
      message: t('mapping.matchedProfile', { name: testResult.profile?.name || '-' }),
      description: t('mapping.ruleUsed', { name: testResult.rule?.ruleName || '-' })
    },
    default: {
      type: 'info',
      message: t('mapping.matchedProfile', { name: testResult.profile?.name || '-' }),
      description: t('mapping.defaultFallback')
    },
    missing: {
      type: 'error',
      message: t('mapping.matchedMissingProfile', { name: testResult.rule?.ruleName || '-' }),
      description: t('mapping.matchedMissingProfileDescription')
    },
    none: {
      type: 'warning',
      message: t('mapping.noProfileMatched'),
      description: t('mapping.noProfileMatchedDescription')
    }
  }[resultKind] : null;

  const columns = [
    {
      title: t('mapping.priority'),
      dataIndex: 'priority',
      width: TABLE_COLUMN_WIDTHS.numericMetric,
      sorter: (left, right) => Number(left.priority) - Number(right.priority)
    },
    {
      title: t('mapping.ruleName'),
      dataIndex: 'ruleName',
      width: TABLE_COLUMN_WIDTHS.entityName,
      render: (value, rule) => <Space wrap><Text strong>{value}</Text>{!hasMappingRuleConditions(rule) && <Tag color="orange">{t('mapping.matchAll')}</Tag>}</Space>
    },
    {
      title: t('mapping.status'),
      width: TABLE_COLUMN_WIDTHS.status,
      render: (_, rule) => (
        <Switch
          checked={rule.enabled !== false}
          loading={pendingRuleId === rule.id}
          disabled={Boolean(pendingRuleId) && pendingRuleId !== rule.id}
          checkedChildren={t('mapping.enabled')}
          unCheckedChildren={t('mapping.disabled')}
          aria-label={t('mapping.toggleRule', { name: rule.ruleName })}
          onChange={() => void toggleRule(rule)}
        />
      )
    },
    {
      title: t('mapping.conditions'),
      width: TABLE_COLUMN_WIDTHS.diagnostic,
      render: (_, rule) => <Text>{buildMappingRuleConditionSummary(rule, t)}</Text>
    },
    {
      title: t('mapping.profile'),
      dataIndex: 'profileId',
      width: TABLE_COLUMN_WIDTHS.entityName,
      render: (profileId) => profileById.has(profileId)
        ? profileById.get(profileId).name
        : <Tag color="red">{t('mapping.missingProfile')}</Tag>
    },
    { title: t('mapping.hitCount'), dataIndex: 'hitCount', width: TABLE_COLUMN_WIDTHS.numericMetric },
    {
      title: t('mapping.actions'),
      width: TABLE_COLUMN_WIDTHS.inlineActions,
      fixed: 'right',
      render: (_, rule) => (
        <Space size={0}>
          <Button type="link" icon={<EditOutlined />} onClick={() => openRuleEditor(rule)}>{t('common.edit')}</Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'copy', icon: <CopyOutlined />, label: t('common.duplicate') },
                { type: 'divider' },
                { key: 'delete', danger: true, icon: <DeleteOutlined />, label: t('common.delete') }
              ],
              onClick: ({ key }) => key === 'copy' ? openRuleEditor(rule, true) : confirmDeleteRule(rule)
            }}
          >
            <Button
              type="text"
              icon={<MoreOutlined />}
              aria-label={t('mapping.moreActions', { name: rule.ruleName })}
              disabled={pendingRuleId === rule.id}
            />
          </Dropdown>
        </Space>
      )
    }
  ];

  return (
    <Space direction="vertical" size={16} className="app-block-space">
      {error ? <Alert type="error" showIcon closable message={error} onClose={() => setError('')} /> : null}
      <Alert type="info" showIcon message={t('mapping.overrideNoticeTitle')} description={t('mapping.overrideNoticeDescription')} />
      <Card
        className="page-card"
        title={t('mapping.title')}
        extra={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => void refreshRules()}>{t('app.refresh')}</Button>
            <Button type="primary" icon={<PlusOutlined />} disabled={!profiles.length} onClick={() => openRuleEditor()}>{t('mapping.addRule')}</Button>
          </Space>
        )}
      >
        {!profiles.length ? (
          <Empty description={t('mapping.createProfileFirst')} />
        ) : !sortedRules.length ? (
          <Empty description={t('mapping.emptyDescription')}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openRuleEditor()}>{t('mapping.addRule')}</Button>
          </Empty>
        ) : (
          <Table rowKey="id" dataSource={sortedRules} columns={columns} pagination={false} scroll={{ x: TABLE_SCROLL_X }} />
        )}
      </Card>

      <Card className="page-card" title={t('mapping.testMatch')} extra={<ExperimentOutlined />}>
        <Paragraph type="secondary">{t('mapping.testDescription')}</Paragraph>
        <Form layout="vertical" onFinish={() => void runTestMatch()}>
          <Row gutter={[16, 0]}>
            {MEMOQ_METADATA_FIELDS.map((field) => (
              <Col xs={24} sm={12} lg={6} key={field.metadataKey}>
                <Form.Item label={t(field.inputLabelKey)}>
                  <Input
                    value={testInput[field.metadataKey]}
                    onChange={(event) => setTestInput((current) => ({ ...current, [field.metadataKey]: event.target.value }))}
                  />
                </Form.Item>
              </Col>
            ))}
          </Row>
          <Button htmlType="submit" type="primary" icon={<ExperimentOutlined />} loading={testing}>{t('mapping.runTestMatch')}</Button>
        </Form>
        {resultAlert ? <Alert className="mapping-test-result" showIcon {...resultAlert} /> : null}
      </Card>

      <Drawer
        title={editingRule?.id ? t('mapping.editRule') : t('mapping.addRule')}
        open={editorOpen}
        width={RULE_EDITOR_WIDTH}
        onClose={() => !saving && setEditorOpen(false)}
        destroyOnHidden
        extra={<Button type="primary" htmlType="submit" form="mapping-rule-editor" loading={saving}>{t('common.save')}</Button>}
      >
        <Form id="mapping-rule-editor" form={editorForm} layout="vertical" disabled={saving} onFinish={() => void submitRule()}>
          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}>
              <Form.Item name="ruleName" label={t('mapping.ruleName')} rules={[{ required: true, whitespace: true, message: t('mapping.ruleNameRequired') }]}>
                <Input maxLength={120} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="priority" label={t('mapping.priority')} rules={[{ required: true, message: t('mapping.priorityRequired') }]}>
                <InputNumber min={1} max={9999} className="app-full-width" />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="enabled" label={t('mapping.status')} valuePropName="checked">
                <Switch checkedChildren={t('mapping.enabled')} unCheckedChildren={t('mapping.disabled')} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="profileId" label={t('mapping.profile')} rules={[{ required: true, message: t('mapping.profileRequired') }]}>
                <Select showSearch optionFilterProp="label" options={profileOptions} />
              </Form.Item>
            </Col>
          </Row>
          <Alert type="info" showIcon message={t('mapping.andSemantics')} className="mapping-editor-hint" />
          <Row gutter={[16, 0]}>
            {MEMOQ_METADATA_FIELDS.map((field) => (
              <Col xs={24} md={12} key={field.ruleKey}>
                <Form.Item
                  name={field.ruleKey}
                  label={t(field.inputLabelKey)}
                  extra={t(`mapping.matcherHint.${field.matcher}`)}
                  rules={field.ruleKey === 'documentIdRegex' ? [{
                    validator: (_, value) => validateDocumentIdRegex(value)
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('mapping.invalidRegex')))
                  }] : []}
                >
                  <Input allowClear />
                </Form.Item>
              </Col>
            ))}
          </Row>
        </Form>
      </Drawer>
    </Space>
  );
}
