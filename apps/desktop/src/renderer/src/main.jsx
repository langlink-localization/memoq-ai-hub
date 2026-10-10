import React from 'react';
import ReactDOM from 'react-dom/client';
import { Button, Typography } from 'antd';
import { PageResult } from '@langlink-tech/antd-kit/feedback';
import { LanglinkThemeProvider } from '@langlink-tech/antd-kit/provider';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import 'dayjs/locale/zh-cn';
import 'antd/dist/reset.css';
import './index.css';
import App from './App';
import { I18nProvider, useI18n } from './i18n';
import { appTheme, BRAND } from './theme.js';
import AssistantWindow from './pages/quality/AssistantWindow.jsx';

const { Paragraph, Text } = Typography;

class RenderErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    window.memoqDesktop?.recordRendererLog?.({
      level: 'error',
      event: 'render-error',
      message: error?.message || 'Renderer crashed during render.',
      data: { error, componentStack: info?.componentStack || '' }
    }).catch?.(() => {});
    console.error('Renderer crashed during render.', error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return <RendererErrorFallback error={this.state.error} />;
  }
}

function RendererErrorFallback({ error }) {
  const { t } = useI18n();
  const details = String(error?.stack || error?.message || error || t('app.unknownRenderError'));

  return (
    <PageResult
      status="error"
      className="renderer-error-fallback"
      title={t('app.renderErrorTitle')}
      subTitle={t('app.renderErrorDescription')}
      extra={<Button type="primary" onClick={() => globalThis.location?.reload()}>{t('common.retry')}</Button>}
    >
      <Paragraph>
        <Text strong>{t('app.renderErrorDetails')}</Text>
      </Paragraph>
      <pre className="renderer-error-details">{details}</pre>
    </PageResult>
  );
}

window.addEventListener('error', (event) => {
  window.memoqDesktop?.recordRendererLog?.({
    level: 'error',
    event: 'unhandled-error',
    message: event.error?.message || event.message || 'Unhandled renderer error.',
    data: { error: event.error || event.message || event }
  }).catch?.(() => {});
  console.error('Unhandled renderer error.', event.error || event.message || event);
});

window.addEventListener('unhandledrejection', (event) => {
  window.memoqDesktop?.recordRendererLog?.({
    level: 'error',
    event: 'unhandled-rejection',
    message: event.reason?.message || String(event.reason || 'Unhandled renderer rejection.'),
    data: { error: event.reason || event }
  }).catch?.(() => {});
  console.error('Unhandled renderer rejection.', event.reason || event);
});

function LocalizedAntdRoot() {
  const { locale } = useI18n();
  const windowMode = new URLSearchParams(globalThis.location?.search || '').get('window');
  const compactAssistantWindow = windowMode === 'assistant-float' || windowMode === 'quality-float';
  return (
    // The kit owns the theme, ConfigProvider and AntD App. The app has no theme or density
    // switch: it is always light and comfortable, and nothing is stored.
    <LanglinkThemeProvider
      brand={BRAND}
      mode="light"
      density="comfortable"
      storageKey={false}
      theme={appTheme}
      locale={locale === 'zh-CN' ? zhCN : enUS}
    >
      <RenderErrorBoundary>
        {compactAssistantWindow ? <AssistantWindow /> : <App />}
      </RenderErrorBoundary>
    </LanglinkThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <LocalizedAntdRoot />
    </I18nProvider>
  </React.StrictMode>,
);
