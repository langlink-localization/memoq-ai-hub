import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import 'antd/dist/reset.css';
import './index.css';
import App from './App';
import { I18nProvider } from './i18n';

const appTheme = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#0066ff',
    colorSuccess: '#00d1b2',
    colorWarning: '#ffaa00',
    colorError: '#ff3b5c',
    colorInfo: '#0066ff',
    colorTextBase: '#2c2c2c',
    colorBgBase: '#fafafa',
    colorPrimaryBg: '#f0f4ff',
    colorPrimaryBgHover: '#d6e4ff',
    colorPrimaryBorder: '#adc6ff',
    colorPrimaryBorderHover: '#85a5ff',
    colorPrimaryHover: '#3b82f6',
    colorPrimaryActive: '#004fd1',
    colorPrimaryText: '#0066ff',
    colorPrimaryTextHover: '#3b82f6',
    colorPrimaryTextActive: '#004fd1',
    colorSuccessBg: '#e6faf5',
    colorSuccessBgHover: '#ccf5ea',
    colorSuccessBorder: '#99e9d5',
    colorSuccessBorderHover: '#66dcc0',
    colorSuccessHover: '#00bfa0',
    colorSuccessActive: '#00a68b',
    colorSuccessText: '#00d1b2',
    colorSuccessTextHover: '#00bfa0',
    colorSuccessTextActive: '#00a68b',
    colorWarningBg: '#fff8e6',
    colorWarningBgHover: '#fff0cc',
    colorWarningBorder: '#ffd966',
    colorWarningBorderHover: '#ffcc33',
    colorWarningHover: '#e69900',
    colorWarningActive: '#cc8800',
    colorWarningText: '#ffaa00',
    colorWarningTextHover: '#e69900',
    colorWarningTextActive: '#cc8800',
    colorErrorBg: '#fff2f5',
    colorErrorBgHover: '#ffe4ea',
    colorErrorBorder: '#ff9bad',
    colorErrorBorderHover: '#ff7a92',
    colorErrorHover: '#e62e56',
    colorErrorActive: '#cc1a43',
    colorErrorText: '#ff3b5c',
    colorErrorTextHover: '#e62e56',
    colorErrorTextActive: '#cc1a43',
    colorInfoBg: '#f0f4ff',
    colorInfoBgHover: '#d6e4ff',
    colorInfoBorder: '#adc6ff',
    colorInfoBorderHover: '#85a5ff',
    colorInfoHover: '#3b82f6',
    colorInfoActive: '#004fd1',
    colorInfoText: '#0066ff',
    colorInfoTextHover: '#3b82f6',
    colorInfoTextActive: '#004fd1',
    colorText: 'rgba(44, 44, 44, 0.90)',
    colorTextSecondary: 'rgba(44, 44, 44, 0.70)',
    colorTextTertiary: 'rgba(44, 44, 44, 0.45)',
    colorTextQuaternary: 'rgba(44, 44, 44, 0.25)',
    colorTextDisabled: 'rgba(44, 44, 44, 0.25)',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#f5f5f5',
    colorBgSpotlight: 'rgba(44, 44, 44, 0.85)',
    colorBgMask: 'rgba(44, 44, 44, 0.45)',
    colorBorder: '#e5e5e5',
    colorBorderSecondary: '#f2f2f2',
    borderRadius: 4,
    borderRadiusXS: 2,
    borderRadiusSM: 3,
    borderRadiusLG: 6,
    padding: 12,
    paddingSM: 8,
    paddingLG: 16,
    margin: 12,
    marginSM: 8,
    marginLG: 16,
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
    boxShadowSecondary: '0 2px 8px 0 rgba(0, 0, 0, 0.08)'
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

    return (
      <div style={{
        minHeight: '100vh',
        padding: 24,
        background: 'linear-gradient(180deg, #f2f5fb 0%, #ffffff 100%)',
        color: '#17263c',
        fontFamily: "'Segoe UI', 'PingFang SC', sans-serif"
      }}>
        <h1 style={{ marginTop: 0 }}>memoQ AI Hub failed to render</h1>
        <p style={{ marginBottom: 12 }}>The renderer hit an error during startup. The details below can help us fix it.</p>
        <pre style={{
          padding: 16,
          borderRadius: 12,
          background: '#fff',
          border: '1px solid #dbe6f5',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}>
          {String(this.state.error?.stack || this.state.error?.message || this.state.error || 'Unknown renderer error')}
        </pre>
      </div>
    );
  }
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
    <RenderErrorBoundary>
      <ConfigProvider theme={appTheme}>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ConfigProvider>
    </RenderErrorBoundary>
  </React.StrictMode>,
);
