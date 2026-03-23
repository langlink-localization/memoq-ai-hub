const fs = require('fs');

const { ASSET_PURPOSES, normalizeAssetPurpose } = require('./assetRules');
const {
  parseCustomTmAsset,
  parseGlossaryAsset
} = require('./assetGlossaryParser');

function parseAsset(asset, options = {}, helpers = {}) {
  if (!asset?.storedPath || !fs.existsSync(asset.storedPath)) {
    throw new Error(`Asset "${asset?.name || asset?.id || 'unknown'}" is missing its stored file.`);
  }

  if (normalizeAssetPurpose(asset.type) === ASSET_PURPOSES.glossary) {
    return parseGlossaryAsset(asset, options);
  }

  if (normalizeAssetPurpose(asset.type) === ASSET_PURPOSES.customTm) {
    return parseCustomTmAsset(asset, options);
  }

  if (normalizeAssetPurpose(asset.type) === ASSET_PURPOSES.brief) {
    return helpers.parseBriefAsset(asset);
  }

  return {
    text: '',
    fingerprint: helpers.fingerprintText(''),
    rowCount: 0
  };
}

function getParsedAsset(asset, cache, options = {}, helpers = {}) {
  const parsingModeKey = options.smartParsingAvailable === true ? 'smart' : 'fallback';
  const cacheKey = `${asset.id}:${asset.sha256 || ''}:${parsingModeKey}`;
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const parsed = parseAsset(asset, options, helpers);
  if (cache) {
    cache.set(cacheKey, parsed);
  }
  return parsed;
}

module.exports = {
  getParsedAsset,
  parseAsset
};
