import { useState } from 'react';
import { Alert, Button, Collapse, Form, Input, Select, Space } from 'antd';
import { useI18n } from '../../i18n';
import { useRequestLifecycle } from '../../hooks/useRequestLifecycle.mjs';
import { runLatestRequest } from '../../requestLifecycle.mjs';
import { buildAssetLanguageOptions } from '../assets/assetLanguages.mjs';
import TranslationEvidence from '../../components/TranslationEvidence.jsx';

export default function AssetTestPanel({ profile, isDirty }) {
  const { t, locale } = useI18n();
  const [sourceLanguage, setSourceLanguage] = useState('zh');
  const [targetLanguage, setTargetLanguage] = useState('ja');
  const [sourceText, setSourceText] = useState('');
  const [targetText, setTargetText] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const lifecycle = useRequestLifecycle();
  const options = buildAssetLanguageOptions(locale);
  const invalidate = () => { lifecycle.invalidate(); setResult(null); setError(''); setPending(false); };
  async function test() {
    if (pending) return;
    setPending(true); setError(''); setResult(null);
    await runLatestRequest(lifecycle, {
      load: () => window.memoqDesktop.testAssets({ profileId: profile.id, sourceLanguage, targetLanguage, sourceText, targetText }),
      resolve: setResult, reject: (failure) => setError(failure.message), settle: () => setPending(false)
    });
  }
  return <Collapse items={[{ key: 'test', label: t('evidence.testAssets'), children: <Space orientation="vertical" className="app-block-space">
    <Alert type="info" showIcon title={t(isDirty ? 'evidence.saveFirst' : 'evidence.testHint')} />
    <Form layout="vertical" component="div">
      <Form.Item label={t('evidence.sourceLanguage')}><Select aria-label={t('evidence.sourceLanguage')} value={sourceLanguage} options={options} showSearch={{ optionFilterProp: 'searchLabel' }} onChange={(value) => { invalidate(); setSourceLanguage(value); }} /></Form.Item>
      <Form.Item label={t('evidence.targetLanguage')}><Select aria-label={t('evidence.targetLanguage')} value={targetLanguage} options={options} showSearch={{ optionFilterProp: 'searchLabel' }} onChange={(value) => { invalidate(); setTargetLanguage(value); }} /></Form.Item>
      <Form.Item label={t('history.source')}><Input.TextArea aria-label={t('history.source')} value={sourceText} maxLength={20000} autoSize={{ minRows: 3, maxRows: 8 }} onChange={(event) => { invalidate(); setSourceText(event.target.value); }} /></Form.Item>
      <Form.Item label={t('evidence.optionalTarget')}><Input.TextArea aria-label={t('evidence.optionalTarget')} value={targetText} maxLength={20000} autoSize={{ minRows: 3, maxRows: 8 }} onChange={(event) => { invalidate(); setTargetText(event.target.value); }} /></Form.Item>
      <Button onClick={test} loading={pending} disabled={isDirty || !sourceText.trim()}>{t('evidence.testAssets')}</Button>
    </Form>
    {error ? <Alert type="error" showIcon title={error} /> : null}
    {result ? <TranslationEvidence evidence={result.evidence} t={t} /> : null}
  </Space> }]} />;
}
