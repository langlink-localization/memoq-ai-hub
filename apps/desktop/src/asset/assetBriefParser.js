const crypto = require('crypto');
const fs = require('fs');

const MAX_BRIEF_CHARACTERS = 12000;

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function fingerprintText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

/**
 * @param {unknown} value
 * @param {number} maxCharacters
 * @returns {string}
 */
function truncateText(value, maxCharacters) {
  const normalized = String(value || '');
  if (!maxCharacters || normalized.length <= maxCharacters) {
    return normalized;
  }

  return normalized.slice(0, maxCharacters).trimEnd();
}

/**
 * @param {{ storedPath: string }} asset
 * @returns {{ text: string, fingerprint: string, rowCount: number }}
 */
function parseBriefAsset(asset) {
  const raw = fs.readFileSync(asset.storedPath, 'utf8');
  const text = truncateText(normalizeWhitespace(raw), MAX_BRIEF_CHARACTERS);

  return {
    text,
    fingerprint: fingerprintText(text),
    rowCount: text ? text.split('\n').length : 0
  };
}

module.exports = {
  MAX_BRIEF_CHARACTERS,
  fingerprintText,
  normalizeWhitespace,
  parseBriefAsset,
  truncateText
};
