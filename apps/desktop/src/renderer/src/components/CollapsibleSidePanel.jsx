import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Empty,
  List,
  Space,
  Tag,
  Tooltip,
  Typography
} from 'antd';

const { Text } = Typography;

function SidePanelToggle({ collapsed, onToggle, expandLabel, collapseLabel }) {
  return (
    <Tooltip title={collapsed ? expandLabel : collapseLabel}>
      <Button
        type="text"
        size="small"
        icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        aria-label={collapsed ? expandLabel : collapseLabel}
        onClick={onToggle}
      />
    </Tooltip>
  );
}

export function CollapsibleSidePanel({
  title,
  collapsed,
  onToggle,
  expandLabel,
  collapseLabel,
  extra,
  collapsedExtra,
  className = '',
  children
}) {
  return (
    <Card
      className={`page-card sticky-panel side-panel-card ${collapsed ? 'side-panel-card-collapsed' : ''} ${className}`.trim()}
    >
      <div className="side-panel-header">
        <div className="side-panel-title-row">{title}</div>
        <div className="side-panel-actions-row">
          {collapsed ? (collapsedExtra || <span />) : extra}
          <SidePanelToggle
            collapsed={collapsed}
            onToggle={onToggle}
            expandLabel={expandLabel}
            collapseLabel={collapseLabel}
          />
        </div>
      </div>
      {children}
    </Card>
  );
}

export function CollapsibleItemList({
  entries = [],
  collapsed,
  emptyText,
  onSelect,
  renderExpandedItem,
  listClassName = ''
}) {
  if (!entries.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }

  return (
    <List
      size="small"
      className={`side-panel-list ${collapsed ? 'side-panel-list-collapsed' : ''} ${listClassName}`.trim()}
      dataSource={entries}
      renderItem={(entry) => renderExpandedItem(entry, { compact: collapsed, onSelect })}
    />
  );
}

export function SidePanelMeta({ children }) {
  return <div className="side-panel-meta"><Text type="secondary">{children}</Text></div>;
}

export function ProfileListRow({ entry, compact, onClick }) {
  return (
    <List.Item
      key={entry.id}
      onClick={onClick}
      className={entry.isSelected ? `side-panel-row side-panel-row-active ${compact ? 'side-panel-row-compact' : ''}`.trim() : `side-panel-row ${compact ? 'side-panel-row-compact' : ''}`.trim()}
    >
      <div className="side-panel-row-content">
        <Tooltip title={entry.label}>
          <Text ellipsis>{entry.label}</Text>
        </Tooltip>
        {Array.isArray(entry.tags) && entry.tags.length ? (
          <Space wrap size={[6, 6]} className="side-panel-row-tags">
            {entry.tags.map((tag) => (
              <Tag key={`${entry.id}-${tag.key}`} color={tag.color} bordered={false}>
                {tag.label}
              </Tag>
            ))}
          </Space>
        ) : null}
      </div>
    </List.Item>
  );
}
