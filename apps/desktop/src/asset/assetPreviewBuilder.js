const fs = require('fs');

const { ASSET_PURPOSES, normalizeAssetPurpose } = require('./assetRules');

const DEFAULT_PREVIEW_MAX_ROWS = 50;
const DEFAULT_PREVIEW_MAX_CHARACTERS = 2000;

/**
 * @typedef {Object} AssetPreviewOptions
 * @property {unknown=} maxRows
 * @property {unknown=} maxCharacters
 * @property {boolean=} smartParsingAvailable
 */

/**
 * @typedef {Object} AssetPreviewHelpers
 * @property {(value: unknown) => string} normalizeWhitespace
 * @property {(value: unknown, maxCharacters?: unknown) => string} truncateText
 */

/**
 * @param {Record<string, any>} asset
 * @param {any=} parsed
 * @param {AssetPreviewOptions=} options
 * @param {AssetPreviewHelpers=} helpers
 */
function buildAssetPreview(asset, parsed, options = {}, helpers = /** @type {AssetPreviewHelpers} */ ({})) {
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
      rows: rows.map((/** @type {any} */ entry) => ({
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
      columns: ['sourceText', 'targetText', 'sourceLang', 'targetLang'],
      rows: rows.map((/** @type {any} */ entry) => ({
        sourceText: entry.sourceText || entry.sourceTerm,
        targetText: entry.targetText || entry.targetTerm,
        sourceTerm: entry.sourceTerm || entry.sourceText,
        targetTerm: entry.targetTerm || entry.targetText,
        sourceLang: entry.sourceLang || entry.srcLang || '',
        targetLang: entry.targetLang || entry.tgtLang || '',
        srcLang: entry.srcLang || entry.sourceLang || '',
        tgtLang: entry.tgtLang || entry.targetLang || ''
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
