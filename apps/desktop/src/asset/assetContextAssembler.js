const crypto = require('crypto');

const {
  ASSET_PURPOSES,
  normalizeAssetBinding,
  normalizeAssetPurpose
} = require('./assetRules');
const {
  createTbFingerprint,
  createTbMatcher
} = require('./assetTerminology');

const ASSET_SEPARATOR = '\n\n---\n\n';

function fingerprintText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function hashObject(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex');
}

function getBoundAssetsByPurpose(assets = [], assetBindings = []) {
  const assetById = new Map((Array.isArray(assets) ? assets : []).map((asset) => [asset.id, asset]));

  return (Array.isArray(assetBindings) ? assetBindings : [])
    .map((binding) => normalizeAssetBinding(binding))
    .filter(Boolean)
    .map((binding) => ({
      binding,
      asset: assetById.get(binding.assetId) || null
    }))
    .filter((entry) => entry.asset)
    .filter((entry) => !entry.binding.purpose || normalizeAssetPurpose(entry.asset.type) === entry.binding.purpose);
}

function combineParsedEntries(entries = []) {
  const nonEmpty = entries.filter((entry) => String(entry.text || '').trim());
  const text = nonEmpty.map((entry) => entry.text).join(ASSET_SEPARATOR);
  const fingerprint = fingerprintText(text);

  return {
    text,
    fingerprint,
    count: nonEmpty.length
  };
}

function buildAssetContext({
  assets = [],
  assetBindings = [],
  profile = {},
  cache = new Map(),
  getParsedAsset
} = {}) {
  const boundEntries = getBoundAssetsByPurpose(assets, assetBindings);
  const glossaryEntries = [];
  const briefEntries = [];
  const assetHints = [];

  for (const entry of boundEntries) {
    const purpose = normalizeAssetPurpose(entry.binding.purpose || entry.asset.type);
    assetHints.push(`${purpose}:${entry.asset.name}`);

    if (purpose !== ASSET_PURPOSES.glossary && purpose !== ASSET_PURPOSES.brief) {
      continue;
    }

    try {
      const parsed = getParsedAsset(entry.asset, cache, {
        smartParsingAvailable: profile?.smartTbParsingAvailable === true
      });
      if (purpose === ASSET_PURPOSES.glossary) {
        glossaryEntries.push(parsed);
      } else {
        briefEntries.push(parsed);
      }
    } catch (error) {
      throw new Error(`Failed to parse ${purpose} asset "${entry.asset.name}": ${error.message}`);
    }
  }

  const glossary = combineParsedEntries(glossaryEntries);
  const brief = combineParsedEntries(briefEntries);
  const tbEntries = glossaryEntries.flatMap((entry) => entry.entries || []);
  const tbStructures = glossaryEntries
    .map((entry) => entry.parseInfo?.tbStructure)
    .filter((item) => item && typeof item === 'object');
  const languagePairs = tbStructures
    .map((item) => item.languagePair)
    .filter((item) => item && (item.source || item.target));
  const tb = {
    entries: tbEntries,
    fingerprint: createTbFingerprint(tbEntries),
    matcher: createTbMatcher(tbEntries),
    renderedText: profile?.useUploadedGlossary === false ? '' : glossary.text,
    structureAvailable: tbStructures.length > 0,
    structureFingerprint: tbStructures.length === 1
      ? String(tbStructures[0].fingerprint || '')
      : tbStructures.length
        ? hashObject(tbStructures.map((item) => item.fingerprint || item.summary || ''))
        : '',
    structureSummary: tbStructures.map((item) => item.summary).filter(Boolean).join('\n'),
    structuringMode: tbStructures.length ? (tbStructures[0].sourceOfTruth === 'header_inferred' ? 'explicitly_inferred' : tbStructures[0].sourceOfTruth === 'manual_mapping' ? 'manual_mapping' : 'ai_structured') : '',
    languagePair: languagePairs[0] || { source: '', target: '' }
  };
  const tbMetadataText = tb.languagePair?.source || tb.languagePair?.target
    ? `TB language pair: ${tb.languagePair.source || ''} -> ${tb.languagePair.target || ''}`.trim()
    : '';

  return {
    glossaryText: profile?.useUploadedGlossary === false ? '' : glossary.text,
    tbMetadataText,
    glossaryFingerprint: profile?.useUploadedGlossary === false ? fingerprintText('') : glossary.fingerprint,
    briefText: profile?.useBrief === false ? '' : brief.text,
    briefFingerprint: profile?.useBrief === false ? fingerprintText('') : brief.fingerprint,
    assetHints,
    tb
  };
}

module.exports = {
  ASSET_SEPARATOR,
  buildAssetContext,
  combineParsedEntries,
  getBoundAssetsByPurpose,
  __internals: {
    fingerprintText,
    hashObject
  }
};
