function normalizeLanguageInput(value) {
  return String(value || '')
    .trim()
    .replace(/_/g, '-')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const LANGUAGE_ALIAS_MAP = new Map([
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

function normalizeCanonicalLanguageTag(value) {
  const normalized = normalizeLanguageInput(value);
  if (!normalized) {
    return '';
  }

  const lower = normalized.toLowerCase();
  if (LANGUAGE_ALIAS_MAP.has(lower)) {
    return LANGUAGE_ALIAS_MAP.get(lower);
  }
  const spaced = lower.replace(/-/g, ' ');
  if (LANGUAGE_ALIAS_MAP.has(spaced)) {
    return LANGUAGE_ALIAS_MAP.get(spaced);
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

function getBaseLanguage(tag) {
  const normalized = normalizeCanonicalLanguageTag(tag);
  return normalized ? normalized.split('-')[0] : '';
}

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

module.exports = {
  getBaseLanguage,
  getLanguageAliasKeys,
  normalizeCanonicalLanguageTag
};
