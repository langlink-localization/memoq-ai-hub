const crypto = require('crypto');
const { hasEffectiveDirectionalRule } = require('./assetTerminology');
const { normalizeCanonicalLanguageTag, resolveAssetLanguage } = require('../shared/languageNormalization');

const TB_STRUCTURE_SAMPLE_ROWS = 8;
/** @type {Record<string, string[]>} */
const SMART_ROLE_ALIASES = {
  id: ['id', 'entryid', 'termid', 'recordid'],
  sourceTerm: ['sourceterm', 'source', 'sourcetext', 'sourcestring', 'sourcephrase', 'srcterm', 'sourcelabel'],
  targetTerm: ['targetterm', 'target', 'targettext', 'targetstring', 'targetphrase', 'tgtterm', 'translation'],
  srcLang: ['sourcelanguage', 'sourcelang', 'srclang', 'fromlanguage'],
  tgtLang: ['targetlanguage', 'targetlang', 'tgtlang', 'tolanguage'],
  domain: ['domain', 'entrydomain', 'subjectdomain', 'subjectarea', 'topic'],
  client: ['client', 'clientid', 'entryclientid', 'customer', 'customerid'],
  project: ['project', 'projectid', 'entryprojectid', 'job', 'jobid'],
  partOfSpeech: ['partofspeech', 'pos'],
  caseSensitive: ['casesensitive', 'matchcase'],
  matchMode: ['matchmode', 'matchingmode', 'termmatchmode'],
  priority: ['priority', 'rank', 'weight'],
  forbidden: ['forbidden', 'prohibited', 'donotuse', 'isforbidden', 'forbid'],
  allowedVariants: ['allowedvariants', 'variants', 'alttranslations', 'alternatives'],
  note: ['note', 'notes', 'comment', 'comments', 'description', 'remark', 'remarks']
};
const TB_STRUCTURE_IGNORE_HEADERS = ['entryid', 'id', 'created', 'creator', 'modified', 'modifier', 'lastmodified', 'date', 'timestamp'];
const TB_STRUCTURE_MATCH_HINTS = ['sourceterm', 'source', 'term', 'subject', 'entrysubject', 'english', 'label'];
const TB_STRUCTURE_TARGET_HINTS = ['targetterm', 'target', 'translation', 'translated', 'chinese', 'prc', 'zh', 'cn', 'def'];
const TB_STRUCTURE_NOTE_HINTS = ['note', 'info', 'example', 'definition', 'remark', 'comment'];
const TB_SIDE_META_SUFFIXES = ['def', 'definition'];
const TB_SIDE_META_GENERIC_HEADERS = ['terminfo', 'termexample'];

/** @typedef {Record<string, any>} TbStructureEntry */

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
function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeIsoLanguageCode(value) {
  return normalizeCanonicalLanguageTag(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isBooleanLike(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['0', '1', 'true', 'false', 'yes', 'no', 'y', 'n'].includes(normalized);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNumericLike(value) {
  const normalized = String(value || '').trim();
  return normalized !== '' && /^-?\d+(\.\d+)?$/.test(normalized);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isLanguageLike(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  return /^[a-z]{2,3}([_-][a-z0-9]{2,8})*$/i.test(normalized)
    || /^[A-Za-z]+(?:[_-][A-Za-z]+)+$/.test(normalized);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isTextLike(value) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  return /[A-Za-z\u00C0-\u024F\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(normalized);
}

/**
 * @param {any[]=} rows
 * @param {number=} index
 * @returns {Record<string, any>}
 */
function summarizeColumnSamples(rows = [], index = 0) {
  const samples = rows
    .map((row) => Array.isArray(row) ? normalizeWhitespace(row[index]) : '')
    .filter(Boolean)
    .slice(0, 10);
  const nonEmptyCount = rows.reduce((count, row) => count + (normalizeWhitespace(Array.isArray(row) ? row[index] : '') ? 1 : 0), 0);
  const rowCount = rows.length || 1;
  const textLikeCount = samples.filter((value) => isTextLike(value)).length;
  const booleanLikeCount = samples.filter((value) => isBooleanLike(value)).length;
  const numericLikeCount = samples.filter((value) => isNumericLike(value)).length;
  const languageLikeCount = samples.filter((value) => isLanguageLike(value)).length;
  return {
    samples,
    nonEmptyRate: nonEmptyCount / rowCount,
    textLikeRate: samples.length ? textLikeCount / samples.length : 0,
    booleanLikeRate: samples.length ? booleanLikeCount / samples.length : 0,
    numericLikeRate: samples.length ? numericLikeCount / samples.length : 0,
    languageLikeRate: samples.length ? languageLikeCount / samples.length : 0,
    averageLength: samples.length
      ? samples.reduce((sum, value) => sum + value.length, 0) / samples.length
      : 0
  };
}

/**
 * @param {string} role
 * @param {Record<string, any>} column
 * @param {any[]} columns
 * @returns {number}
 */
function scoreSmartRole(role, column, columns) {
  let score = 0;
  const normalizedName = column.normalizedName;
  const headerValue = column.name;
  const samples = column.profile;

  if (SMART_ROLE_ALIASES[role]?.includes(normalizedName)) {
    score += 100;
  } else if (normalizedName && SMART_ROLE_ALIASES[role]?.some((alias) => normalizedName.includes(alias) || alias.includes(normalizedName))) {
    score += 82;
  }

  if (role === 'sourceTerm' || role === 'targetTerm') {
    if (samples.textLikeRate >= 0.8) score += 12;
    if (samples.booleanLikeRate === 0) score += 8;
    if (samples.languageLikeRate < 0.5) score += 5;
    if (column.index <= 2) score += 4;
  }

  if (role === 'srcLang' || role === 'tgtLang') {
    if (samples.languageLikeRate >= 0.8) score += 28;
    if (samples.averageLength <= 18) score += 6;
  }

  if (role === 'forbidden' || role === 'caseSensitive') {
    if (samples.booleanLikeRate >= 0.8) score += 30;
  }

  if (role === 'priority' || role === 'id') {
    if (samples.numericLikeRate >= 0.8) score += 18;
  }

  if (role === 'domain' || role === 'client' || role === 'project') {
    if (samples.textLikeRate >= 0.8) score += 8;
    if (samples.booleanLikeRate === 0) score += 4;
  }

  if (role === 'note') {
    if (samples.textLikeRate >= 0.8) score += 18;
    if (samples.averageLength >= 3) score += 8;
    if (headerValue && /^[A-Za-z]+(?:[_-][A-Za-z]+)+$/.test(headerValue)) score += 14;
    const alreadyStronglyTyped = columns.some((candidate) => candidate !== column && candidate.normalizedName && SMART_ROLE_ALIASES.note.includes(candidate.normalizedName));
    if (!alreadyStronglyTyped) score += 4;
  }

  if (role === 'allowedVariants') {
    if (samples.textLikeRate >= 0.8) score += 6;
    if (samples.samples.some((/** @type {any} */ value) => /[|;,]/.test(value))) score += 20;
  }

  return score;
}

/**
 * @param {Record<string, any>=} assignments
 * @returns {Record<string, any>}
 */
function buildDetectedMapping(assignments = {}) {
  return Object.fromEntries(
    Object.entries(assignments).map(([role, assignment]) => [role, {
      columnIndex: assignment.column.index,
      columnName: assignment.column.name || `Column ${assignment.column.index + 1}`,
      confidence: assignment.score >= 100 ? 'high' : assignment.score >= 85 ? 'medium' : 'low',
      score: assignment.score
    }])
  );
}

/**
 * @param {Record<string, any>=} assignments
 * @returns {Record<string, any>}
 */
function buildMappingConfidence(assignments = {}) {
  const scores = Object.values(assignments).map((assignment) => assignment.score).filter((score) => Number.isFinite(score));
  if (!scores.length) {
    return { level: 'low', score: 0 };
  }

  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return {
    level: average >= 95 ? 'high' : average >= 80 ? 'medium' : 'low',
    score: Number((average / 100).toFixed(2))
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function hashObject(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex');
}

/**
 * @param {any} normalizedName
 * @param {any[]=} hints
 * @returns {number}
 */
function rateHeaderByHints(normalizedName, hints = []) {
  if (!normalizedName) return 0;
  let score = 0;
  for (const hint of /** @type {any[]} */ (hints)) {
    if (normalizedName === hint) score += 100;
    else if (normalizedName.includes(hint) || hint.includes(normalizedName)) score += 55;
  }
  return score;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function containsCjk(value) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(String(value || ''));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function containsLatin(value) {
  return /[A-Za-z]/.test(String(value || ''));
}

/**
 * @param {any[]=} columns
 * @param {(column: any, columns?: any[]) => number=} scorer
 * @param {number=} minScore
 * @returns {any | null}
 */
function selectTbStructureColumn(columns = [], scorer, minScore = 1) {
  const scored = columns
    .map((/** @type {any} */ column) => ({ column, score: (/** @type {(column: any) => number} */ (scorer))(column) }))
    .sort((left, right) => right.score - left.score);
  return scored[0] && scored[0].score >= minScore ? scored[0] : null;
}

/**
 * @param {Record<string, any>=} structure
 * @returns {string}
 */
function buildTbStructureSummary(structure = {}) {
  const parts = [];
  if (structure.matchColumnName) parts.push(`match:${structure.matchColumnName}`);
  if (structure.targetColumnName) parts.push(`target:${structure.targetColumnName}`);
  if (structure.languagePair?.source || structure.languagePair?.target) {
    parts.push(`languagePair:${structure.languagePair?.source || ''}->${structure.languagePair?.target || ''}`);
  }
  if (Array.isArray(structure.noteColumnNames) && structure.noteColumnNames.length) parts.push(`notes:${structure.noteColumnNames.join('|')}`);
  if (Array.isArray(structure.entryMetaColumns) && structure.entryMetaColumns.length) {
    parts.push(`entryMeta:${structure.entryMetaColumns.map((/** @type {any} */ column) => column.name).join('|')}`);
  }
  return parts.join(' ; ');
}

/**
 * @param {unknown=} columnName
 * @returns {boolean}
 */
function isExplicitLanguageHeader(columnName = '') {
  const raw = String(columnName || '').trim();
  const normalized = normalizeHeader(raw);
  if (!raw) {
    return false;
  }
  if (raw.startsWith('Entry_') || TB_STRUCTURE_IGNORE_HEADERS.includes(normalized)) {
    return false;
  }
  if (TB_SIDE_META_GENERIC_HEADERS.includes(normalized)) {
    return false;
  }
  if (TB_SIDE_META_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return false;
  }
  return Boolean(resolveAssetLanguage(raw));
}

/**
 * @param {any[]=} columns
 * @returns {any[]}
 */
function findExplicitLanguageColumns(columns = []) {
  return columns.filter((/** @type {any} */ column) => isExplicitLanguageHeader(column.name));
}

/**
 * @param {any[]=} columns
 * @param {any[]=} mainColumns
 * @param {any=} mainColumn
 * @returns {any[]}
 */
function buildSideMetaColumns(columns = [], mainColumns = [], mainColumn) {
  const nextMainIndex = mainColumns
    .filter((/** @type {any} */ column) => column.index > mainColumn.index)
    .map((/** @type {any} */ column) => column.index)
    .sort((left, right) => left - right)[0] ?? Number.POSITIVE_INFINITY;
  const explicitDef = columns.filter((/** @type {any} */ column) => normalizeHeader(column.name) === `${mainColumn.normalizedName}def`);
  const genericTrailing = columns.filter((/** @type {any} */ column) => (
    column.index > mainColumn.index
    && column.index < nextMainIndex
    && TB_SIDE_META_GENERIC_HEADERS.includes(column.normalizedName)
  ));
  return [...explicitDef, ...genericTrailing];
}

/**
 * @param {any[]=} columns
 * @param {Set<any>=} usedIndexes
 * @returns {any[]}
 */
function buildEntryMetaColumns(columns = [], usedIndexes = new Set()) {
  return columns.filter((/** @type {any} */ column) => !usedIndexes.has(column.index) && column.name.startsWith('Entry_'));
}

/**
 * @param {any[]=} rows
 * @param {Record<string, any>=} asset
 * @returns {Record<string, any> | null}
 */
function inferExplicitTbStructure(rows = [], asset = {}) {
  if (!Array.isArray(rows) || rows.length < 2 || !Array.isArray(rows[0])) {
    return null;
  }

  const header = rows[0].map((/** @type {any} */ cell) => normalizeWhitespace(cell));
  const columns = header.map((/** @type {any} */ name, /** @type {any} */ index) => ({
    index,
    name,
    normalizedName: normalizeHeader(name),
    profile: summarizeColumnSamples(rows.slice(1), index)
  }));
  const languageColumns = findExplicitLanguageColumns(columns);
  if (languageColumns.length < 2 || languageColumns.every((/** @type {any} */ column) =>
    column.profile.samples.length > 0 && column.profile.samples.every((/** @type {any} */ value) => resolveAssetLanguage(value) === resolveAssetLanguage(column.name)))) {
    return null;
  }

  if (new Set(languageColumns.map((/** @type {any} */ column) => resolveAssetLanguage(column.name))).size !== languageColumns.length) {
    return null;
  }
  if (languageColumns.length > 2 || asset.tbDirectionMode === 'automatic') {
    return buildMultilingualTbStructure(rows, asset, languageColumns.map((/** @type {any} */ column) => ({ columnIndex: column.index, language: resolveAssetLanguage(column.name) })), 'header_inferred');
  }
  const sourceColumn = languageColumns[0];
  const targetColumn = languageColumns[1];
  const sourceMetaColumns = buildSideMetaColumns(columns, languageColumns, sourceColumn);
  const targetMetaColumns = buildSideMetaColumns(columns, languageColumns, targetColumn);
  const usedIndexes = new Set([
    sourceColumn.index,
    targetColumn.index,
    ...sourceMetaColumns.map((/** @type {any} */ column) => column.index),
    ...targetMetaColumns.map((/** @type {any} */ column) => column.index)
  ]);
  const entryMetaColumns = buildEntryMetaColumns(columns, usedIndexes);

  const structure = {
    version: 2,
    derivedFromSha256: String(asset?.sha256 || ''),
    kind: 'bilingual',
    matchColumnIndex: sourceColumn.index,
    matchColumnName: sourceColumn.name,
    targetColumnIndex: targetColumn.index,
    targetColumnName: targetColumn.name,
    languagePair: {
      source: resolveAssetLanguage(sourceColumn.name),
      target: resolveAssetLanguage(targetColumn.name)
    },
    noteColumnIndexes: entryMetaColumns.filter((/** @type {any} */ column) => normalizeHeader(column.name) === 'entrynote').map((/** @type {any} */ column) => column.index),
    noteColumnNames: entryMetaColumns.filter((/** @type {any} */ column) => normalizeHeader(column.name) === 'entrynote').map((/** @type {any} */ column) => column.name),
    entryMetaColumns: entryMetaColumns.map((/** @type {any} */ column) => ({ index: column.index, name: column.name })),
    sourceMetaColumns: sourceMetaColumns.map((/** @type {any} */ column) => ({ index: column.index, name: column.name })),
    targetMetaColumns: targetMetaColumns.map((/** @type {any} */ column) => ({ index: column.index, name: column.name })),
    sampleRows: rows.slice(1).filter((cells) => Array.isArray(cells) && cells.some(Boolean)).slice(0, TB_STRUCTURE_SAMPLE_ROWS),
    sourceOfTruth: 'header_inferred',
    confidence: { level: 'high', score: 0.98 }
  };
  (/** @type {Record<string, any>} */ (structure)).summary = buildTbStructureSummary(structure);
  (/** @type {Record<string, any>} */ (structure)).fingerprint = hashObject({
    sha256: structure.derivedFromSha256,
    matchColumnIndex: structure.matchColumnIndex,
    targetColumnIndex: structure.targetColumnIndex,
    languagePair: structure.languagePair,
    entryMetaColumns: structure.entryMetaColumns,
    sourceMetaColumns: structure.sourceMetaColumns,
    targetMetaColumns: structure.targetMetaColumns,
    sourceOfTruth: structure.sourceOfTruth
  });
  return structure;
}

/**
 * @param {any[]=} rows
 * @param {Record<string, any>=} asset
 * @returns {Record<string, any> | null}
 */
function buildManualTbStructure(rows = [], asset = {}) {
  if (Array.isArray(asset.tbLanguageColumns) && asset.tbLanguageColumns.length) {
    return buildMultilingualTbStructure(rows, asset, asset.tbLanguageColumns, 'manual_mapping');
  }
  const manualMapping = asset?.tbManualMapping && typeof asset.tbManualMapping === 'object'
    ? asset.tbManualMapping
    : null;
  const languagePair = asset?.tbLanguagePair && typeof asset.tbLanguagePair === 'object'
    ? asset.tbLanguagePair
    : null;
  if (!manualMapping || !languagePair?.source || !languagePair?.target || !Array.isArray(rows) || rows.length < 2) {
    return null;
  }

  const header = Array.isArray(rows[0]) ? rows[0].map((cell) => normalizeWhitespace(cell)) : [];
  const sourceColumnIndex = header.findIndex((name) => name === String(manualMapping.srcColumn || '').trim());
  const targetColumnIndex = header.findIndex((name) => name === String(manualMapping.tgtColumn || '').trim());
  if (sourceColumnIndex < 0 || targetColumnIndex < 0) {
    return null;
  }

  const structure = {
    version: 2,
    derivedFromSha256: String(asset?.sha256 || ''),
    kind: 'bilingual',
    matchColumnIndex: sourceColumnIndex,
    matchColumnName: header[sourceColumnIndex] || '',
    targetColumnIndex,
    targetColumnName: header[targetColumnIndex] || '',
    languagePair: {
      source: normalizeIsoLanguageCode(languagePair.source),
      target: normalizeIsoLanguageCode(languagePair.target)
    },
    noteColumnIndexes: [],
    noteColumnNames: [],
    entryMetaColumns: [],
    sourceMetaColumns: [],
    targetMetaColumns: [],
    sampleRows: rows.slice(1).filter((cells) => Array.isArray(cells) && cells.some(Boolean)).slice(0, TB_STRUCTURE_SAMPLE_ROWS),
    sourceOfTruth: 'manual_mapping',
    confidence: { level: 'high', score: 1 }
  };
  (/** @type {Record<string, any>} */ (structure)).summary = buildTbStructureSummary(structure);
  (/** @type {Record<string, any>} */ (structure)).fingerprint = hashObject({
    sha256: structure.derivedFromSha256,
    manualMapping,
    languagePair: structure.languagePair,
    sourceOfTruth: structure.sourceOfTruth
  });
  return structure;
}

/**
 * @param {any=} name
 * @param {any=} normalizedName
 * @returns {boolean}
 */
function isSchemaLikeTbHeaderName(name = '', normalizedName = '') {
  const raw = String(name || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!raw || !normalizedName) {
    return false;
  }

  if (normalizedName.startsWith('entry')) {
    return true;
  }

  return /\b(source|target|subject|lang|language|english|chinese|japanese|korean|domain|client|project|note|definition|comment|remark|example|forbidden|priority|variant|match|speech|case)\b/.test(raw);
}

/**
 * @param {any[]=} columns
 * @returns {boolean}
 */
function looksLikeTbHeaderRow(columns = []) {
  if (!Array.isArray(columns) || !columns.length) {
    return false;
  }

  const namedColumns = columns.filter((/** @type {any} */ column) => column.name);
  if (!namedColumns.length) {
    return false;
  }

  const schemaLikeColumns = namedColumns.filter((/** @type {any} */ column) => isSchemaLikeTbHeaderName(column.name, column.normalizedName));
  if (!schemaLikeColumns.length) {
    return false;
  }

  const mirroredValueColumns = namedColumns.filter((/** @type {any} */ column) => (
    column.profile.textLikeRate >= 0.8
    && column.profile.samples.length > 0
    && column.profile.samples.some((/** @type {any} */ value) => normalizeHeader(value) === column.normalizedName)
    && !isSchemaLikeTbHeaderName(column.name, column.normalizedName)
  ));

  return !(mirroredValueColumns.length >= Math.ceil(namedColumns.length / 2) && schemaLikeColumns.length < 2);
}

/**
 * @param {any[]=} rows
 * @param {Record<string, any>=} asset
 * @returns {Record<string, any> | null}
 */
function deriveTbStructureFromRows(rows = [], asset = {}) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return null;
  }

  const header = rows[0].map((/** @type {any} */ cell) => normalizeWhitespace(cell));
  if (!header.some(Boolean)) {
    return null;
  }

  const sampleRows = rows.slice(1).filter((cells) => Array.isArray(cells) && cells.some(Boolean)).slice(0, TB_STRUCTURE_SAMPLE_ROWS);
  const columns = header.map((/** @type {any} */ name, /** @type {any} */ index) => ({
    index,
    name,
    normalizedName: normalizeHeader(name),
    profile: summarizeColumnSamples(rows.slice(1), index)
  }));
  if (!looksLikeTbHeaderRow(columns)) {
    return null;
  }
  const ignored = new Set(
    columns
      .filter((/** @type {any} */ column) => TB_STRUCTURE_IGNORE_HEADERS.some((hint) => column.normalizedName.includes(hint)))
      .map((/** @type {any} */ column) => column.index)
  );
  const usableColumns = columns.filter((/** @type {any} */ column) => !ignored.has(column.index));

  const matchColumn = selectTbStructureColumn(usableColumns, (column) => {
    let score = rateHeaderByHints(column.normalizedName, TB_STRUCTURE_MATCH_HINTS);
    if (column.profile.textLikeRate >= 0.8) score += 20;
    if (column.profile.samples.some((/** @type {any} */ value) => containsLatin(value))) score += 15;
    if (column.profile.samples.some((/** @type {any} */ value) => containsCjk(value))) score -= 10;
    return score;
  }, 60);

  const targetColumn = selectTbStructureColumn(usableColumns.filter((/** @type {any} */ column) => column.index !== matchColumn?.column.index), (column) => {
    let score = rateHeaderByHints(column.normalizedName, TB_STRUCTURE_TARGET_HINTS);
    if (column.profile.textLikeRate >= 0.8) score += 15;
    if (column.profile.samples.some((/** @type {any} */ value) => containsCjk(value))) score += 20;
    if (column.profile.samples.some((/** @type {any} */ value) => containsLatin(value))) score += 5;
    return score;
  }, 60);

  const noteColumns = usableColumns
    .filter((/** @type {any} */ column) => column.index !== matchColumn?.column.index && column.index !== targetColumn?.column.index)
    .filter((/** @type {any} */ column) => rateHeaderByHints(column.normalizedName, TB_STRUCTURE_NOTE_HINTS) > 0)
    .slice(0, 3);

  if (!matchColumn && !targetColumn) {
    return null;
  }

  const structure = {
    version: 1,
    derivedFromSha256: String(asset?.sha256 || ''),
    kind: targetColumn ? 'bilingual' : 'reference',
    matchColumnIndex: matchColumn?.column.index ?? -1,
    matchColumnName: matchColumn?.column.name || '',
    targetColumnIndex: targetColumn?.column.index ?? -1,
    targetColumnName: targetColumn?.column.name || '',
    noteColumnIndexes: noteColumns.map((/** @type {any} */ column) => column.index),
    noteColumnNames: noteColumns.map((/** @type {any} */ column) => column.name),
    sampleRows,
    source: 'derived'
  };
  (/** @type {Record<string, any>} */ (structure)).summary = buildTbStructureSummary(structure);
  (/** @type {Record<string, any>} */ (structure)).fingerprint = hashObject({
    sha256: structure.derivedFromSha256,
    kind: structure.kind,
    matchColumnIndex: structure.matchColumnIndex,
    targetColumnIndex: structure.targetColumnIndex,
    noteColumnIndexes: structure.noteColumnIndexes
  });
  return structure;
}

/**
 * @param {Record<string, any>=} structure
 * @param {Record<string, any>=} asset
 * @returns {boolean}
 */
function isValidTbStructure(structure = {}, asset = {}) {
  return structure
    && typeof structure === 'object'
    && String(structure.derivedFromSha256 || '') === String(asset?.sha256 || '')
    && ((structure.kind === 'multilingual' && Array.isArray(structure.languageColumns) && structure.languageColumns.length >= 2)
      || (Number.isInteger(Number(structure.matchColumnIndex)) && Number(structure.matchColumnIndex) >= 0));
}

/**
 * @param {any[]=} rows
 * @param {Record<string, any>=} structure
 * @returns {any[]}
 */
function buildEntriesFromTbStructure(rows = [], structure = {}) {
  if (structure.kind === 'multilingual') {
    const columns = structure.languageColumns || [];
    const entries = [];
    if (structure.directionMode === 'automatic' && structure.ruleColumns?.length) {
      for (const cells of rows.slice(1)) {
        const rules = Object.fromEntries(structure.ruleColumns.map((/** @type {any} */ column) => [column.role, normalizeWhitespace(cells[column.index])]));
        const directional = hasEffectiveDirectionalRule(rules);
        const pair = structure.ruleLanguagePair || {};
        const sourceColumn = columns.find((/** @type {any} */ column) => column.language === pair.source);
        const targetColumn = columns.find((/** @type {any} */ column) => column.language === pair.target);
        if (directional && (!sourceColumn || !targetColumn || sourceColumn === targetColumn)) continue;
        const rowStructure = directional ? {
          ...structure, kind: 'bilingual',
          matchColumnIndex: sourceColumn.columnIndex, targetColumnIndex: targetColumn.columnIndex,
          sourceMetaColumns: sourceColumn.metaColumns, targetMetaColumns: targetColumn.metaColumns,
          languagePair: pair
        } : { ...structure, ruleColumns: [] };
        const rowEntries = buildEntriesFromTbStructure([rows[0], cells], rowStructure);
        entries.push(...rowEntries.filter((entry) => entry.sourceTerm && entry.targetTerm).map((entry) => ({
          ...entry, ...rules,
          allowedVariants: String(rules.allowedVariants || '').split(/[|;,\n]+/).map((value) => value.trim()).filter(Boolean),
          allowReverse: !directional
        })));
        if (entries.length > 50000) throw new Error('Terminology table exceeds 50,000 language-pair entries. Split it into smaller files.');
      }
      return entries;
    }
    for (let source = 0; source < columns.length; source += 1) {
      for (let target = source + 1; target < columns.length; target += 1) {
        entries.push(...buildEntriesFromTbStructure(rows, {
          ...structure, kind: 'bilingual',
          matchColumnIndex: columns[source].columnIndex,
          targetColumnIndex: columns[target].columnIndex,
          sourceMetaColumns: columns[source].metaColumns,
          targetMetaColumns: columns[target].metaColumns,
          languagePair: { source: columns[source].language, target: columns[target].language }
        }).filter((entry) => entry.sourceTerm && entry.targetTerm));
        if (entries.length > 50000) throw new Error('Terminology table exceeds 50,000 language-pair entries. Split it into smaller files.');
      }
    }
    return entries;
  }
  if (!Array.isArray(rows) || rows.length < 2 || !isValidTbStructure(structure, { sha256: structure.derivedFromSha256 })) {
    return [];
  }
  return rows.slice(1)
    .map((cells) => Array.isArray(cells) ? cells.map((cell) => normalizeWhitespace(cell)) : [])
    .filter((cells) => cells.some(Boolean))
    .map((cells) => {
      const sourceTerm = normalizeWhitespace(cells[structure.matchColumnIndex] || '');
      const targetTerm = structure.targetColumnIndex >= 0
        ? normalizeWhitespace(cells[structure.targetColumnIndex] || '')
        : sourceTerm;
      const entryMetadata = Object.fromEntries(
        (Array.isArray(structure.entryMetaColumns) ? structure.entryMetaColumns : [])
          .map((/** @type {any} */ column) => [column.name, normalizeWhitespace(cells[column.index] || '')])
          .filter(([, value]) => value)
      );
      const sourceMetadata = Object.fromEntries(
        (Array.isArray(structure.sourceMetaColumns) ? structure.sourceMetaColumns : [])
          .map((/** @type {any} */ column) => [column.name, normalizeWhitespace(cells[column.index] || '')])
          .filter(([, value]) => value)
      );
      const targetMetadata = Object.fromEntries(
        (Array.isArray(structure.targetMetaColumns) ? structure.targetMetaColumns : [])
          .map((/** @type {any} */ column) => [column.name, normalizeWhitespace(cells[column.index] || '')])
          .filter(([, value]) => value)
      );
      const notes = [
        ...Object.values(entryMetadata),
        ...Object.values(sourceMetadata),
        ...Object.values(targetMetadata),
        ...(Array.isArray(structure.noteColumnIndexes) ? structure.noteColumnIndexes : [])
          .map((index) => normalizeWhitespace(cells[index] || ''))
          .filter(Boolean)
      ].filter(Boolean);
      if (!sourceTerm) {
        return null;
      }
      const metadataLines = [];
      for (const [key, value] of Object.entries(entryMetadata)) {
        metadataLines.push(`${key}: ${value}`);
      }
      for (const [key, value] of Object.entries(sourceMetadata)) {
        metadataLines.push(`${key}: ${value}`);
      }
      for (const [key, value] of Object.entries(targetMetadata)) {
        metadataLines.push(`${key}: ${value}`);
      }
      return {
        sourceTerm,
        targetTerm,
        srcLang: structure.languagePair?.source || '',
        tgtLang: structure.languagePair?.target || '',
        domain: '',
        client: '',
        project: '',
        note: notes.join(' | '),
        metadata: {
          entry: entryMetadata,
          source: sourceMetadata,
          target: targetMetadata
        },
        tbMetadataText: metadataLines.join('\n')
      };
    })
    .filter(Boolean);
}

/**
 * @param {any[]} rows
 * @param {Record<string, any>} asset
 * @param {any[]} mappings
 * @param {string=} sourceOfTruth
 * @returns {Record<string, any>}
 */
function buildMultilingualTbStructure(rows, asset, mappings, sourceOfTruth = 'manual_mapping') {
  const header = rows[0] || [];
  const indexes = new Set();
  const languages = new Set();
  if (mappings.length < 2) throw new Error('Select at least two language columns.');
  const columns = header.map((/** @type {any} */ name, /** @type {number} */ index) => ({ index, name: String(name), normalizedName: normalizeHeader(name) }));
  const languageColumns = mappings.map((mapping) => {
    const columnIndex = mapping.columnIndex;
    const language = resolveAssetLanguage(mapping.language);
    if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= header.length || indexes.has(columnIndex)) {
      throw new Error('Choose distinct columns from this file.');
    }
    if (!language || languages.has(language)) throw new Error('Choose a different valid language for each column.');
    indexes.add(columnIndex); languages.add(language);
    return { columnIndex, columnName: String(header[columnIndex] || ''), language };
  });
  const mainColumns = languageColumns.map((/** @type {any} */ column) => columns[column.columnIndex]);
  const structure = {
    version: 3, kind: 'multilingual',
    directionMode: asset.tbDirectionMode === 'automatic' ? 'automatic' : 'legacy',
    ruleLanguagePair: asset.tbRuleLanguagePair || asset.tbLanguagePair || { source: '', target: '' },
    ruleColumns: detectTbRuleColumns(header, [...indexes]),
    languageColumns: languageColumns.map((/** @type {any} */ column) => ({ ...column, metaColumns: buildSideMetaColumns(columns, mainColumns, columns[column.columnIndex]) })),
    languagePair: { source: '', target: '' },
    entryMetaColumns: buildEntryMetaColumns(columns, indexes),
    noteColumnIndexes: columns.filter((/** @type {any} */ column) => !indexes.has(column.index) && SMART_ROLE_ALIASES.note.includes(column.normalizedName)).map((/** @type {any} */ column) => column.index),
    sourceOfTruth, confidence: { level: 'high', score: 1 },
    summary: languageColumns.map((/** @type {any} */ column) => `${column.columnName}: ${column.language}`).join(' ; ')
  };
  return { ...structure, fingerprint: hashObject(structure) };
}

/** @param {any[]} header @param {number[]} [excluded] */
function detectTbRuleColumns(header, excluded = []) {
  return header.flatMap((name, index) => excluded.includes(index) ? [] :
    ['forbidden', 'allowedVariants', 'caseSensitive', 'matchMode', 'priority', 'partOfSpeech', 'domain', 'client', 'project'].flatMap((role) =>
      SMART_ROLE_ALIASES[role].includes(normalizeHeader(name)) ? [{ index, role }] : []));
}

/** Give headerless tables positional columns without consuming the first record.
 * @param {any[]} rows
 * @param {boolean=} hasHeader
 * @returns {any[]}
 */
function prepareTbTableRows(rows, hasHeader = true) {
  if (hasHeader || !rows.length) return rows;
  const width = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  return [Array.from({ length: width }, () => ''), ...rows];
}

/** @param {any[]} rows @param {any[]} ruleColumns */
function tableHasDirectionalRules(rows, ruleColumns) {
  return rows.slice(1).some((cells) => hasEffectiveDirectionalRule(Object.fromEntries(ruleColumns.map((column) => [column.role, cells[column.index]]))));
}

module.exports = {
  tableHasDirectionalRules,
  detectTbRuleColumns,
  prepareTbTableRows,
  buildMultilingualTbStructure,
  buildDetectedMapping,
  buildEntriesFromTbStructure,
  buildManualTbStructure,
  buildMappingConfidence,
  buildTbStructureSummary,
  deriveTbStructureFromRows,
  inferExplicitTbStructure,
  isValidTbStructure,
  scoreSmartRole,
  summarizeColumnSamples
};
