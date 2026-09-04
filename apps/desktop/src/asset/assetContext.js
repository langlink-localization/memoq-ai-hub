const {
  ASSET_PURPOSES,
  getAssetImportRules,
  normalizeAssetBinding,
  normalizeAssetPurpose,
  validateAssetImport
} = require('./assetRules');
const {
  createTbFingerprint,
  createTbMatcher,
  evaluateTerminologyQa,
  matchTbEntries,
  normalizeForMatch,
  normalizeTbEntry,
  renderMatchedTbMetadataBlock,
  renderMatchedTerminologyBlock
} = require('./assetTerminology');
const {
  ASSET_SEPARATOR,
  buildAssetContext
} = require('./assetContextAssembler');
const {
  getParsedAsset: getCachedParsedAsset
} = require('./assetParseCache');
const {
  buildAssetPreview: buildAssetPreviewResult
} = require('./assetPreviewBuilder');
const {
  fingerprintText,
  normalizeWhitespace,
  parseBriefAsset,
  truncateText
} = require('./assetBriefParser');

/**
 * @param {Record<string, any>} asset
 * @param {any} cache
 * @param {Record<string, any>=} options
 * @returns {any}
 */
function getParsedAsset(asset, cache, options = {}) {
  return getCachedParsedAsset(asset, cache, options, {
    fingerprintText,
    parseBriefAsset
  });
}

/**
 * @param {Record<string, any>} asset
 * @param {Map<string, any>=} cache
 * @param {Record<string, any>=} options
 * @returns {any}
 */
function buildAssetPreview(asset, cache = new Map(), options = {}) {
  const parsed = getParsedAsset(asset, cache, options);
  return buildAssetPreviewResult(asset, parsed, options, /** @type {any} */ ({ normalizeWhitespace, truncateText }));
}

module.exports = {
  ASSET_PURPOSES,
  ASSET_SEPARATOR,
  buildAssetContext: (/** @type {Record<string, any>} */ input = {}) => buildAssetContext({
    ...input,
    getParsedAsset
  }),
  buildAssetPreview,
  createTbFingerprint,
  createTbMatcher,
  evaluateTerminologyQa,
  fingerprintText,
  getAssetImportRules,
  matchTbEntries,
  normalizeAssetBinding,
  normalizeAssetPurpose,
  normalizeForMatch,
  normalizeTbEntry,
  renderMatchedTbMetadataBlock,
  renderMatchedTerminologyBlock,
  validateAssetImport
};
