const fs = require('fs');

const { ASSET_PURPOSES, normalizeAssetPurpose } = require('./assetRules');

const DEFAULT_PREVIEW_MAX_ROWS = 50;
const DEFAULT_PREVIEW_MAX_CHARACTERS = 2000;

function buildAssetPreview(asset, parsed, options = {}, helpers = {}) {
  const {
    normalizeWhitespace,
    truncateText
  } = helpers;
  const assetType = normalizeAssetPurpose(asset?.type);
  const maxRows = Number.isFinite(Number(options.maxRows)) && Number(options.maxRows) > 0
    ? Math.floor(Number(options.maxRows))
    : DEFAULT_PREVIEW_MAX_ROWS;
  const maxCharacters = Number.isFinite(Number(options.maxCharacters)) && Number(options.maxCharacters) > 0
    ? Math.floor(Number(options.maxCharacters))
    : DEFAULT_PREVIEW_MAX_CHARACTERS;

  if (assetType === ASSET_PURPOSES.brief) {
    const raw = fs.readFileSync(asset.storedPath, 'utf8');
    const normalized = normalizeWhitespace(raw);
    const text = truncateText(normalized, maxCharacters);
    return {
      type: assetType,
      rowCount: parsed.rowCount || (normalized ? normalized.split('\n').length : 0),
      text,
      truncated: normalized.length > text.length,
      parsingMode: 'plain',
      smartParsingAvailable: options.smartParsingAvailable === true,
      smartParsingRecommended: false,
      usedFallbackMapping: false,
      detectedMapping: {},
      mappingConfidence: { level: 'high', score: 1 },
      mappingWarnings: [],
      unmappedColumns: [],
      upgradeHint: ''
    };
  }

  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  const rows = entries.slice(0, maxRows);

  if (assetType === ASSET_PURPOSES.glossary) {
    return {
      type: assetType,
      rowCount: parsed.rowCount || entries.length,
      columns: ['sourceTerm', 'targetTerm', 'srcLang', 'tgtLang', 'forbidden', 'note'],
      rows: rows.map((entry) => ({
        sourceTerm: entry.sourceTerm,
        targetTerm: entry.targetTerm,
        srcLang: entry.srcLang || '',
        tgtLang: entry.tgtLang || '',
        forbidden: entry.forbidden === true,
        note: entry.note || ''
      })),
      truncated: entries.length > rows.length,
      ...(parsed.parseInfo || {})
    };
  }

  if (assetType === ASSET_PURPOSES.customTm) {
    return {
      type: assetType,
      rowCount: parsed.rowCount || entries.length,
      columns: ['sourceTerm', 'targetTerm', 'srcLang', 'tgtLang'],
      rows: rows.map((entry) => ({
        sourceTerm: entry.sourceTerm,
        targetTerm: entry.targetTerm,
        srcLang: entry.srcLang || '',
        tgtLang: entry.tgtLang || ''
      })),
      truncated: entries.length > rows.length,
      ...(parsed.parseInfo || {})
    };
  }

  return {
    type: assetType,
    rowCount: 0,
    truncated: false
  };
}

module.exports = {
  DEFAULT_PREVIEW_MAX_CHARACTERS,
  DEFAULT_PREVIEW_MAX_ROWS,
  buildAssetPreview
};
