export const TABLE_SCROLL_X = 'max-content';

export const TABLE_COLUMN_WIDTHS = Object.freeze({
  rowNumber: '4rem',
  booleanControl: '7.5rem',
  numericMetric: '7.5rem',
  status: '8rem',
  singleAction: '9rem',
  fallbackStage: '9rem',
  entityName: '11rem',
  diagnostic: '12rem',
  inlineActions: '12rem',
  timestamp: '13rem',
  identifier: '14rem'
});

// Listy pads every item 12px 16px; these keep the spacing the former antd List rows had.
export const LISTY_SMALL_ITEM_STYLE = { padding: '8px 16px' };
// The row content brings its own padding class.
export const LISTY_FLUSH_ITEM_STYLE = { padding: 0 };
