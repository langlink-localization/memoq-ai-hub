import { useEffect, useState } from 'react';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ExportOutlined,
  FileSearchOutlined,
  PauseOutlined,
  CaretRightOutlined,
  ReloadOutlined,
  WarningOutlined
} from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Badge,
  Button,
  Card,
  Collapse,
  Empty,
  Form,
  Input,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
  theme
} from 'antd';
import { useI18n } from '../../i18n';
import QualityExecutionSummary from './QualityExecutionSummary.jsx';
import QaHistoryPanel from './QaHistoryPanel.jsx';
import PromptPresetSelector from './PromptPresetSelector.jsx';
import QaFindingReview from './QaFindingReview.jsx';
import qaPromptModule from '../../../../qa/qaPrompt.js';
import { disableQaRule } from './qaFindingReview.mjs';

const { Paragraph, Text, Title } = Typography;
const { DEFAULT_QA_SYSTEM_PROMPT, DEFAULT_QA_USER_PROMPT } = qaPromptModule;

const SEVERITY_ICON = {
  critical: ExclamationCircleOutlined,
  major: WarningOutlined,
  minor: FileSearchOutlined,
  info: CheckCircleOutlined
};
const SEVERITY_COLOR = { critical: 'error', major: 'warning', minor: 'gold', info: 'blue' };

function SeverityTag({ severity }) {
  const { token } = theme.useToken();
  const Icon = SEVERITY_ICON[severity] || FileSearchOutlined;
  return (
    <Tag color={SEVERITY_COLOR[severity] || 'default'} icon={<Icon />} style={{ color: severity === 'major' ? token.colorWarningText : undefined }}>
      {severity}
    </Tag>
  );
}

function matchesRule(rule, sample) {
  try {
    if (rule.type === 'regex') return new RegExp(rule.pattern || '', rule.flags || '').test(sample);
    if (rule.type === 'contains') return sample.includes(rule.value || '');
    if (rule.type === 'not-contains') return !sample.includes(rule.value || '');
    return Boolean(String(rule.instruction || '').trim());
  } catch {
    return false;
  }
}

export default function QualityPage({ api = window.memoqDesktop, profiles = [], providers = [], promptPresets: initialPromptPresets = [], compact = false }) {
  const { t } = useI18n();
  const { message, modal, notification } = AntdApp.useApp();
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('current');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [rules, setRules] = useState([]);
  const [includeSummary, setIncludeSummary] = useState(false);
  const [includeFullText, setIncludeFullText] = useState(false);
  const [qaSystemPrompt, setQaSystemPrompt] = useState(DEFAULT_QA_SYSTEM_PROMPT);
  const [qaUserPrompt, setQaUserPrompt] = useState(DEFAULT_QA_USER_PROMPT);
  const [savingField, setSavingField] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [sampleText, setSampleText] = useState('');
  const [ruleTestMatched, setRuleTestMatched] = useState(null);
  const [activeTab, setActiveTab] = useState('check');
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [promptPresets, setPromptPresets] = useState(initialPromptPresets);
  const [qaPresetId, setQaPresetId] = useState('');
  const [savedProfiles, setSavedProfiles] = useState({});
  const [ruleForm] = Form.useForm();

  const sourceProfile = profiles.find((item) => item.id === selectedProfileId) || profiles[0] || null;
  const profile = sourceProfile ? (savedProfiles[sourceProfile.id] || sourceProfile) : null;
  const provider = providers.find((item) => item.id === selectedProviderId) || providers[0] || null;
  const latestResult = status?.latestResult || null;
  const findings = latestResult?.findings || [];

  useEffect(() => setPromptPresets(initialPromptPresets), [initialPromptPresets]);

  useEffect(() => {
    if (!selectedProfileId && profiles.length) setSelectedProfileId(profiles.find((item) => item.id)?.id || '');
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (!profile) return;
    setRules(Array.isArray(profile.qaRules) ? profile.qaRules : []);
    setAiEnabled(profile.qaRealtimeAiEnabled === true);
    setIncludeSummary(profile.qaIncludeSummary === true);
    setIncludeFullText(profile.qaIncludeFullText === true);
    setQaSystemPrompt(profile.promptTemplates?.qa?.systemPrompt || DEFAULT_QA_SYSTEM_PROMPT);
    setQaUserPrompt(profile.promptTemplates?.qa?.userPrompt || DEFAULT_QA_USER_PROMPT);
    const nextProviderId = profile.interactiveProviderId || profile.providerId || providers[0]?.id || '';
    setSelectedProviderId(nextProviderId);
  }, [profile?.id]);

  useEffect(() => {
    const nextProvider = providers.find((item) => item.id === selectedProviderId) || providers[0];
    const nextModel = (nextProvider?.models || []).find((item) => item.id === profile?.interactiveModelId)
      || (nextProvider?.models || []).find((item) => item.enabled !== false)
      || nextProvider?.models?.[0];
    setSelectedModel(nextModel?.modelName || nextModel?.id || '');
  }, [selectedProviderId, profile?.interactiveModelId, providers]);

  async function refreshStatus(silent = false) {
    try {
      const next = await api?.getQaStatus?.();
      if (next) setStatus(next);
      if (!silent) setError('');
    } catch (loadError) {
      if (!silent) setError(String(loadError?.message || t('quality.statusFailed')));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(true), 750);
    return () => clearInterval(timer);
  }, []);

  async function runCurrentCheck() {
    setChecking(true);
    setError('');
    try {
      const result = await api.checkQaSegment({
        profileId: profile?.id || '',
        contextPolicy: { includeSummary, includeFullText, maxAdjacentCharacters: 1200 },
        ai: { enabled: aiEnabled, providerId: selectedProviderId, model: selectedModel },
        prompt: { presetId: qaPresetId }
      });
      const currentStatus = await api.getQaStatus();
      setStatus(currentStatus);
      if (currentStatus?.currentSnapshot?.contentHash !== result.contentHash) {
        setError(t('assistant.previewChanged'));
      }
      setHistoryRefreshKey((current) => current + 1);
    } catch (checkError) {
      setError(String(checkError?.message || t('quality.checkFailed')));
    } finally {
      setChecking(false);
    }
  }

  async function togglePaused() {
    const nextPaused = status?.paused !== true;
    const result = await api.cancelQa({ paused: nextPaused });
    setStatus((current) => ({ ...(current || {}), paused: result?.paused === true, activeRequestCount: nextPaused ? 0 : current?.activeRequestCount || 0 }));
  }

  function confirmBatchImport() {
    modal.confirm({
      title: t('quality.batchPrivacyTitle'),
      content: t('quality.batchPrivacyDescription'),
      okText: t('quality.selectFile'),
      async onOk() {
        const imported = await api.importBilingualQa({
          profileId: profile?.id || '',
          contextPolicy: { includeSummary, includeFullText, maxAdjacentCharacters: 1200 },
          ai: { enabled: aiEnabled, providerId: selectedProviderId, model: selectedModel },
          prompt: { presetId: qaPresetId }
        });
        if (!imported) return;
        notification.success({
          message: t('quality.batchComplete'),
          description: t('quality.batchCompleteDescription', { count: imported.reports?.findingCount || 0 })
        });
        setStatus((current) => ({ ...(current || {}), latestResult: imported.result?.results?.[0] || current?.latestResult }));
        setHistoryRefreshKey((current) => current + 1);
      }
    });
  }

  async function disableFindingRule(finding) {
    const result = await disableQaRule({
      api,
      profileId: latestResult?.configuration?.profileId || profile?.id || '',
      ruleId: finding.ruleId
    });
    if (result.profile?.id) {
      setSavedProfiles((current) => ({ ...current, [result.profile.id]: result.profile }));
      if (result.profile.id === profile?.id) setRules(result.profile.qaRules || []);
    }
    return result;
  }

  function canDisableFindingRule(finding) {
    const profileId = latestResult?.configuration?.profileId || profile?.id || '';
    const resultProfile = savedProfiles[profileId] || profiles.find((item) => item.id === profileId);
    return Boolean(resultProfile?.qaRules?.some((rule) => rule.id === finding.ruleId));
  }

  async function saveQualitySettings() {
    if (!profile) return;
    const saved = await api.saveProfile({
      ...profile,
      qaRealtimeAiEnabled: aiEnabled,
      qaIncludeSummary: includeSummary,
      qaIncludeFullText: includeFullText,
      qaRules: rules,
      promptTemplates: {
        ...(profile.promptTemplates || {}),
        qa: { systemPrompt: qaSystemPrompt, userPrompt: qaUserPrompt }
      }
    });
    if (saved?.id) setSavedProfiles((current) => ({ ...current, [saved.id]: saved }));
    message.success(t('quality.settingsSaved'));
  }

  async function saveToggle(field, nextValue, setter, previousValue) {
    if (!profile) return;
    setter(nextValue);
    setSavingField(field);
    setSettingsError('');
    try {
      const saved = await api.saveProfile({
        ...profile,
        qaRealtimeAiEnabled: field === 'qaRealtimeAiEnabled' ? nextValue : aiEnabled,
        qaIncludeSummary: field === 'qaIncludeSummary' ? nextValue : includeSummary,
        qaIncludeFullText: field === 'qaIncludeFullText' ? nextValue : includeFullText,
        qaRules: rules,
        promptTemplates: { ...(profile.promptTemplates || {}), qa: { systemPrompt: qaSystemPrompt, userPrompt: qaUserPrompt } }
      });
      if (saved?.id) setSavedProfiles((current) => ({ ...current, [saved.id]: saved }));
    } catch (saveError) {
      setter(previousValue);
      setSettingsError(String(saveError?.message || t('quality.settingsSaveFailed')));
    } finally {
      setSavingField('');
    }
  }

  async function restoreDefaultQaPrompt() {
    setQaSystemPrompt(DEFAULT_QA_SYSTEM_PROMPT);
    setQaUserPrompt(DEFAULT_QA_USER_PROMPT);
    if (!profile) return;
    const saved = await api.saveProfile({
      ...profile,
      promptTemplates: { ...(profile.promptTemplates || {}), qa: {} }
    });
    if (saved?.id) setSavedProfiles((current) => ({ ...current, [saved.id]: saved }));
    message.success(t('quality.qaPromptRestored'));
  }

  function addRule(values) {
    const nextRule = {
      id: globalThis.crypto?.randomUUID?.() || `qa-rule-${Date.now()}`,
      name: values.name,
      enabled: true,
      type: values.type,
      scope: values.scope,
      pattern: values.type === 'regex' ? values.expression : '',
      value: values.type === 'regex' || values.type === 'natural-language' ? '' : values.expression,
      instruction: values.type === 'natural-language' ? values.expression : '',
      category: values.category,
      severity: values.severity,
      message: values.message || '',
      version: '1',
      lastValidatedAt: new Date().toISOString()
    };
    setRules((current) => [...current, nextRule]);
    setRuleTestMatched(matchesRule(nextRule, sampleText));
    ruleForm.resetFields();
  }

  if (loading) return <Skeleton active paragraph={{ rows: compact ? 6 : 10 }} />;

  const content = (
    <Space direction="vertical" size="large" className={compact ? 'quality-float-content' : 'quality-page'}>
      {error ? <Alert type="error" showIcon closable message={error} onClose={() => setError('')} /> : null}
      {settingsError ? <Alert type="error" showIcon closable message={settingsError} onClose={() => setSettingsError('')} /> : null}
      <Alert
        type={latestResult?.status === 'local-only' ? 'warning' : status?.activeRequestCount ? 'info' : 'success'}
        showIcon
        message={status?.activeRequestCount ? t('quality.checking') : latestResult ? t('quality.currentResult') : t('quality.waitingForPreview')}
        description={latestResult?.status === 'local-only' ? t('quality.localOnlyDescription') : t('quality.statusDescription')}
      />

      {!compact ? (
        <Card>
          <Space direction="vertical" size="middle" className="quality-controls">
            <Segmented value={mode} onChange={setMode} options={[{ value: 'current', label: t('quality.currentSegment') }, { value: 'batch', label: t('quality.batchFile') }]} />
            <Space wrap>
              <Select value={selectedProfileId} onChange={setSelectedProfileId} placeholder={t('quality.profile')} options={profiles.map((item) => ({ value: item.id, label: item.name }))} className="quality-select" />
              <Select value={selectedProviderId} onChange={setSelectedProviderId} placeholder={t('common.provider')} options={providers.map((item) => ({ value: item.id, label: item.name }))} className="quality-select" />
              <Select value={selectedModel} onChange={setSelectedModel} placeholder={t('quality.model')} options={(provider?.models || []).filter((item) => item.enabled !== false).map((item) => ({ value: item.modelName || item.id, label: item.modelName }))} className="quality-select" />
            </Space>
            <Space direction="vertical" className="quality-controls" size="small">
              <Text>{t('promptPresets.qaPreset')}</Text>
              <PromptPresetSelector api={api} presets={promptPresets} scope="qa" value={qaPresetId} onChange={setQaPresetId} onPresetsChange={setPromptPresets} />
            </Space>
            <Space wrap>
              <label className="quality-switch-row"><Switch loading={savingField === 'qaRealtimeAiEnabled'} disabled={Boolean(savingField)} checked={aiEnabled} onChange={(value) => saveToggle('qaRealtimeAiEnabled', value, setAiEnabled, aiEnabled)} /><Text>{t('quality.realtimeAi')}</Text></label>
              <label className="quality-switch-row"><Switch loading={savingField === 'qaIncludeSummary'} checked={includeSummary} disabled={!aiEnabled || Boolean(savingField)} onChange={(value) => saveToggle('qaIncludeSummary', value, setIncludeSummary, includeSummary)} /><Text type={!aiEnabled ? 'secondary' : undefined}>{t('quality.includeSummary')}</Text></label>
              <label className="quality-switch-row"><Switch loading={savingField === 'qaIncludeFullText'} checked={includeFullText} disabled={!aiEnabled || Boolean(savingField)} onChange={(value) => saveToggle('qaIncludeFullText', value, setIncludeFullText, includeFullText)} /><Text type={!aiEnabled ? 'secondary' : undefined}>{t('quality.includeFullText')}</Text></label>
            </Space>
            <Space wrap>
              {mode === 'current' ? <Button type="primary" icon={<ReloadOutlined />} loading={checking} onClick={runCurrentCheck}>{t('quality.recheck')}</Button> : <Button type="primary" icon={<ExportOutlined />} onClick={confirmBatchImport}>{t('quality.selectFile')}</Button>}
              <Button onClick={saveQualitySettings}>{t('quality.saveSettings')}</Button>
            </Space>
          </Space>
        </Card>
      ) : (
        <Space wrap>
          <Button type="primary" icon={<ReloadOutlined />} loading={checking} onClick={runCurrentCheck}>{t('quality.recheck')}</Button>
          <Button icon={status?.paused ? <CaretRightOutlined /> : <PauseOutlined />} onClick={togglePaused}>{status?.paused ? t('quality.resume') : t('quality.pause')}</Button>
          <Badge count={findings.filter((item) => item.severity === 'critical' || item.severity === 'major').length} showZero><Text>{t('quality.seriousIssues')}</Text></Badge>
        </Space>
      )}

      {latestResult ? (
        <>
          <Card size="small" title={t('quality.currentSegment')}>
            <Paragraph ellipsis={{ rows: compact ? 2 : 3, expandable: !compact }}>{latestResult.segment?.source || '-'}</Paragraph>
            <Text type="secondary">{latestResult.segment?.target || '-'}</Text>
          </Card>
          <QualityExecutionSummary compact={compact} execution={latestResult.execution} />
          {['failed', 'circuit-open', 'cancelled'].includes(latestResult.execution?.ai?.status) && findings.length > 0 ? <Alert type="warning" showIcon message={t('quality.aiFailedTitle')} description={t('quality.aiFailedDescription')} action={<Button size="small" onClick={runCurrentCheck}>{t('common.retry')}</Button>} /> : null}
          {findings.length === 0 ? (
            <Alert
              type={['failed', 'circuit-open', 'cancelled'].includes(latestResult.execution?.ai?.status) ? 'warning' : 'success'}
              showIcon
              message={['failed', 'circuit-open', 'cancelled'].includes(latestResult.execution?.ai?.status) ? t('quality.aiFailedTitle') : t('quality.checkCompleteNoFindings')}
              description={['failed', 'circuit-open', 'cancelled'].includes(latestResult.execution?.ai?.status) ? t('quality.aiFailedDescription') : latestResult.execution?.ai?.status === 'disabled' ? t('quality.aiNotRequestedDescription') : undefined}
              action={['failed', 'circuit-open', 'cancelled'].includes(latestResult.execution?.ai?.status) ? <Button size="small" onClick={runCurrentCheck}>{t('common.retry')}</Button> : null}
            />
          ) : <QaFindingReview
            findings={findings}
            requestId={latestResult.requestId}
            profileId={latestResult?.configuration?.profileId || profile?.id || ''}
            onCopy={(value) => api.copyText(value)}
            onLoadFeedback={(requestId) => api.getQaHistoryEntry(requestId)}
            onSaveFeedback={(payload) => api.saveQaFeedback(payload)}
            onDisableRule={disableFindingRule}
            canDisableRule={canDisableFindingRule}
            compact={compact}
          />}
        </>
      ) : <Empty description={t('quality.waitingForPreview')} />}

      {!compact ? (
        <Collapse items={[
          {
            key: 'prompt', label: t('quality.qaPromptTemplates'), children: (
              <Space direction="vertical" className="quality-rules" size="middle">
                <Alert type="info" showIcon message={t('quality.qaPromptGuardrails')} />
                <Form layout="vertical">
                  <Form.Item label={t('quality.qaSystemPrompt')}><Input.TextArea rows={5} value={qaSystemPrompt} onChange={(event) => setQaSystemPrompt(event.target.value)} /></Form.Item>
                  <Form.Item label={t('quality.qaUserPrompt')}><Input.TextArea rows={8} value={qaUserPrompt} onChange={(event) => setQaUserPrompt(event.target.value)} /></Form.Item>
                  <Space><Button type="primary" onClick={saveQualitySettings}>{t('common.save')}</Button><Button onClick={restoreDefaultQaPrompt}>{t('quality.restoreDefault')}</Button></Space>
                </Form>
              </Space>
            )
          },
          {
          key: 'rules', label: t('quality.projectRules'), children: (
            <Space direction="vertical" className="quality-rules" size="middle">
              <Form form={ruleForm} layout="vertical" onFinish={addRule} initialValues={{ type: 'contains', scope: 'target', category: 'style', severity: 'minor' }}>
                <Form.Item name="name" label={t('quality.ruleName')} rules={[{ required: true }]}><Input /></Form.Item>
                <Space wrap align="start">
                  <Form.Item name="type" label={t('quality.ruleType')} rules={[{ required: true }]}><Select options={['regex', 'contains', 'not-contains', 'natural-language'].map((value) => ({ value, label: value }))} className="quality-rule-select" /></Form.Item>
                  <Form.Item name="scope" label={t('quality.ruleScope')}><Select options={['source', 'target'].map((value) => ({ value, label: value }))} className="quality-rule-select" /></Form.Item>
                  <Form.Item name="severity" label={t('quality.severity')}><Select options={['critical', 'major', 'minor', 'info'].map((value) => ({ value, label: value }))} className="quality-rule-select" /></Form.Item>
                </Space>
                <Form.Item name="expression" label={t('quality.ruleExpression')} rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
                <Form.Item name="message" label={t('quality.ruleMessage')}><Input /></Form.Item>
                <Input.TextArea value={sampleText} onChange={(event) => setSampleText(event.target.value)} rows={2} placeholder={t('quality.sampleText')} />
                {ruleTestMatched != null ? <Alert type={ruleTestMatched ? 'warning' : 'success'} showIcon message={ruleTestMatched ? t('quality.sampleMatched') : t('quality.sampleNotMatched')} /> : null}
                <Button type="primary" htmlType="submit">{t('quality.addRule')}</Button>
              </Form>
              {rules.map((rule) => <Card size="small" key={rule.id} title={rule.name} extra={<Button danger type="link" onClick={() => setRules((current) => current.filter((item) => item.id !== rule.id))}>{t('common.delete')}</Button>}><Space wrap><Tag>{rule.type}</Tag><SeverityTag severity={rule.severity} /><Text>{rule.pattern || rule.value || rule.instruction}</Text></Space></Card>)}
            </Space>
          )
        }]} />
      ) : null}

    </Space>
  );

  if (compact) {
    return <Card className="quality-float-card" title={<Title level={4}>{t('nav.quality')}</Title>}>{content}</Card>;
  }

  return (
    <Tabs
      activeKey={activeTab}
      onChange={setActiveTab}
      items={[
        { key: 'check', label: t('quality.tabs.check'), children: content },
        {
          key: 'history',
          label: t('quality.tabs.history'),
          children: activeTab === 'history' ? <QaHistoryPanel api={api} profiles={profiles.map((item) => savedProfiles[item.id] || item)} onProfileSaved={(saved) => setSavedProfiles((current) => ({ ...current, [saved.id]: saved }))} refreshKey={historyRefreshKey} /> : null
        }
      ]}
    />
  );
}
