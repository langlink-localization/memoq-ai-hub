import { Component } from 'react';
import { Button, Result } from 'antd';

// A page failure must leave navigation and unsaved editor drafts in the shell
// available. The root boundary remains responsible for failures in the shell.
export default class PageErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch() {
    try {
      globalThis.window?.memoqDesktop?.recordRendererLog?.({
        level: 'error', event: 'page-render-error',
        message: 'A page failed to render; the application shell remains available.'
      })?.catch?.(() => {});
    } catch {
      // Diagnostics must not break the recovery surface.
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { t } = this.props;
    return <Result status="error" title={t('app.pageErrorTitle')}
      subTitle={t('app.pageErrorDescription')}
      extra={<Button onClick={() => this.setState({ error: null })}>{t('common.retry')}</Button>} />;
  }
}
