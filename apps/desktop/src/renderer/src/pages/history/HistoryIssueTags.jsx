import { Space, Tag, Typography } from 'antd';
import { buildHistoryIssueTags } from './historyPresentation.mjs';

const { Text } = Typography;

export default function HistoryIssueTags({ t, record = {}, activeIssue = '', maxVisible }) {
  const tags = buildHistoryIssueTags(record);
  const visibleLimit = Number(maxVisible || tags.length || 0);
  const visibleTags = tags.slice(0, visibleLimit);
  const hiddenCount = Math.max(0, tags.length - visibleTags.length);
  const normalizedActiveIssue = String(activeIssue || '').trim().toLowerCase();

  if (!tags.length) return <Text type="secondary">-</Text>;

  return (
    <Space wrap size={[4, 4]} className="history-issue-tag-row">
      {visibleTags.map((tag) => (
        <Tag
          key={tag.key}
          color={tag.color}
          className={normalizedActiveIssue && tag.issue === normalizedActiveIssue ? 'history-issue-tag-active' : ''}
        >
          {t(`history.issueTag.${tag.key}`)}
        </Tag>
      ))}
      {hiddenCount > 0 ? <Tag>+{hiddenCount}</Tag> : null}
    </Space>
  );
}
