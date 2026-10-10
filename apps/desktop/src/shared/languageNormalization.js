/**
 * Normalizes raw memoQ/provider language text into a comparable form.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeLanguageInput(value) {
  return String(value || '')
    .trim()
    .replace(/_/g, '-')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const LANGUAGE_ALIAS_MAP = new Map([
  ['中文', 'zh'], ['简体中文', 'zh-Hans'], ['繁体中文', 'zh-Hant'],
  ['英文', 'en'], ['英语', 'en'], ['日语', 'ja'], ['日文', 'ja'], ['韩语', 'ko'],
  ['法语', 'fr'], ['德语', 'de'], ['西班牙语', 'es'], ['葡萄牙语', 'pt'],
  ['日本語', 'ja'], ['한국어', 'ko'], ['繁體中文', 'zh-Hant'], ['简体', 'zh-Hans'], ['繁體', 'zh-Hant'],
  ['jpn', 'ja'], ['kor', 'ko'], ['deu', 'de'], ['ger', 'de'], ['fra', 'fr'], ['fre', 'fr'],
  ['spa', 'es'], ['por', 'pt'], ['ita', 'it'], ['rus', 'ru'], ['ara', 'ar'],
  ['eng', 'en'],
  ['eng us', 'en-US'],
  ['eng usa', 'en-US'],
  ['eng united states', 'en-US'],
  ['eng uk', 'en-GB'],
  ['eng united kingdom', 'en-GB'],
  ['english', 'en'],
  ['english united states', 'en-US'],
  ['english us', 'en-US'],
  ['english usa', 'en-US'],
  ['english united kingdom', 'en-GB'],
  ['english uk', 'en-GB'],
  ['zho', 'zh'],
  ['zho cn', 'zh-CN'],
  ['zho china', 'zh-CN'],
  ['zho prc', 'zh-CN'],
  ['zho hans', 'zh-Hans'],
  ['zho hant', 'zh-Hant'],
  ['chinese', 'zh'],
  ['chinese simplified', 'zh-Hans'],
  ['chinese traditional', 'zh-Hant'],
  ['chinese prc', 'zh-CN'],
  ['chinese china', 'zh-CN'],
  ['chinese mainland', 'zh-CN'],
  ['chinese taiwan', 'zh-TW'],
  ['japanese', 'ja'],
  ['korean', 'ko'],
  ['french', 'fr'],
  ['german', 'de'],
  ['spanish', 'es'],
  ['italian', 'it'],
  ['portuguese', 'pt'],
  ['russian', 'ru'],
  ['arabic', 'ar']
]);

/**
 * Normalizes a language code or name into a canonical BCP-47-like tag.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeCanonicalLanguageTag(value) {
  const normalized = normalizeLanguageInput(value);
  if (!normalized) {
    return '';
  }

  const lower = normalized.toLowerCase();
  if (LANGUAGE_ALIAS_MAP.has(lower)) {
    return /** @type {string} */ (LANGUAGE_ALIAS_MAP.get(lower));
  }
  const spaced = lower.replace(/-/g, ' ');
  if (LANGUAGE_ALIAS_MAP.has(spaced)) {
    return /** @type {string} */ (LANGUAGE_ALIAS_MAP.get(spaced));
  }

  const parts = lower.split('-').filter(Boolean);
  if (!parts.length) {
    return normalized;
  }

  const [language, ...rest] = parts;
  if (!/^[a-z]{2,3}$/.test(language)) {
    return normalized;
  }

  const normalizedRest = rest.map((part) => {
    if (/^[a-z]{4}$/.test(part)) {
      return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
    }
    if (/^[a-z]{2}$/.test(part) || /^\d{3}$/.test(part)) {
      return part.toUpperCase();
    }
    return part;
  });

  return [language, ...normalizedRest].join('-');
}

/**
 * @param {unknown} tag
 * @returns {string}
 */
function getBaseLanguage(tag) {
  const normalized = normalizeCanonicalLanguageTag(tag);
  return normalized ? normalized.split('-')[0] : '';
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function getLanguageAliasKeys(value) {
  const canonical = normalizeCanonicalLanguageTag(value);
  if (!canonical) {
    return ['*'];
  }

  const keys = [canonical];
  const baseLanguage = getBaseLanguage(canonical);
  if (baseLanguage && baseLanguage !== canonical) {
    keys.push(baseLanguage);
  }
  return [...new Set(keys)];
}

const ASSET_LANGUAGE_CODES = require('./assetLanguages.json');
const languageNames = ['en', 'zh-CN'].map((locale) => new Intl.DisplayNames([locale], { type: 'language' }));
const regionNames = ['en', 'zh-CN'].map((locale) => new Intl.DisplayNames([locale], { type: 'region' }));

// memoQ exports use names such as Portuguese_Brazil. Register the same language
// names shown by the picker, with separators normalized, before resolving tags.
for (const code of ASSET_LANGUAGE_CODES) {
  const [base, region] = code.split('-');
  for (const [index, names] of languageNames.entries()) {
    // CLDR may display pt-BR as Brazilian Portuguese, whereas memoQ uses Portuguese_Brazil.
    if (/^[A-Z]{2}$/.test(region || '')) {
      const exportedName = `${names.of(base)} ${regionNames[index].of(region)}`.toLowerCase();
      if (!LANGUAGE_ALIAS_MAP.has(exportedName)) LANGUAGE_ALIAS_MAP.set(exportedName, code);
    }
    const key = normalizeLanguageInput(names.of(code)).toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    if (key && !LANGUAGE_ALIAS_MAP.has(key)) LANGUAGE_ALIAS_MAP.set(key, code);
  }
}


/** Resolve a known language name or valid tag; never treat an arbitrary header as a language.
 * @param {unknown} value
 * @returns {string}
 */
function resolveAssetLanguage(value) {
  const raw = normalizeLanguageInput(value);
  const candidate = normalizeCanonicalLanguageTag(raw);
  for (const code of ASSET_LANGUAGE_CODES) {
    if (languageNames.some((names) => names.of(code)?.toLowerCase() === raw.toLowerCase())) return code;
  }
  if (!ASSET_LANGUAGE_CODES.includes(candidate.split('-')[0])) return '';
  try { return Intl.getCanonicalLocales(candidate)[0] || ''; } catch { return ''; }
}

module.exports = {
  resolveAssetLanguage,
  getBaseLanguage,
  getLanguageAliasKeys,
  normalizeCanonicalLanguageTag
};
