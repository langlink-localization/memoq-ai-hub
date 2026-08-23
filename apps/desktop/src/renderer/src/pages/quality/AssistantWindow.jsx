import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Empty,
  Input,
  Segmented,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography
} from 'antd';
import { useI18n } from '../../i18n';
import QualityExecutionSummary from './QualityExecutionSummary.jsx';
import PromptPresetSelector from './PromptPresetSelector.jsx';
import QaFindingReview from './QaFindingReview.jsx';
import { disableQaRule } from './qaFindingReview.mjs';
import { usePollingRefresh } from '../../hooks/useAppLifecycle.mjs';

const { Paragraph, Text, Title } = Typography;

function requestId(prefix) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}`;
}

function profileGlossaryIds(profile) {
  return (profile?.assetBindings || [])
    .filter((binding) => binding?.purpose === 'glossary' && binding?.assetId)
    .map((binding) => binding.assetId);
}

export default function AssistantWindow({ api = window.memoqDesktop }) {
  const { t } = useI18n();
  const { message } = AntdApp.useApp();
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('translate');
  const [appState, setAppState] = useState(null);
  const [status, setStatus] = useState(null);
  const [profileId, setProfileId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [glossaryIds, setGlossaryIds] = useState([]);
  const [additionalInstruction, setAdditionalInstruction] = useState('');
  const [translatePresetId, setTranslatePresetId] = useState('');
  const [polishPresetId, setPolishPresetId] = useState('');
  const [qaPresetId, setQaPresetId] = useState('');
  const [busy, setBusy] = useState('');
  const [activeRequestId, setActiveRequestId] = useState('');
  const [assistantResult, setAssistantResult] = useState(null);
  const [qaResult, setQaResult] = useState(null);
  const [error, setError] = useState('');
  const snapshotHashRef = useRef('');
  const activeRequestIdRef = useRef('');

  const profiles = useMemo(() => appState?.contextBuilder?.profiles || [], [appState?.contextBuilder?.profiles]);
  const providers = useMemo(() => appState?.providerHub?.providers || [], [appState?.providerHub?.providers]);
  const assets = useMemo(() => appState?.contextBuilder?.assets || [], [appState?.contextBuilder?.assets]);
  const promptPresets = useMemo(() => appState?.promptPresets || [], [appState?.promptPresets]);
  const profile = profiles.find((item) => item.id === profileId) || profiles[0] || null;
  const provider = providers.find((item) => item.id === providerId) || providers[0] || null;
  const snapshot = status?.currentSnapshot || null;
  const inheritedGlossaryIds = useMemo(() => profileGlossaryIds(profile), [profile]);

  async function refresh(silent = false) {
    try {
      const [nextState, nextStatus] = silent
        ? [null, await api.getQaStatus()]
        : await Promise.all([api.getAppState(), api.getQaStatus()]);
      if (nextState) setAppState(nextState);
      setStatus(nextStatus);
      const nextHash = nextStatus?.currentSnapshot?.contentHash || '';
      if (snapshotHashRef.current && nextHash && snapshotHashRef.current !== nextHash && activeRequestIdRef.current) {
        const staleRequestId = activeRequestIdRef.current;
        await Promise.allSettled([
          api.cancelPreviewAssistant?.(staleRequestId),
          api.cancelQa?.({ requestId: staleRequestId })
        ]);
        activeRequestIdRef.current = '';
        setBusy('');
        setActiveRequestId('');
        setAssistantResult(null);
        setQaResult(null);
        setError(t('assistant.previewChanged'));
      }
      snapshotHashRef.current = nextHash;
      if (!silent) setError('');
    } catch (loadError) {
      if (!silent) setError(String(loadError?.message || t('assistant.loadFailed')));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  usePollingRefresh(refresh, 750);

  useEffect(() => {
    if (!profileId && profiles.length) setProfileId(appState?.contextBuilder?.defaultProfileId || profiles[0].id);
  }, [profiles, profileId, appState?.contextBuilder?.defaultProfileId]);

  useEffect(() => {
    if (!profile) return;
    const nextProviderId = profile.interactiveProviderId || profile.providerId || providers[0]?.id || '';
    setProviderId(nextProviderId);
    setGlossaryIds(profileGlossaryIds(profile));
  }, [profile, providers]);

  useEffect(() => {
    const nextProvider = providers.find((item) => item.id === providerId) || providers[0];
    const nextModel = (nextProvider?.models || []).find((item) => item.id === profile?.interactiveModelId)
      || (nextProvider?.models || []).find((item) => item.enabled !== false)
      || nextProvider?.models?.[0];
    setModel(nextModel?.modelName || nextModel?.id || '');
  }, [providerId, profile?.interactiveModelId, providers]);

  function assetOverride() {
    const inherited = [...inheritedGlossaryIds].sort().join('|');
    const selected = [...glossaryIds].sort().join('|');
    return { mode: inherited === selected ? 'inherit' : 'override', glossaryAssetIds: glossaryIds };
  }

  function updatePromptPresets(next) {
    setAppState((current) => ({ ...(current || {}), promptPresets: next }));
  }

  async function runAssistant(operation) {
    const id = requestId(`assistant-${operation}`);
    setBusy(operation);
    setActiveRequestId(id);
    activeRequestIdRef.current = id;
    setAssistantResult(null);
    setError('');
    try {
      const result = await api.runPreviewAssistant({
        operation,
        requestId: id,
        profileId: profile?.id,
        providerId,
        model,
        assets: assetOverride(),
        prompt: { presetId: operation === 'polish' ? polishPresetId : translatePresetId, additionalInstruction }
      });
      if (activeRequestIdRef.current !== id) return;
      setAssistantResult(result);
    } catch (runError) {
      setError(String(runError?.message || t('assistant.runFailed')));
    } finally {
      setBusy('');
      setActiveRequestId('');
      if (activeRequestIdRef.current === id) activeRequestIdRef.current = '';
    }
  }

  async function runQa() {
    const id = requestId('assistant-qa');
    setBusy('qa');
    setActiveRequestId(id);
    activeRequestIdRef.current = id;
    setQaResult(null);
    setError('');
    try {
      const result = await api.checkQaSegment({
        requestId: id,
        profileId: profile?.id,
        ai: { enabled: true, providerId, model },
        prompt: { presetId: qaPresetId, additionalInstruction },
        assets: assetOverride()
      });
      const currentStatus = await api.getQaStatus();
      setStatus(currentStatus);
      if (activeRequestIdRef.current === id && currentStatus?.currentSnapshot?.contentHash === result.contentHash) {
        setQaResult(result);
      } else {
        setError(t('assistant.previewChanged'));
      }
    } catch (runError) {
      setError(String(runError?.message || t('quality.checkFailed')));
    } finally {
      setBusy('');
      setActiveRequestId('');
      if (activeRequestIdRef.current === id) activeRequestIdRef.current = '';
    }
  }

  async function cancel() {
    if (!activeRequestId) return;
    await Promise.allSettled([
      api.cancelPreviewAssistant?.(activeRequestId),
      api.cancelQa?.({ requestId: activeRequestId })
    ]);
    setBusy('');
    setActiveRequestId('');
    activeRequestIdRef.current = '';
  }

  async function copy(value) {
    await api.copyText(value || '');
    message.success(t('assistant.copied'));
  }

  async function disableFindingRule(finding) {
    const result = await disableQaRule({
      api,
      profileId: qaResult?.configuration?.profileId || profile?.id || '',
      ruleId: finding.ruleId
    });
    if (result.profile?.id) {
      setAppState((current) => ({
        ...(current || {}),
        contextBuilder: {
          ...(current?.contextBuilder || {}),
          profiles: (current?.contextBuilder?.profiles || []).map((item) => item.id === result.profile.id ? result.profile : item)
        }
      }));
    }
    return result;
  }

  function canDisableFindingRule(finding) {
    const resultProfileId = qaResult?.configuration?.profileId || profile?.id || '';
    const resultProfile = profiles.find((item) => item.id === resultProfileId);
    return Boolean(resultProfile?.qaRules?.some((rule) => rule.id === finding.ruleId));
  }

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;

  const findings = qaResult?.findings || [];
  const aiStatus = qaResult?.execution?.ai?.status || '';
  const aiUnavailable = ['failed', 'circuit-open', 'cancelled'].includes(aiStatus);
  return (
    <Space direction="vertical" size="middle" className="assistant-window">
      <Title level={4}>{t('assistant.title')}</Title>
      <Segmented block value={mode} onChange={setMode} options={[
        { value: 'translate', label: t('assistant.translatePolish') },
        { value: 'qa', label: t('assistant.qa') }
      ]} />
      {error ? <Alert type="error" showIcon closable message={error} onClose={() => setError('')} action={<Button className="assistant-action-button" size="small" onClick={() => mode === 'qa' ? runQa() : refresh()}>{t('common.retry')}</Button>} /> : null}
      {!snapshot ? <Alert type="warning" showIcon message={t('quality.waitingForPreview')} /> : null}
      <Space wrap className="assistant-route-controls">
        <Select value={profileId} onChange={setProfileId} placeholder={t('quality.profile')} options={profiles.map((item) => ({ value: item.id, label: item.name }))} />
        <Select value={providerId} onChange={setProviderId} placeholder={t('common.provider')} options={providers.map((item) => ({ value: item.id, label: item.name }))} />
        <Select value={model} onChange={setModel} placeholder={t('quality.model')} options={(provider?.models || []).filter((item) => item.enabled !== false).map((item) => ({ value: item.modelName || item.id, label: item.modelName }))} />
      </Space>
      <Select
        mode="multiple"
        allowClear
        value={glossaryIds}
        onChange={setGlossaryIds}
        placeholder={t('assistant.terminologyAssets')}
        options={assets.filter((item) => item.type === 'glossary').map((item) => ({ value: item.id, label: item.name }))}
        className="assistant-glossary-select"
      />
      {mode === 'translate' ? (
        <Space direction="vertical" className="quality-page">
          <Text>{t('promptPresets.translatePreset')}</Text>
          <PromptPresetSelector api={api} presets={promptPresets} scope="translate" value={translatePresetId} onChange={setTranslatePresetId} onPresetsChange={updatePromptPresets} />
          <Text>{t('promptPresets.polishPreset')}</Text>
          <PromptPresetSelector api={api} presets={promptPresets} scope="polish" value={polishPresetId} onChange={setPolishPresetId} onPresetsChange={updatePromptPresets} />
        </Space>
      ) : (
        <PromptPresetSelector api={api} presets={promptPresets} scope="qa" value={qaPresetId} onChange={setQaPresetId} onPresetsChange={updatePromptPresets} />
      )}
      <Input.TextArea rows={3} value={additionalInstruction} maxLength={2000} showCount onChange={(event) => setAdditionalInstruction(event.target.value)} placeholder={t('assistant.additionalInstruction')} />
      <Card size="small" title={t('quality.currentSegment')}>
        <Paragraph>{snapshot?.source || '-'}</Paragraph>
        <Text type="secondary">{snapshot?.target || '-'}</Text>
      </Card>

      {mode === 'translate' ? (
        <>
          <Space wrap>
            <Button className="assistant-action-button" type="primary" icon={<ReloadOutlined />} loading={busy === 'translate'} disabled={!snapshot || Boolean(busy)} onClick={() => runAssistant('translate')}>{t('assistant.translate')}</Button>
            <Button className="assistant-action-button" loading={busy === 'polish'} disabled={!snapshot?.target || Boolean(busy)} onClick={() => runAssistant('polish')}>{t('assistant.polish')}</Button>
            {busy ? <Button className="assistant-action-button" danger icon={<StopOutlined />} onClick={cancel}>{t('common.cancel')}</Button> : null}
          </Space>
          {assistantResult ? (
            <Card size="small" title={t('assistant.generatedResult')} extra={<Button type="text" icon={<CopyOutlined />} aria-label={t('assistant.copy')} onClick={() => copy(assistantResult.text)} />}>
              <Paragraph copyable={false}>{assistantResult.text}</Paragraph>
              <Space wrap><Tag>{assistantResult.providerName || assistantResult.providerId} / {assistantResult.model}</Tag><Tag>{assistantResult.durationMs ?? assistantResult.latencyMs ?? 0} ms</Tag><Tag>{t(assistantResult.fromCache ? 'assistant.cacheHit' : 'assistant.providerGenerated')}</Tag><Tag>{t('assistant.termMatches', { count: assistantResult.terminology?.matchCount || 0 })}</Tag></Space>
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <Space wrap>
            <Button className="assistant-action-button" type="primary" icon={<ReloadOutlined />} loading={busy === 'qa'} disabled={!snapshot || Boolean(busy)} onClick={runQa}>{t('quality.recheck')}</Button>
            {busy ? <Button className="assistant-action-button" danger icon={<StopOutlined />} onClick={cancel}>{t('common.cancel')}</Button> : null}
          </Space>
          {qaResult ? <QualityExecutionSummary compact execution={qaResult.execution} /> : null}
          {qaResult && aiUnavailable ? <Alert type="warning" showIcon message={t('quality.aiFailedTitle')} description={t('quality.aiFailedDescription')} action={<Button size="small" onClick={runQa}>{t('common.retry')}</Button>} /> : null}
          {qaResult && findings.length === 0 && !aiUnavailable ? <Alert type="success" showIcon message={t('quality.checkCompleteNoFindings')} /> : null}
          {findings.length ? <QaFindingReview
            findings={findings}
            requestId={qaResult.requestId}
            profileId={qaResult?.configuration?.profileId || profile?.id || ''}
            onCopy={(value) => api.copyText(value)}
            onLoadFeedback={(requestId) => api.getQaHistoryEntry(requestId)}
            onSaveFeedback={(payload) => api.saveQaFeedback(payload)}
            onDisableRule={disableFindingRule}
            canDisableRule={canDisableFindingRule}
          /> : qaResult ? null : <Empty description={t('assistant.runQaHint')} />}
        </>
      )}
    </Space>
  );
}
