// Provider health is a conditional projection of a real network operation.
// Share ownership across connection checks and translation, not their execution.
/** @typedef {{ id: string, fingerprint: string }} ProviderStatusToken */
function createRuntimeProviderStatus() {
  /** @type {Map<string, ProviderStatusToken>} */
  const pending = new Map();

  /** @param {{ id: string }} provider */
  function begin(provider) {
    const token = { id: provider.id, fingerprint: JSON.stringify(provider) };
    pending.set(token.id, token);
    return token;
  }

  /** @param {ProviderStatusToken | undefined} token */
  function release(token) {
    if (token && pending.get(token.id) === token) pending.delete(token.id);
  }

  /**
   * @param {{ providers: Array<{ id: string }> }} state
   * @param {ProviderStatusToken | undefined} token
   * @param {Record<string, unknown>} patch
   */
  function apply(state, token, patch) {
    if (!token || pending.get(token.id) !== token) return false;
    const provider = state.providers.find(item => item.id === token.id);
    release(token);
    if (!provider || JSON.stringify(provider) !== token.fingerprint) return false;
    Object.assign(provider, patch);
    return true;
  }

  return { begin, release, apply, invalidate: (/** @type {string} */ id) => pending.delete(id) };
}

module.exports = { createRuntimeProviderStatus };
