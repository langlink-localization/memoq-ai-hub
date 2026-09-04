const path = require('path');

const ASSET_PURPOSES = {
  glossary: 'glossary',
  customTm: 'custom_tm',
  brief: 'brief'
};

const ASSET_IMPORT_RULES = {
  [ASSET_PURPOSES.glossary]: {
    extensions: ['.csv', '.tsv', '.txt', '.xlsx', '.tbx']
  },
  [ASSET_PURPOSES.customTm]: {
    extensions: ['.csv', '.tsv', '.txt', '.xlsx', '.tmx']
  },
  [ASSET_PURPOSES.brief]: {
    extensions: ['.txt', '.md']
  }
};

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeAssetPurpose(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === ASSET_PURPOSES.glossary) return ASSET_PURPOSES.glossary;
  if (normalized === ASSET_PURPOSES.customTm) return ASSET_PURPOSES.customTm;
  if (normalized === ASSET_PURPOSES.brief) return ASSET_PURPOSES.brief;
  return '';
}

/**
 * @param {Record<string, unknown>=} binding
 * @returns {{ assetId: string, purpose: string } | null}
 */
function normalizeAssetBinding(binding = {}) {
  const assetId = String(binding.assetId || '').trim();
  if (!assetId) {
    return null;
  }

  return {
    assetId,
    purpose: normalizeAssetPurpose(binding.purpose)
  };
}

function getAssetImportRules() {
  return {
    glossary: { ...ASSET_IMPORT_RULES[ASSET_PURPOSES.glossary] },
    customTm: { ...ASSET_IMPORT_RULES[ASSET_PURPOSES.customTm] },
    brief: { ...ASSET_IMPORT_RULES[ASSET_PURPOSES.brief] }
  };
}

/**
 * @param {unknown} assetType
 * @param {unknown} sourcePath
 * @returns {{ type: string, extension: string }}
 */
function validateAssetImport(assetType, sourcePath) {
  const normalizedType = normalizeAssetPurpose(assetType);
  const rules = ASSET_IMPORT_RULES[normalizedType];

  if (!rules) {
    throw new Error(`Unsupported asset type "${assetType}".`);
  }

  const extension = path.extname(String(sourcePath || '')).trim().toLowerCase();
  if (!rules.extensions.includes(extension)) {
    throw new Error(`Unsupported ${normalizedType} file type "${extension || 'unknown'}". Allowed: ${rules.extensions.join(', ')}.`);
  }

  return {
    type: normalizedType,
    extension
  };
}

module.exports = {
  ASSET_PURPOSES,
  getAssetImportRules,
  normalizeAssetBinding,
  normalizeAssetPurpose,
  validateAssetImport
};
