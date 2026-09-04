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
const {
  createCustomTmFingerprint,
  createCustomTmMatcher
} = require('./assetTmMatcher');

const ASSET_SEPARATOR = '\n\n---\n\n';

/**
 * @param {unknown} value
 * @returns {string}
 */
function fingerprintText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function hashObject(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex');
}

/**
 * @param {any[]=} assets
 * @param {any[]=} assetBindings
 * @returns {any[]}
 */
function getBoundAssetsByPurpose(assets = [], assetBindings = []) {
  const assetById = new Map((Array.isArray(assets) ? assets : []).map((asset) => [asset.id, asset]));

  return (Array.isArray(assetBindings) ? assetBindings : [])
    .map((binding) => normalizeAssetBinding(binding))
    .filter(Boolean)
    .map((/** @type {any} */ binding) => ({
      binding,
      asset: assetById.get(binding.assetId) || null
    }))
    .filter((entry) => entry.asset)
    .filter((entry) => !entry.binding.purpose || normalizeAssetPurpose(entry.asset.type) === entry.binding.purpose);
}

/**
 * @param {any[]=} entries
 * @returns {Record<string, any>}
 */
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

/**
 * @param {Record<string, any>=} input
 * @returns {Record<string, any>}
 */
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
  const customTmParsedEntries = [];
  const assetHints = [];

  for (const entry of boundEntries) {
    const purpose = normalizeAssetPurpose(entry.binding.purpose || entry.asset.type);
    assetHints.push(`${purpose}:${entry.asset.name}`);

    if (purpose !== ASSET_PURPOSES.glossary && purpose !== ASSET_PURPOSES.brief && purpose !== ASSET_PURPOSES.customTm) {
      continue;
    }

    try {
      const parsed = getParsedAsset(entry.asset, cache, {
        smartParsingAvailable: profile?.smartTbParsingAvailable === true
      });
      if (purpose === ASSET_PURPOSES.glossary) {
        glossaryEntries.push({
          ...parsed,
          entries: (parsed.entries || []).map((/** @type {any} */ term, /** @type {any} */ termIndex) => ({
            ...term,
            id: `${entry.asset.id}:${term.id || `tb-${termIndex + 1}`}`,
            assetId: entry.asset.id,
            assetName: entry.asset.name
          }))
        });
      } else if (purpose === ASSET_PURPOSES.brief) {
        briefEntries.push(parsed);
      } else {
        customTmParsedEntries.push({
          parsed,
          asset: entry.asset
        });
      }
    } catch (/** @type {any} */ error) {
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
  const customTmEntries = customTmParsedEntries.flatMap((entry) => (
    (entry.parsed.entries || []).map((/** @type {any} */ tmEntry) => ({
      ...tmEntry,
      assetId: tmEntry.assetId || entry.asset.id,
      assetName: tmEntry.assetName || entry.asset.name
    }))
  ));
  const customTm = {
    entries: customTmEntries,
    fingerprint: createCustomTmFingerprint(customTmEntries),
    matcher: createCustomTmMatcher(customTmEntries)
  };

  return {
    glossaryText: profile?.useUploadedGlossary === false ? '' : glossary.text,
    tbMetadataText,
    glossaryFingerprint: profile?.useUploadedGlossary === false ? fingerprintText('') : glossary.fingerprint,
    briefText: profile?.useBrief === false ? '' : brief.text,
    briefFingerprint: profile?.useBrief === false ? fingerprintText('') : brief.fingerprint,
    customTmFingerprint: profile?.useCustomTm === false ? fingerprintText('') : customTm.fingerprint,
    assetHints,
    tb,
    customTm: profile?.useCustomTm === false ? { entries: [], fingerprint: fingerprintText(''), matcher: createCustomTmMatcher([]) } : customTm
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
