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

function getParsedAsset(asset, cache, options = {}) {
  return getCachedParsedAsset(asset, cache, options, {
    fingerprintText,
    parseBriefAsset
  });
}

function buildAssetPreview(asset, cache = new Map(), options = {}) {
  const parsed = getParsedAsset(asset, cache, options);
  return buildAssetPreviewResult(asset, parsed, options, {
    normalizeWhitespace,
    truncateText
  });
}

module.exports = {
  ASSET_PURPOSES,
  ASSET_SEPARATOR,
  buildAssetContext: (input = {}) => buildAssetContext({
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
