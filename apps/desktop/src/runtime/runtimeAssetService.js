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

  /** Update display metadata and this asset's bindings in one state write.
   * @param {any} payload
   */
  function saveAssetDetails(payload = {}) {
    const state = loadState();
    const asset = state.assets.find((/** @type {any} */ item) => item.id === payload.assetId);
    if (!asset) throw new Error('Asset not found. Refresh the asset list.');
    const name = String(payload.name || '').trim();
    if (!name || name.length > 200) throw new Error('Asset name must contain 1 to 200 characters.');
    if (payload.expectedName !== asset.name) throw new Error('Asset changed. Reopen its settings before saving.');
    if (!Array.isArray(payload.profileIds) || !Array.isArray(payload.expectedBindings)
      || !['glossary', 'custom_tm'].includes(String(asset.type || ''))) throw new Error('Invalid asset binding request.');
    const selected = new Set(payload.profileIds);
    if (state.profiles.filter((/** @type {any} */ profile) => selected.has(profile.id)).length !== selected.size) {
      throw new Error('A selected profile no longer exists. Reopen asset settings.');
    }
    const role = asset.type;
    const enabledField = role === 'glossary' ? 'useUploadedGlossary' : 'useCustomTm';
    const bindingsFor = (/** @type {any} */ profile) => (profile.assetBindings || []).filter((/** @type {any} */ binding) => binding.purpose === role).map((/** @type {any} */ binding) => binding.assetId).sort();
    const nextProfiles = state.profiles.map((/** @type {any} */ profile) => {
      const currentIds = bindingsFor(profile);
      if (!selected.has(profile.id) && !currentIds.includes(asset.id)) return profile;
      const expected = payload.expectedBindings.find((/** @type {any} */ entry) => entry.profileId === profile.id);
      if (!expected || !Array.isArray(expected.assetIds) || JSON.stringify(currentIds) !== JSON.stringify([...expected.assetIds].sort())
        || (payload.enableBindings === true && selected.has(profile.id) && expected.enabled !== (profile[enabledField] !== false))) {
        throw new Error('Profile asset bindings changed. Reopen asset settings before saving.');
      }
      if (selected.has(profile.id) && currentIds.includes(asset.id)) {
        return payload.enableBindings === true && profile[enabledField] === false ? { ...profile, [enabledField]: true } : profile;
      }
      const nextBindings = (profile.assetBindings || []).filter((/** @type {any} */ binding) => selected.has(profile.id)
        ? binding.purpose !== role : binding.assetId !== asset.id);
      if (selected.has(profile.id)) nextBindings.push({ assetId: asset.id, purpose: role });
      const selectionField = role === 'glossary' ? 'glossaryAssetId' : 'customTmAssetId';
      const assetSelections = { ...profile.assetSelections };
      const selectedBinding = nextBindings.find((/** @type {any} */ binding) => binding.purpose === role);
      if (selectedBinding) assetSelections[selectionField] = selectedBinding.assetId;
      else delete assetSelections[selectionField];
      return { ...profile, assetBindings: nextBindings, assetSelections,
        ...(payload.enableBindings === true && selected.has(profile.id) ? { [enabledField]: true } : {}) };
    });
    const updatedAsset = { ...asset, name };
    saveState({ ...state, profiles: nextProfiles, assets: state.assets.map((/** @type {any} */ item) => item.id === asset.id ? updatedAsset : item) });
    parsedAssetCache.clear();
    return updatedAsset;
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
    for (const key of parsedAssetCache.keys()) {
      if (String(key).startsWith(`${asset.id}:`)) parsedAssetCache.delete(key);
    }
    if (asset.storedPath && fs.existsSync(asset.storedPath)) {
      fs.rmSync(asset.storedPath, { force: true });
    }
    saveState(state);
    return { ok: true };
  }

  return Object.freeze({
    deleteAsset,
    saveAssetDetails,
    importAssetFromPath
  });
}

module.exports = {
  createRuntimeAssetService
};
