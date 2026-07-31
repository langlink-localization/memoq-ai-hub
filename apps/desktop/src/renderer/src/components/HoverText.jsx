import { Tooltip } from 'antd';

export default function HoverText({ value, fallback = '-', className = '' }) {
  const normalized = String(value ?? '').trim();
  const displayValue = normalized || fallback;
  const content = <span className={`hover-text ${className}`.trim()}>{displayValue}</span>;

  return normalized ? <Tooltip title={displayValue}>{content}</Tooltip> : content;
}
