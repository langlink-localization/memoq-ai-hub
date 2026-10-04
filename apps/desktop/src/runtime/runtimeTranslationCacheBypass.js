'use strict';

// One-shot membership only. Consuming a profile removes it; deleting the
// profile must drop the pending id so a later recreate cannot inherit it.
/**
 * @param {{ loadState: () => { profiles: Array<{ id?: string }> } }} dependencies
 */
function createRuntimeTranslationCacheBypass({ loadState }) {
  /** @type {Set<string>} */
  const pendingIds = new Set();

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function normalizeProfileId(value) {
    return String(value || '').trim();
  }

  /**
   * @param {unknown} profileId
   */
  function arm(profileId) {
    const normalizedProfileId = normalizeProfileId(profileId);
    if (!normalizedProfileId) {
      throw new Error('Profile ID is required to bypass translation cache.');
    }

    const state = loadState();
    if (!state.profiles.some((profile) => profile.id === normalizedProfileId)) {
      throw new Error(`Profile ${normalizedProfileId} not found`);
    }

    pendingIds.add(normalizedProfileId);
    return {
      ok: true,
      profileId: normalizedProfileId,
      bypassPending: true
    };
  }

  /**
   * @param {unknown} profileId
   * @returns {boolean}
   */
  function consume(profileId) {
    const normalizedProfileId = normalizeProfileId(profileId);
    if (!normalizedProfileId || !pendingIds.has(normalizedProfileId)) {
      return false;
    }

    pendingIds.delete(normalizedProfileId);
    return true;
  }

  /**
   * @param {unknown} profileId
   */
  function clear(profileId) {
    pendingIds.delete(normalizeProfileId(profileId));
  }

  return {
    arm,
    consume,
    clear,
    normalizeProfileId,
    pendingIds
  };
}

module.exports = {
  createRuntimeTranslationCacheBypass
};
