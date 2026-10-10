import languageCodes from '../../../../shared/assetLanguages.json' with { type: 'json' };

// Preview responses contain canonical language tags. Validate the actual picker
// values here; human-readable/exported names are resolved by the backend.
function resolveAssetLanguage(value) {
  try {
    const tag = Intl.getCanonicalLocales(String(value || '').trim().replace(/_/g, '-'))[0] || '';
    return languageCodes.includes(tag.split('-')[0]) ? tag : '';
  } catch { return ''; }
}


export function buildAssetLanguageOptions(locale = 'en', selected = []) {
  const names = new Intl.DisplayNames([locale], { type: 'language' });
  const english = new Intl.DisplayNames(['en'], { type: 'language' });
  return [...new Set([...languageCodes, ...selected.filter(Boolean).map((value) => resolveAssetLanguage(value) || value)])].map((value) => {
    let name = value;
    let englishName = value;
    try { name = names.of(value); englishName = english.of(value); } catch { /* Keep legacy values visible for correction. */ }
    return { value, label: `${name} (${value})`, searchLabel: `${name} ${englishName} ${value}` };
  });
}

export function normalizeLanguageColumnDraft(columns = []) {
  return columns.map((column) => ({ ...column, language: resolveAssetLanguage(column.language) || column.language }));
}

export function normalizeRuleLanguagePair(pair = {}) {
  return { source: resolveAssetLanguage(pair.source) || pair.source || '', target: resolveAssetLanguage(pair.target) || pair.target || '' };
}

export function getLanguageColumnIssues(columns = []) {
  const seen = new Map();
  return columns.flatMap((column) => {
    const language = resolveAssetLanguage(column.language);
    if (!language) return [{ kind: 'invalid', columnIndex: column.columnIndex, language: String(column.language || '') }];
    if (seen.has(language)) return [{ kind: 'duplicate', columnIndex: column.columnIndex, otherColumnIndex: seen.get(language), language }];
    seen.set(language, column.columnIndex);
    return [];
  });
}

export function isValidLanguageColumnDraft(columns = []) {
  return columns.length >= 2 && columns.every((column) => Number.isInteger(column.columnIndex) && column.columnIndex >= 0)
    && new Set(columns.map((column) => column.columnIndex)).size === columns.length
    && getLanguageColumnIssues(columns).length === 0;
}

export function getAssetColumnDetails(preview = {}, hasHeader = true) {
  if (!Array.isArray(preview.rawColumnDetails)) return preview.availableColumnDetails || [];
  return preview.rawColumnDetails.map((column) => ({ ...column,
    columnName: hasHeader ? column.columnName : '',
    samples: hasHeader ? column.samples : [column.columnName, ...column.samples].slice(0, 3)
  }));
}

export function getConfiguredAssetLanguages(asset = {}) {
  const columns = asset.tbLanguageColumns?.length ? asset.tbLanguageColumns : asset.tbStructure?.languageColumns;
  if (columns?.length) return [...new Set(columns.map((column) => column.language).filter(Boolean))];
  const pair = asset.tbStructure?.languagePair || asset.tbLanguagePair || {};
  return [...new Set([pair.source, pair.target].filter(Boolean))];
}

export function matchesAssetSearch(asset, query, profileNames = [], languageLabels = [], typeLabel = '') {
  const words = String(query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [asset.name, asset.fileName, asset.type, typeLabel, ...profileNames, ...languageLabels].join(' ').toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}
