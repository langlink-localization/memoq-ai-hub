const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateAssetImport } = require('../asset/assetContext');
const { buildProfileReferenceMessage } = require('./runtimeTranslationSupport');

/**
 * @param {import('../types/runtimeDomain').AssetServiceDependencies} dependencies
 */
function createRuntimeAssetService({
  loadState,
  saveState,
  assetsDir,
  parsedAssetCache,
  createId,
  nowIso
}) {
  function importAssetFromPath(/** @type {any} */ assetType, /** @type {any} */ sourcePath) {
    const state = loadState();
    const normalizedAsset = validateAssetImport(assetType, sourcePath);
    const buffer = fs.readFileSync(sourcePath);
    const id = createId('asset');
    const fileName = path.basename(sourcePath);
    const storedPath = path.join(assetsDir, `${id}-${fileName}`);
    fs.copyFileSync(sourcePath, storedPath);
    const asset = {
      id,
      type: normalizedAsset.type,
      name: fileName,
      fileName,
      storedPath,
      fileSize: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      createdAt: nowIso()
    };
    state.assets.unshift(asset);
    saveState(state);
    return asset;
  }

  function deleteAsset(/** @type {any} */ assetId) {
    const state = loadState();
    const asset = state.assets.find((/** @type {any} */ item) => item.id === assetId);
    if (!asset) throw new Error(`Asset ${assetId} not found`);

    const referencedBy = state.profiles
      .filter((/** @type {any} */ profile) => (profile.assetBindings || []).some((/** @type {any} */ binding) => binding.assetId === assetId))
      .map((/** @type {any} */ profile) => profile.name);
    if (referencedBy.length) {
      throw new Error(buildProfileReferenceMessage(referencedBy, `Asset "${asset.name}"`));
    }

    state.assets = state.assets.filter((/** @type {any} */ item) => item.id !== assetId);
    parsedAssetCache.delete(`${asset.id}:${asset.sha256 || ''}`);
    if (asset.storedPath && fs.existsSync(asset.storedPath)) {
      fs.rmSync(asset.storedPath, { force: true });
    }
    saveState(state);
    return { ok: true };
  }

  return Object.freeze({
    deleteAsset,
    importAssetFromPath
  });
}

module.exports = {
  createRuntimeAssetService
};
