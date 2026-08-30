import { Button, Drawer, Layout, Menu, Select, Space, Tooltip, Typography } from 'antd';
import {
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  ReloadOutlined,
  SelectOutlined
} from '@ant-design/icons';
import DashboardConnectionStatus from './DashboardConnectionStatus.jsx';
import { useI18n } from '../i18n';

const { Sider, Header } = Layout;
const { Text } = Typography;

// Primary navigation chrome: the collapsible desktop sidebar, the mobile nav
// drawer, and the top header (product title, language switch, assistant and
// refresh actions, connection status). Presentation only — navigation intents
// and refresh behavior stay in the app shell.
export function AppNavigation({
  shellNavigationMode,
  navCollapsed,
  onToggleCollapsed,
  activePage,
  mobileNavOpen,
  onCloseMobileNav,
  navItems,
  requestPageNavigation
}) {
  const { t } = useI18n();

  return (
    <>
      {shellNavigationMode !== 'drawer' ? (
        <Sider
          className={`app-sider ${(shellNavigationMode === 'compact' || navCollapsed) ? 'app-sider-collapsed' : ''}`}
          width={248}
          collapsedWidth={80}
          collapsed={shellNavigationMode === 'compact' || navCollapsed}
          trigger={null}
          theme="light"
        >
          <div className={`brand-block ${(shellNavigationMode === 'compact' || navCollapsed) ? 'brand-block-collapsed' : ''}`}>
            <div className="brand-block-top">
              {shellNavigationMode === 'expanded' && !navCollapsed ? <span /> : null}
              {shellNavigationMode === 'expanded' ? (
                <Tooltip title={navCollapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}>
                  <Button
                    type="text"
                    className="app-nav-toggle"
                    icon={navCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                    aria-label={navCollapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}
                    onClick={onToggleCollapsed}
                  />
                </Tooltip>
              ) : null}
            </div>
          </div>
          <nav aria-label={t('navigation.primary')}>
            <Menu
              className="app-nav-menu"
              theme="light"
              mode="inline"
              inlineCollapsed={shellNavigationMode === 'compact' || navCollapsed}
              selectedKeys={[activePage]}
              items={navItems}
              onClick={({ key }) => requestPageNavigation(key)}
            />
          </nav>
        </Sider>
      ) : null}
      <Drawer
        className="app-nav-drawer"
        title={t('app.title')}
        placement="left"
        width="min(320px, calc(100vw - 32px))"
        open={mobileNavOpen}
        onClose={onCloseMobileNav}
      >
        <nav aria-label={t('navigation.primary')}>
          <Menu
            className="app-nav-menu"
            theme="light"
            mode="inline"
            selectedKeys={[activePage]}
            items={navItems}
            onClick={({ key }) => {
              onCloseMobileNav();
              requestPageNavigation(key);
            }}
          />
        </nav>
      </Drawer>
    </>
  );
}

export function AppHeader({
  shellNavigationMode,
  onOpenMobileNav,
  locale,
  setLocale,
  refreshing,
  onRefresh,
  startupStatus,
  initialState
}) {
  const { t } = useI18n();
  const api = window.memoqDesktop;

  return (
    <Header className="app-header">
      <Space className="app-header-bar">
        <Space className="app-header-title">
          {shellNavigationMode === 'drawer' ? (
            <Button
              type="text"
              className="app-mobile-nav-trigger"
              icon={<MenuOutlined />}
              aria-label={t('common.openNavigation')}
              onClick={onOpenMobileNav}
            />
          ) : null}
          <Text strong className="app-header-product">{t('app.title')}</Text>
        </Space>
        <Space wrap className="app-header-controls">
          <Select
            size="small"
            className="app-language-select"
            value={locale}
            options={[{ value: 'en', label: 'English' }, { value: 'zh-CN', label: '中文' }]}
            onChange={setLocale}
          />
          <Tooltip title={t('app.openAssistant')}>
            <Button
              type="text"
              size="small"
              className="app-header-assistant"
              icon={<SelectOutlined />}
              onClick={() => api.openAssistantWindow?.()}
              aria-label={t('app.openAssistant')}
            />
          </Tooltip>
          <Tooltip title={t('app.refresh')}>
            <Button
              type="text"
              size="small"
              className="app-header-refresh"
              icon={<ReloadOutlined />}
              loading={refreshing}
              onClick={onRefresh}
              disabled={startupStatus === 'starting'}
              aria-label={t('app.refresh')}
            />
          </Tooltip>
          <DashboardConnectionStatus initialState={initialState} t={t} />
        </Space>
      </Space>
    </Header>
  );
}
