const { buildAssetPreview } = require('../asset/assetContext');
const { ensureAsset } = require('./runtimeState');
const { hasSmartTbParsingCapability } = require('./runtimeTranslationService');

const DEFAULT_ASSET_PREVIEW_MAX_ROWS = 50;
const DEFAULT_ASSET_PREVIEW_MAX_CHARACTERS = 2000;

// Owns the terminology-asset TB structure domain: preview assembly, detected
// structure adoption, and manual TB mapping configuration. State access stays
// behind the loadState/saveState boundary; parsedAssetCache is the shared
// parsed-asset eviction cache owned by the runtime composition root.
/**
 * @param {{ loadState: () => any, saveState: (state: any) => any, parsedAssetCache: Map<string, any> }} dependencies
 */
function createRuntimeAssetTbService({ loadState, saveState, parsedAssetCache }) {
  /**
   * @param {any} value
   */
  function normalizeManualMapping(value = {}) {
    return {
      srcColumn: String(value?.srcColumn || '').trim(),
      tgtColumn: String(value?.tgtColumn || '').trim()
    };
  }

  /**
   * @param {any} value
   */
  function normalizeLanguagePair(value = {}) {
    return {
      source: String(value?.source || '').trim(),
      target: String(value?.target || '').trim()
    };
  }

  /**
   * @param {any} state
   * @param {any} assetId
   */
  function findAssetById(state, assetId) {
    return state.assets.find((/** @type {any} */ item) => item.id === String(assetId || '').trim()) || null;
  }

  /**
   * @param {any} state
   * @param {any} assetId
   * @param {any} nextTbState
   */
  function updateAssetTbState(state, assetId, nextTbState = {}) {
    const asset = findAssetById(state, assetId);
    if (!asset) {
      throw new Error(`Asset "${assetId || 'unknown'}" was not found.`);
    }

    for (const [key, value] of Object.entries(nextTbState)) {
      asset[key] = value;
    }

    parsedAssetCache.clear();
    saveState(state);
    return ensureAsset(asset);
  }

  /**
   * @param {any} asset
   * @param {any} preview
   */
  function createDetectedTbState(asset, preview = {}) {
    if (!preview?.tbStructure || !preview?.tbStructureFingerprint) {
      return null;
    }

    return {
      tbStructure: {
        ...preview.tbStructure,
        derivedFromSha256: String(preview.tbStructure.derivedFromSha256 || asset.sha256 || ''),
        fingerprint: String(preview.tbStructure.fingerprint || preview.tbStructureFingerprint || ''),
        summary: String(preview.tbStructure.summary || preview.tbStructureSummary || '')
      },
      tbLanguagePair: normalizeLanguagePair(preview.languagePair || asset.tbLanguagePair || {}),
      tbStructureConfidence: preview.tbStructureConfidence && typeof preview.tbStructureConfidence === 'object'
        ? preview.tbStructureConfidence
        : asset.tbStructureConfidence || null,
      tbStructureSource: String(preview.tbStructureSource || asset.tbStructureSource || '').trim()
    };
  }

  /**
   * @param {any} asset
   * @param {any} preview
   */
  function isAppliedTbStructurePreview(asset, preview = {}) {
    if (!preview?.tbStructureAvailable) {
      return false;
    }

    if (String(preview.tbStructuringMode || '').trim() === 'manual_mapping') {
      return true;
    }

    const previewFingerprint = String(preview.tbStructureFingerprint || '').trim();
    return Boolean(previewFingerprint && previewFingerprint === String(asset?.tbStructure?.fingerprint || '').trim());
  }

  /**
   * @param {any} state
   * @param {any} asset
   * @param {any} options
   */
  function buildAssetPreviewResponse(state, asset, options = {}) {
    const preview = buildAssetPreview(asset, parsedAssetCache, {
      maxRows: options.maxRows || DEFAULT_ASSET_PREVIEW_MAX_ROWS,
      maxCharacters: options.maxCharacters || DEFAULT_ASSET_PREVIEW_MAX_CHARACTERS,
      smartParsingAvailable: hasSmartTbParsingCapability(state)
    });

    return {
      assetId: asset.id,
      assetName: asset.name,
      assetType: asset.type,
      parseStatus: 'ok',
      tbStructureApplied: isAppliedTbStructurePreview(asset, preview),
      ...preview
    };
  }

  /**
   * @param {any} assetId
   * @param {any} payload
   */
  function applyAssetTbStructure(assetId, payload = {}) {
    const state = loadState();
    const normalizedAssetId = String(assetId || '').trim();
    const asset = findAssetById(state, normalizedAssetId);
    if (!asset) {
      throw new Error(`Asset "${normalizedAssetId || 'unknown'}" was not found.`);
    }

    const preview = payload?.tbStructure && typeof payload.tbStructure === 'object'
      ? {
        tbStructure: payload.tbStructure,
        tbStructureFingerprint: String(payload.tbStructureFingerprint || payload.tbStructure?.fingerprint || '').trim(),
        tbStructureSummary: String(payload.tbStructureSummary || payload.tbStructure?.summary || '').trim(),
        tbStructureSource: String(payload.tbStructureSource || payload.tbStructure?.sourceOfTruth || '').trim(),
        languagePair: normalizeLanguagePair(payload.languagePair || payload.tbStructure?.languagePair || asset.tbLanguagePair || {}),
        tbStructureConfidence: payload.tbStructureConfidence && typeof payload.tbStructureConfidence === 'object'
          ? payload.tbStructureConfidence
          : payload.tbStructure?.confidence || asset.tbStructureConfidence || null
      }
      : buildAssetPreview(asset, parsedAssetCache, {
        maxRows: DEFAULT_ASSET_PREVIEW_MAX_ROWS,
        maxCharacters: DEFAULT_ASSET_PREVIEW_MAX_CHARACTERS,
        smartParsingAvailable: hasSmartTbParsingCapability(state)
      });
    const detectedTbState = createDetectedTbState(asset, preview);
    if (!detectedTbState) {
      throw new Error('No detected TB structure is available for this asset.');
    }

    return updateAssetTbState(state, normalizedAssetId, detectedTbState);
  }

  /**
   * @param {any} assetId
   * @param {any} payload
   */
  function saveAssetTbConfig(assetId, payload = {}) {
    const state = loadState();
    const asset = findAssetById(state, assetId);
    if (!asset) {
      throw new Error(`Asset "${assetId || 'unknown'}" was not found.`);
    }

    const manualMapping = normalizeManualMapping(payload?.manualMapping);
    const languagePair = normalizeLanguagePair(payload?.languagePair);
    if (!manualMapping.srcColumn || !manualMapping.tgtColumn) {
      throw new Error('Manual TB mapping requires both source and target columns.');
    }
    if (!languagePair.source || !languagePair.target) {
      throw new Error('TB language pair requires both source and target values.');
    }

    return updateAssetTbState(state, asset.id, {
      tbManualMapping: manualMapping,
      tbLanguagePair: languagePair,
      tbStructure: null,
      tbStructureConfidence: { level: 'high', score: 1 },
      tbStructureSource: 'manual_mapping'
    });
  }

  return {
    findAssetById,
    buildAssetPreviewResponse,
    applyAssetTbStructure,
    saveAssetTbConfig
  };
}

module.exports = {
  createRuntimeAssetTbService
};
