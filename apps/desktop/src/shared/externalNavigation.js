/**
 * @typedef {Object} NormalizeExternalUrlOptions
 * @property {string=} label
 * @property {boolean=} allowEmpty
 */

/**
 * Normalizes an external link, refusing anything that is not a bare HTTPS URL.
 * @param {unknown} value
 * @param {NormalizeExternalUrlOptions=} options
 * @returns {string}
 */
function normalizeExternalHttpsUrl(value, options = {}) {
  const label = String(options.label || 'External URL');
  const allowEmpty = options.allowEmpty === true;
  const normalized = String(value || '').trim();

  if (!normalized) {
    if (allowEmpty) {
      return '';
    }
    throw new Error(`${label} is required.`);
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include credentials.`);
  }

  return parsed.toString();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeUpdateArtifactName(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('Update artifact name is required.');
  }
  if (
    normalized === '.'
    || normalized === '..'
    || normalized.length > 255
    || /[\\/:*?"<>|\0]/.test(normalized)
    || /[. ]$/.test(normalized)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(normalized)
  ) {
    throw new Error('Update artifact name must be a plain file name.');
  }

  return normalized;
}

module.exports = {
  normalizeExternalHttpsUrl,
  normalizeUpdateArtifactName
};
