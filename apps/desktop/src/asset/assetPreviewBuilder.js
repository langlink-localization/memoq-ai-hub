const fs = require('fs');
const { rulesFromColumns } = require('./memoqTermRules');

const { ASSET_PURPOSES, normalizeAssetPurpose } = require('./assetRules');

const DEFAULT_PREVIEW_MAX_ROWS = 50;
const DEFAULT_PREVIEW_MAX_CHARACTERS = 2000;

/** @param {unknown} value */
function displayValue(value) {
  return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** @param {string} name */
function isNoteColumn(name) {
  return /(?:^|[ _-])(?:notes?|comments?|remarks?)(?:$|[ _-])/i.test(name)
    || /^(?:entry)?(?:note|notes|comment|comments|remark|remarks)$/i.test(name)
    || /备注|注释|注記/.test(name);
}

/** @param {string} group @param {Record<string, any>=} values */
function detailGroup(group, values = {}) {
  return Object.entries(values).filter(([, value]) => value != null && displayValue(value).trim() !== '')
    .map(([label, value]) => ({ group, label, value: displayValue(value) }));
}

/** Keep runtime notes and prompt metadata intact; only separate the preview presentation.
 * @param {any} entry
 */
function glossaryDetails(entry) {
  const metadata = entry.metadata || {};
  const grouped = ['entry', 'source', 'target'].some((group) => metadata[group] && typeof metadata[group] === 'object');
  const details = grouped
    ? ['entry', 'source', 'target'].flatMap((group) => detailGroup(group, metadata[group]))
    : detailGroup('entry', metadata);
  let note = String(entry.note || '');
  if (grouped && details.length) {
    const flattened = details.map((item) => item.value).join(' | ');
    // This exact prefix is emitted by buildEntriesFromTbStructure. Never split free-form notes on pipes.
    if (note === flattened) note = '';
    else if (note.startsWith(`${flattened} | `)) note = note.slice(flattened.length + 3);
    if (!note) note = [...new Set(details.filter((item) => isNoteColumn(item.label)).map((item) => item.value))].join('\n');
  }
  details.push(...detailGroup('scope', Object.fromEntries(['domain', 'client', 'project'].filter((key) => entry[key]).map((key) => [key, entry[key]]))));
  details.push(...detailGroup('rules', Object.fromEntries(['caseSensitive', 'matchMode', 'priority', 'allowedVariants', 'partOfSpeech'].filter((key) => entry[key] && entry[key] !== 'phrase' && (!Array.isArray(entry[key]) || entry[key].length)).map((key) => [key, entry[key]]))));
  return { termRules: [{ language: entry.srcLang, rule: entry.sourceRules }, { language: entry.tgtLang, rule: entry.targetRules }].filter((item) => item.rule), note, details: details.filter((item) => !isNoteColumn(item.label) || item.value !== note) };
}

/** @param {any} info @param {any[]} cells */
function conceptDetails(info, cells) {
  const excluded = new Set([...info.languageColumns.map((/** @type {any} */ column) => column.columnIndex),
    ...(info.directionalRuleColumns || []).map((/** @type {any} */ column) => column.index)]);
  const details = (info.availableColumnDetails || []).filter((/** @type {any} */ column) => !excluded.has(column.columnIndex))
    .map((/** @type {any} */ column) => {
      const language = info.languageColumns.find((/** @type {any} */ item) =>
        (item.metaColumns || []).some((/** @type {any} */ meta) => meta.index === column.columnIndex));
      const isEntry = (info.tbStructure?.entryMetaColumns || []).some((/** @type {any} */ meta) => meta.index === column.columnIndex);
      return {
        group: language ? `language:${language.language}` : isEntry ? 'entry' : 'columns',
        label: `${column.columnIndex + 1}. ${column.columnName || ''}`,
        value: displayValue(cells[column.columnIndex]),
        isNote: isNoteColumn(column.columnName || '') || (info.tbStructure?.noteColumnIndexes || []).includes(column.columnIndex)
      };
    })
    .filter((/** @type {any} */ item) => item.value.trim());
  return { note: [...new Set(details.filter((/** @type {any} */ item) => item.isNote).map((/** @type {any} */ item) => item.value))].join('\n'), details: details.filter((/** @type {any} */ item) => !item.isNote).map((/** @type {any} */ item) => ({ group: item.group, label: item.label, value: item.value })) };
}

/**
 * @typedef {Object} AssetPreviewOptions
 * @property {unknown=} maxRows
 * @property {unknown=} maxCharacters
 * @property {boolean=} smartParsingAvailable
 */

/**
 * @typedef {Object} AssetPreviewHelpers
 * @property {(value: unknown) => string} normalizeWhitespace
 * @property {(value: unknown, maxCharacters?: unknown) => string} truncateText
 */

/**
 * @param {Record<string, any>} asset
 * @param {any=} parsed
 * @param {AssetPreviewOptions=} options
 * @param {AssetPreviewHelpers=} helpers
 */
function buildAssetPreview(asset, parsed, options = {}, helpers = /** @type {AssetPreviewHelpers} */ ({})) {
  const {
    normalizeWhitespace,
    truncateText
  } = helpers;
  const assetType = normalizeAssetPurpose(asset?.type);
  const maxRows = Number.isFinite(Number(options.maxRows)) && Number(options.maxRows) > 0
    ? Math.floor(Number(options.maxRows))
    : DEFAULT_PREVIEW_MAX_ROWS;
  const maxCharacters = Number.isFinite(Number(options.maxCharacters)) && Number(options.maxCharacters) > 0
    ? Math.floor(Number(options.maxCharacters))
    : DEFAULT_PREVIEW_MAX_CHARACTERS;

  if (assetType === ASSET_PURPOSES.brief) {
    const raw = fs.readFileSync(asset.storedPath, 'utf8');
    const normalized = normalizeWhitespace(raw);
    const text = truncateText(normalized, maxCharacters);
    return {
      type: assetType,
      rowCount: parsed.rowCount || (normalized ? normalized.split('\n').length : 0),
      text,
      truncated: normalized.length > text.length,
      parsingMode: 'plain',
      smartParsingAvailable: options.smartParsingAvailable === true,
      smartParsingRecommended: false,
      usedFallbackMapping: false,
      detectedMapping: {},
      mappingConfidence: { level: 'high', score: 1 },
      mappingWarnings: [],
      unmappedColumns: [],
      upgradeHint: ''
    };
  }

  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  let rows = entries.slice(0, maxRows);
  if (assetType === ASSET_PURPOSES.glossary && parsed.parseInfo?.tbStructure?.kind === 'multilingual') {
    /** @type {Map<string, any[]>} */
    const pairs = new Map();
    for (const entry of entries) {
      const key = `${entry.srcLang}:${entry.tgtLang}`;
      if (!pairs.has(key)) pairs.set(key, []);
      const samples = pairs.get(key);
      if (samples && samples.length < maxRows) samples.push(entry);
    }
    rows = [];
    for (let index = 0; index < maxRows && rows.length < maxRows; index += 1) {
      for (const samples of pairs.values()) {
        if (samples[index] && rows.length < maxRows) rows.push(samples[index]);
      }
    }
  }

  if (assetType === ASSET_PURPOSES.glossary && parsed.parseInfo?.directionMode === 'automatic' && parsed.parseInfo?.languageColumns?.length >= 2) {
    const info = parsed.parseInfo;
    const ruleColumns = info.directionalRuleColumns || [];
    return {
      ...info, type: assetType, previewLayout: 'concepts', rowCount: info.conceptCount,
      columns: [...info.languageColumns.map((/** @type {any} */ column) => `language_${column.columnIndex}`), ...(ruleColumns.length ? ['rules'] : []), 'note'],
      columnLanguages: Object.fromEntries(info.languageColumns.map((/** @type {any} */ column) => [`language_${column.columnIndex}`, column.language])),
      rows: (info.conceptRows || []).slice(0, maxRows).map((/** @type {any[]} */ cells) => ({
        ...conceptDetails(info, cells),
        termRules: info.languageColumns.map((/** @type {any} */ column) => ({ language: column.language, rule: rulesFromColumns(column.metaColumns, cells, cells[column.columnIndex]) })).filter((/** @type {any} */ item) => item.rule),
        ...Object.fromEntries(info.languageColumns.map((/** @type {any} */ column) => [`language_${column.columnIndex}`, cells[column.columnIndex] || ''])),
        ...(ruleColumns.length ? { rules: ruleColumns.map((/** @type {any} */ column) => ({ role: column.role, value: cells[column.index] || '' })).filter((/** @type {any} */ rule) => rule.value) } : {})
      })),
      truncated: info.conceptCount > Math.min(maxRows, (info.conceptRows || []).length)
    };
  }
  if (assetType === ASSET_PURPOSES.glossary) {
    return {
      type: assetType,
      rowCount: parsed.rowCount || entries.length,
      columns: ['sourceTerm', 'targetTerm', 'srcLang', 'tgtLang', 'forbidden', 'note'],
      rows: rows.map((/** @type {any} */ entry) => ({
        sourceTerm: entry.sourceTerm,
        targetTerm: entry.targetTerm,
        srcLang: entry.srcLang || '',
        tgtLang: entry.tgtLang || '',
        forbidden: entry.forbidden === true || entry.targetRules?.forbidden === true,
        ...glossaryDetails(entry)
      })),
      truncated: entries.length > rows.length,
      ...(parsed.parseInfo || {})
    };
  }

  if (assetType === ASSET_PURPOSES.customTm) {
    return {
      type: assetType,
      rowCount: parsed.rowCount || entries.length,
      columns: ['sourceText', 'targetText', 'sourceLang', 'targetLang'],
      rows: rows.map((/** @type {any} */ entry) => ({
        sourceText: entry.sourceText || entry.sourceTerm,
        targetText: entry.targetText || entry.targetTerm,
        sourceTerm: entry.sourceTerm || entry.sourceText,
        targetTerm: entry.targetTerm || entry.targetText,
        sourceLang: entry.sourceLang || entry.srcLang || '',
        targetLang: entry.targetLang || entry.tgtLang || '',
        srcLang: entry.srcLang || entry.sourceLang || '',
        tgtLang: entry.tgtLang || entry.targetLang || '',
        details: [...detailGroup('entry', entry.metadata), ...detailGroup('context', entry.context)]
      })),
      truncated: entries.length > rows.length,
      ...(parsed.parseInfo || {})
    };
  }

  return {
    type: assetType,
    rowCount: 0,
    truncated: false
  };
}

module.exports = {
  DEFAULT_PREVIEW_MAX_CHARACTERS,
  DEFAULT_PREVIEW_MAX_ROWS,
  buildAssetPreview
};
