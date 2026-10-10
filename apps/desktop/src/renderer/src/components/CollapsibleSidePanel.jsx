import { SidebarCollapseIcon, SidebarExpandIcon } from '@langlink-tech/antd-kit/icons';
import {
  Button,
  Card,
  Empty,
  Space,
  Tag,
  Tooltip,
  Typography
} from 'antd';
import { EmptyState } from '@langlink-tech/antd-kit/feedback';
import { activateOnKeyboard } from '../uiBehavior.mjs';

const { Text } = Typography;

function SidePanelToggle({ collapsed, onToggle, expandLabel, collapseLabel }) {
  return (
    <Tooltip title={collapsed ? expandLabel : collapseLabel}>
      <Button
        type="text"
        size="small"
        icon={collapsed ? <SidebarExpandIcon /> : <SidebarCollapseIcon />}
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
    return <EmptyState image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }

  return (
    <div
      role="listbox"
      className={`side-panel-list ${collapsed ? 'side-panel-list-collapsed' : ''} ${listClassName}`.trim()}
    >
      {entries.map((entry) => renderExpandedItem(entry, { compact: collapsed, onSelect }))}
    </div>
  );
}

export function SidePanelMeta({ children }) {
  return <div className="side-panel-meta"><Text type="secondary">{children}</Text></div>;
}

export function ProfileListRow({ entry, compact, onClick }) {
  return (
    <div
      key={entry.id}
      role="option"
      tabIndex={0}
      aria-selected={entry.isSelected}
      onClick={onClick}
      onKeyDown={(event) => activateOnKeyboard(event, onClick)}
      className={entry.isSelected ? `side-panel-row side-panel-row-active ${compact ? 'side-panel-row-compact' : ''}`.trim() : `side-panel-row ${compact ? 'side-panel-row-compact' : ''}`.trim()}
    >
      <div className="side-panel-row-content">
        <Tooltip title={entry.label}>
          <Text ellipsis>{entry.label}</Text>
        </Tooltip>
        {Array.isArray(entry.tags) && entry.tags.length ? (
          <Space wrap size={[6, 6]} className="side-panel-row-tags">
            {entry.tags.map((tag) => (
              <Tag key={`${entry.id}-${tag.key}`} color={tag.color} variant="filled">
                {tag.label}
              </Tag>
            ))}
          </Space>
        ) : null}
      </div>
    </div>
  );
}
