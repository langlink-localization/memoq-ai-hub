import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntdApp, Button, ConfigProvider, Result, theme, Typography } from 'antd';
import 'antd/dist/reset.css';
import './index.css';
import App from './App';
import { I18nProvider, useI18n } from './i18n';

const { Paragraph, Text } = Typography;

const appTheme = {
  algorithm: theme.defaultAlgorithm,
  cssVar: {
    prefix: 'memoq',
    key: 'memoq-ai-hub'
  },
  token: {
    colorPrimary: '#0066ff',
    colorSuccess: '#00a68b',
    colorWarning: '#d48806',
    colorError: '#cf294d',
    borderRadius: 4,
    fontFamily: "'Segoe UI', 'PingFang SC', sans-serif"
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      headerHeight: 64,
      headerPadding: '0 24px',
      bodyBg: '#f5f5f5',
      lightSiderBg: '#ffffff'
    }
  }
};

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
    <Result
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
    </Result>
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider theme={appTheme}>
      <AntdApp>
        <I18nProvider>
          <RenderErrorBoundary>
            <App />
          </RenderErrorBoundary>
        </I18nProvider>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
