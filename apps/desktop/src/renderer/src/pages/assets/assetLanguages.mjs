import languageCodes from '../../../../shared/assetLanguages.json' with { type: 'json' };

export function buildAssetLanguageOptions(locale = 'en', selected = []) {
  const names = new Intl.DisplayNames([locale], { type: 'language' });
  const english = new Intl.DisplayNames(['en'], { type: 'language' });
  return [...new Set([...languageCodes, ...selected.filter(Boolean)])].map((value) => {
    let name = value;
    let englishName = value;
    try { name = names.of(value); englishName = english.of(value); } catch { /* Keep legacy values visible for correction. */ }
    return { value, label: `${name} (${value})`, searchLabel: `${name} ${englishName} ${value}` };
  });
}

export function isValidLanguageColumnDraft(columns = []) {
  return columns.length >= 2 && columns.every((column) => Number.isInteger(column.columnIndex) && column.language)
    && new Set(columns.map((column) => column.columnIndex)).size === columns.length
    && new Set(columns.map((column) => column.language)).size === columns.length;
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
