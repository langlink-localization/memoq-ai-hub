const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const XLSX = require('xlsx');

const {
  ASSET_PURPOSES,
  normalizeAssetPurpose
} = require('./assetRules');
const {
  createTbFingerprint,
  createTbMatcher,
  normalizeTbEntry
} = require('./assetTerminology');
const {
  buildDetectedMapping,
  buildEntriesFromTbStructure,
  buildManualTbStructure,
  buildMappingConfidence,
  deriveTbStructureFromRows,
  inferExplicitTbStructure,
  isValidTbStructure,
  scoreSmartRole,
  summarizeColumnSamples
} = require('./assetTbStructure');

const MAX_GLOSSARY_ROWS = 1000;
const MAX_GLOSSARY_CHARACTERS = 12000;
const SMART_PARSING_UPGRADE_HINT = 'Configure an AI provider and model to enable smart glossary column recognition.';
const TABLE_FALLBACK_INDEXES = {
  id: -1,
  sourceTerm: 0,
  targetTerm: 1,
  srcLang: 2,
  tgtLang: 3,
  domain: 4,
  client: 5,
  project: 6,
  matchMode: 7,
  priority: 8,
  forbidden: 9,
  allowedVariants: 10,
  note: 11,
  partOfSpeech: 12,
  caseSensitive: 13
};
const SMART_REQUIRED_ROLES = ['sourceTerm', 'targetTerm'];

function toArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateText(value, maxCharacters) {
  const normalized = String(value || '');
  if (!maxCharacters || normalized.length <= maxCharacters) {
    return normalized;
  }

  return normalized.slice(0, maxCharacters).trimEnd();
}

function splitDelimitedLine(line, delimiter) {
  return String(line || '').split(delimiter).map((cell) => normalizeWhitespace(cell));
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeBoolean(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y'].includes(normalized);
}

function parseAllowedVariants(value) {
  return String(value || '')
    .split(/[|;,]/)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

function mapEntryRow(raw = {}, index = 0) {
  return normalizeTbEntry({
    id: raw.id || `tb-${index + 1}`,
    sourceTerm: raw.sourceTerm,
    targetTerm: raw.targetTerm,
    srcLang: raw.srcLang,
    tgtLang: raw.tgtLang,
    domain: raw.domain,
    client: raw.client,
    project: raw.project,
    partOfSpeech: raw.partOfSpeech,
    caseSensitive: raw.caseSensitive,
    matchMode: raw.matchMode,
    priority: raw.priority,
    forbidden: raw.forbidden,
    allowedVariants: raw.allowedVariants,
    note: raw.note,
    metadata: raw.metadata,
    tbMetadataText: raw.tbMetadataText
  }, index);
}

function createRenderedTb(entries) {
  const lines = entries
    .filter((entry) => !entry.forbidden)
    .map((entry) => `- "${entry.sourceTerm}" => "${entry.targetTerm}"`);
  return lines.length ? `Required terminology:\n${lines.join('\n')}` : '';
}

function collectRawTableRowsFromText(text, extension = '') {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  if (extension === '.tsv' || normalized.includes('\t')) {
    return normalized
      .split('\n')
      .map((line) => splitDelimitedLine(line, '\t'))
      .filter((cells) => cells.some(Boolean));
  }
  if (extension === '.csv' || normalized.includes(',')) {
    return normalized
      .split('\n')
      .map((line) => splitDelimitedLine(line, ','))
      .filter((cells) => cells.some(Boolean));
  }
  return normalized
    .split('\n')
    .map((line) => [normalizeWhitespace(line)])
    .filter((cells) => cells.some(Boolean));
}

function collectRawTableRowsFromAsset(asset) {
  const extension = path.extname(String(asset?.fileName || asset?.name || '')).trim().toLowerCase();
  if (extension === '.xlsx') {
    const workbook = XLSX.readFile(asset.storedPath, { dense: true });
    const rows = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const values = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });
      rows.push(...values.map((cells) => Array.isArray(cells) ? cells.map((cell) => normalizeWhitespace(cell)) : []));
    }
    return rows.filter((cells) => cells.some(Boolean));
  }

  const raw = fs.readFileSync(asset.storedPath, 'utf8');
  return collectRawTableRowsFromText(raw, extension);
}

function finalizeParsedTable({ entries = [], rows = [], assignments = {}, warnings = [], parsingMode = 'fallback', smartParsingAvailable = false, usedFallbackMapping = false, hasExplicitHeaders = false, tbStructure = null, tbStructuringMode = '' } = {}) {
  const assignedIndexes = new Set(Object.values(assignments).map((assignment) => assignment?.column?.index).filter((value) => Number.isInteger(value)));
  const headerCells = Array.isArray(rows[0]) ? rows[0].map((cell) => normalizeWhitespace(cell)) : [];
  const unmappedColumns = headerCells
    .map((name, index) => ({ columnIndex: index, columnName: name || `Column ${index + 1}` }))
    .filter((column) => !assignedIndexes.has(column.columnIndex));

  return {
    entries: entries.filter(Boolean).slice(0, MAX_GLOSSARY_ROWS).map((entry, index) => mapEntryRow(entry, index)),
    parseInfo: {
      parsingMode,
      smartParsingAvailable,
      smartParsingRecommended: smartParsingAvailable !== true,
      usedFallbackMapping,
      hasExplicitHeaders,
      detectedMapping: buildDetectedMapping(assignments),
      mappingConfidence: buildMappingConfidence(assignments),
      mappingWarnings: warnings.filter(Boolean),
      unmappedColumns,
      availableColumns: headerCells.filter(Boolean),
      upgradeHint: smartParsingAvailable ? '' : SMART_PARSING_UPGRADE_HINT,
      tbStructure,
      tbStructureAvailable: Boolean(tbStructure),
      tbStructuringMode: tbStructuringMode || (tbStructure ? 'ai_structured' : ''),
      tbStructureSummary: String(tbStructure?.summary || ''),
      tbStructureFingerprint: String(tbStructure?.fingerprint || ''),
      tbStructureWarnings: warnings.filter(Boolean),
      languagePair: tbStructure?.languagePair || { source: '', target: '' },
      manualMappingRequired: smartParsingAvailable === true && !tbStructure?.languagePair?.source && !tbStructure?.languagePair?.target,
      manualMapping: {},
      tbStructureConfidence: tbStructure?.confidence || buildMappingConfidence(assignments),
      tbStructureSource: String(tbStructure?.sourceOfTruth || '')
    }
  };
}

function extractRowValue(row, headerMap, candidates = [], fallbackIndex = -1) {
  for (const candidate of candidates) {
    const key = headerMap.get(candidate);
    if (key && row[key] != null && row[key] !== '') {
      return row[key];
    }
  }

  if (fallbackIndex >= 0 && Array.isArray(row.__cells) && row.__cells[fallbackIndex] != null) {
    return row.__cells[fallbackIndex];
  }

  return '';
}

function buildEntryFromRow(row, headerMap, fallbackIndex, fallbackMap = TABLE_FALLBACK_INDEXES) {
  const fallback = fallbackIndex ? fallbackMap : {};
  const allowedVariants = parseAllowedVariants(extractRowValue(row, headerMap, ['allowedvariants'], fallback.allowedVariants ?? -1));
  const entry = {
    id: extractRowValue(row, headerMap, ['id'], fallback.id),
    sourceTerm: extractRowValue(row, headerMap, ['sourceterm', 'source', 'sourcetext'], fallback.sourceTerm ?? -1),
    targetTerm: extractRowValue(row, headerMap, ['targetterm', 'target', 'targettext'], fallback.targetTerm ?? -1),
    srcLang: extractRowValue(row, headerMap, ['sourcelanguage', 'srclang', 'sourcelang'], fallback.srcLang ?? -1),
    tgtLang: extractRowValue(row, headerMap, ['targetlanguage', 'tgtlang', 'targetlang'], fallback.tgtLang ?? -1),
    domain: extractRowValue(row, headerMap, ['domain'], fallback.domain ?? -1),
    client: extractRowValue(row, headerMap, ['client'], fallback.client ?? -1),
    project: extractRowValue(row, headerMap, ['project', 'projectid'], fallback.project ?? -1),
    partOfSpeech: extractRowValue(row, headerMap, ['partofspeech'], fallback.partOfSpeech ?? -1),
    caseSensitive: normalizeBoolean(extractRowValue(row, headerMap, ['casesensitive'], fallback.caseSensitive ?? -1)),
    matchMode: extractRowValue(row, headerMap, ['matchmode'], fallback.matchMode ?? -1),
    priority: extractRowValue(row, headerMap, ['priority'], fallback.priority ?? -1),
    forbidden: normalizeBoolean(extractRowValue(row, headerMap, ['forbidden'], fallback.forbidden ?? -1)),
    allowedVariants,
    note: extractRowValue(row, headerMap, ['note', 'comment', 'description'], fallback.note ?? -1)
  };

  return entry.sourceTerm && entry.targetTerm ? entry : null;
}

function parseTableRowsFallback(rows = [], smartParsingAvailable = false, extraWarnings = []) {
  if (!rows.length) {
    return finalizeParsedTable({ rows, smartParsingAvailable, warnings: extraWarnings });
  }

  const headerCells = Array.isArray(rows[0]) ? rows[0].map((cell) => normalizeWhitespace(cell)) : [];
  const headerMap = new Map(headerCells.map((cell) => [normalizeHeader(cell), cell]));
  const hasExplicitHeaders = headerMap.has('sourceterm') || headerMap.has('targetterm') || headerMap.has('source') || headerMap.has('target');
  const dataRows = hasExplicitHeaders ? rows.slice(1) : rows;

  const entries = dataRows
    .map((cells) => Array.isArray(cells) ? cells.map((cell) => normalizeWhitespace(cell)) : [])
    .filter((cells) => cells.some(Boolean))
    .map((cells) => {
      const row = Object.fromEntries(headerCells.map((header, index) => [header, cells[index]]));
      row.__cells = cells;
      return buildEntryFromRow(row, headerMap, !hasExplicitHeaders, TABLE_FALLBACK_INDEXES);
    })
    .filter(Boolean);

  const assignments = Object.fromEntries(
    Object.entries(TABLE_FALLBACK_INDEXES)
      .filter(([, columnIndex]) => columnIndex >= 0 && headerCells[columnIndex] != null)
      .map(([role, columnIndex]) => [role, {
        column: {
          index: columnIndex,
          name: headerCells[columnIndex],
          normalizedName: normalizeHeader(headerCells[columnIndex])
        },
        score: hasExplicitHeaders ? 70 : 45
      }])
  );

  return finalizeParsedTable({
    entries,
    rows,
    assignments,
    warnings: extraWarnings,
    parsingMode: 'fallback',
    smartParsingAvailable,
    usedFallbackMapping: true,
    hasExplicitHeaders
  });
}

function parseTableRowsSmart(rows = []) {
  if (!rows.length || !Array.isArray(rows[0])) {
    return { ok: false, warnings: ['Smart parsing skipped because no table header row was detected.'] };
  }

  const headerCells = rows[0].map((cell) => normalizeWhitespace(cell));
  const columns = headerCells.map((name, index) => ({
    index,
    name,
    normalizedName: normalizeHeader(name),
    profile: summarizeColumnSamples(rows.slice(1), index)
  }));
  const strongHeaderCount = columns.filter((column) =>
    [...SMART_REQUIRED_ROLES, 'domain', 'client', 'project', 'forbidden', 'note', 'id']
      .some((role) => scoreSmartRole(role, column, columns) >= 82)
  ).length;

  if (!strongHeaderCount) {
    return { ok: false, warnings: ['Smart parsing had low confidence because the header row did not match known column patterns.'] };
  }

  const assignments = {};
  const usedColumns = new Set();
  const rolePriority = ['sourceTerm', 'targetTerm', 'srcLang', 'tgtLang', 'domain', 'client', 'project', 'forbidden', 'note', 'priority', 'id', 'allowedVariants', 'matchMode', 'partOfSpeech', 'caseSensitive'];
  const warnings = [];

  for (const role of rolePriority) {
    const candidates = columns
      .filter((column) => !usedColumns.has(column.index))
      .map((column) => ({ column, score: scoreSmartRole(role, column, columns) }))
      .sort((left, right) => right.score - left.score);

    const top = candidates[0];
    const next = candidates[1];
    if (!top || top.score < 30) {
      continue;
    }

    const isRequired = SMART_REQUIRED_ROLES.includes(role);
    const threshold = isRequired ? 85 : 40;
    if (top.score < threshold) {
      if (isRequired) {
        warnings.push(`Smart parsing had low confidence for ${role}.`);
      }
      continue;
    }

    if (isRequired && next && top.score - next.score < 12) {
      warnings.push(`Smart parsing found an ambiguous ${role} column and will fall back to deterministic mapping.`);
      continue;
    }

    assignments[role] = top;
    usedColumns.add(top.column.index);
  }

  const missingRoles = SMART_REQUIRED_ROLES.filter((role) => !assignments[role]);
  if (missingRoles.length) {
    warnings.push(`Smart parsing had low confidence and is missing required column mappings: ${missingRoles.join(', ')}.`);
    return { ok: false, warnings };
  }

  const dataRows = rows.slice(1)
    .map((cells) => Array.isArray(cells) ? cells.map((cell) => normalizeWhitespace(cell)) : [])
    .filter((cells) => cells.some(Boolean));
  const entries = dataRows
    .map((cells) => {
      const pick = (role) => assignments[role] ? cells[assignments[role].column.index] : '';
      const entry = {
        id: pick('id'),
        sourceTerm: pick('sourceTerm'),
        targetTerm: pick('targetTerm'),
        srcLang: pick('srcLang'),
        tgtLang: pick('tgtLang'),
        domain: pick('domain'),
        client: pick('client'),
        project: pick('project'),
        partOfSpeech: pick('partOfSpeech'),
        caseSensitive: normalizeBoolean(pick('caseSensitive')),
        matchMode: pick('matchMode'),
        priority: pick('priority'),
        forbidden: normalizeBoolean(pick('forbidden')),
        allowedVariants: parseAllowedVariants(pick('allowedVariants')),
        note: pick('note')
      };
      return entry.sourceTerm && entry.targetTerm ? entry : null;
    })
    .filter(Boolean);

  return {
    ok: true,
    result: finalizeParsedTable({
      entries,
      rows,
      assignments,
      warnings,
      parsingMode: 'smart',
      smartParsingAvailable: true,
      usedFallbackMapping: false,
      hasExplicitHeaders: true
    })
  };
}

function parseTableRows(rows = [], options = {}) {
  const smartParsingAvailable = options.smartParsingAvailable === true;
  if (!rows.length) {
    return finalizeParsedTable({ rows, smartParsingAvailable });
  }

  if (smartParsingAvailable) {
    const smartResult = parseTableRowsSmart(rows);
    if (smartResult.ok) {
      return smartResult.result;
    }

    return parseTableRowsFallback(rows, true, [
      ...(smartResult.warnings || []),
      'Smart parsing fell back to deterministic column mapping.'
    ]);
  }

  return parseTableRowsFallback(rows, false);
}

function parseDelimitedGlossary(text, delimiter, options = {}) {
  const rows = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => splitDelimitedLine(line, delimiter))
    .filter((cells) => cells.some(Boolean));
  return parseTableRows(rows, options);
}

function parsePlainGlossary(text, options = {}) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return finalizeParsedTable({ rows: [], smartParsingAvailable: options.smartParsingAvailable === true });
  }

  if (normalized.includes('\t')) {
    return parseDelimitedGlossary(normalized, '\t', options);
  }

  if (normalized.includes(',')) {
    return parseDelimitedGlossary(normalized, ',', options);
  }

  return parseTableRows(
    normalized
      .split('\n')
      .map((line) => [normalizeWhitespace(line)]),
    options
  );
}

function parseWorkbookRows(filePath, options = {}) {
  const workbook = XLSX.readFile(filePath, { dense: true });
  const entries = [];
  const warnings = [];
  let parseInfo = null;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const values = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });
    const parsed = parseTableRows(values, options);
    entries.push(...(parsed.entries || []));
    warnings.push(...(parsed.parseInfo?.mappingWarnings || []));
    if (!parseInfo) {
      parseInfo = parsed.parseInfo;
    }
  }
  return {
    entries,
    parseInfo: {
      ...(parseInfo || finalizeParsedTable({ rows: [], smartParsingAvailable: options.smartParsingAvailable === true }).parseInfo),
      mappingWarnings: warnings
    }
  };
}

function readXmlParser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: true
  });
}

function getTermValue(node) {
  if (typeof node === 'string') {
    return normalizeWhitespace(node);
  }
  if (node && typeof node === 'object') {
    return normalizeWhitespace(node['#text'] || node.term || '');
  }
  return '';
}

function parseTbxGlossary(text) {
  const parser = readXmlParser();
  const parsed = parser.parse(text);
  const body = parsed?.tbx?.text?.body || parsed?.martif?.text?.body || {};
  const termEntries = toArray(body.termEntry);
  const rows = [];

  for (const termEntry of termEntries) {
    const termEntryId = normalizeWhitespace(termEntry?.['@_id']);
    const langSets = toArray(termEntry?.langSet).map((langSet) => ({
      lang: normalizeWhitespace(langSet?.['@_lang'] || langSet?.['@_xml:lang']),
      terms: [
        ...toArray(langSet?.tig).map((tig) => getTermValue(tig?.term)),
        ...toArray(langSet?.ntig).map((tig) => getTermValue(tig?.termGrp?.term || tig?.term))
      ].filter(Boolean)
    })).filter((langSet) => langSet.lang && langSet.terms.length);

    for (const source of langSets) {
      for (const target of langSets) {
        if (source.lang === target.lang) continue;
        for (const sourceTerm of source.terms) {
          for (const targetTerm of target.terms) {
            rows.push(mapEntryRow({
              id: `${termEntryId || 'tbx'}:${source.lang}:${target.lang}:${sourceTerm}:${targetTerm}`,
              sourceTerm,
              targetTerm,
              srcLang: source.lang,
              tgtLang: target.lang
            }, rows.length));
          }
        }
      }
    }
  }

  return rows.slice(0, MAX_GLOSSARY_ROWS);
}

function parseGlossaryAsset(asset, options = {}) {
  const extension = path.extname(String(asset?.fileName || asset?.name || '')).trim().toLowerCase();
  let parsed;
  const tableLike = ['.csv', '.tsv', '.txt', '.xlsx'].includes(extension);
  const rawRows = tableLike ? collectRawTableRowsFromAsset(asset) : [];
  const manualStructure = tableLike ? buildManualTbStructure(rawRows, asset) : null;
  const explicitStructure = !manualStructure && tableLike ? inferExplicitTbStructure(rawRows, asset) : null;
  const persistedStructure = isValidTbStructure(asset?.tbStructure, asset) ? asset.tbStructure : null;
  const derivedStructure = !manualStructure && !explicitStructure && !persistedStructure && options.smartParsingAvailable === true && tableLike
    ? deriveTbStructureFromRows(rawRows, asset)
    : null;
  if (extension === '.xlsx') {
    parsed = parseWorkbookRows(asset.storedPath, options);
  } else {
    const raw = fs.readFileSync(asset.storedPath, 'utf8');
    parsed = extension === '.tbx'
      ? {
        entries: parseTbxGlossary(raw),
        parseInfo: {
          parsingMode: 'tbx',
          smartParsingAvailable: options.smartParsingAvailable === true,
          smartParsingRecommended: false,
          usedFallbackMapping: false,
          hasExplicitHeaders: false,
          detectedMapping: {},
          mappingConfidence: { level: 'high', score: 1 },
          mappingWarnings: [],
          unmappedColumns: [],
          upgradeHint: '',
          tbStructure: null,
          languagePair: {
            source: '',
            target: ''
          },
          manualMappingRequired: false,
          manualMapping: {}
        }
      }
      : extension === '.tsv'
        ? parseDelimitedGlossary(raw, '\t', options)
        : parsePlainGlossary(raw, options);
  }

  const activeStructure = manualStructure
    || explicitStructure
    || persistedStructure
    || ((parsed?.parseInfo?.parsingMode === 'fallback' || parsed?.parseInfo?.usedFallbackMapping === true) ? derivedStructure : null);
  if (tableLike && activeStructure && rawRows.length > 1) {
    const structuredEntries = buildEntriesFromTbStructure(rawRows, activeStructure);
    if (structuredEntries.length) {
      const suppressFallbackWarnings = activeStructure?.sourceOfTruth === 'header_inferred' || activeStructure?.sourceOfTruth === 'manual_mapping';
      const structureWarnings = suppressFallbackWarnings ? [] : (parsed?.parseInfo?.mappingWarnings || []);
      parsed = finalizeParsedTable({
        entries: structuredEntries,
        rows: rawRows,
        warnings: structureWarnings,
        parsingMode: options.smartParsingAvailable === true ? 'smart' : 'fallback',
        smartParsingAvailable: options.smartParsingAvailable === true,
        usedFallbackMapping: activeStructure?.sourceOfTruth === 'manual_mapping',
        hasExplicitHeaders: true,
        tbStructure: activeStructure,
        tbStructuringMode: activeStructure?.sourceOfTruth === 'manual_mapping'
          ? 'manual_mapping'
          : activeStructure?.sourceOfTruth === 'header_inferred'
            ? 'explicitly_inferred'
            : options.smartParsingAvailable === true
              ? 'ai_structured'
              : 'deterministic'
      });
    }
  }

  if (activeStructure && parsed?.parseInfo) {
    parsed.parseInfo.tbStructure = activeStructure;
    parsed.parseInfo.tbStructureAvailable = true;
    parsed.parseInfo.tbStructuringMode = parsed.parseInfo.tbStructuringMode || (activeStructure?.sourceOfTruth === 'manual_mapping'
      ? 'manual_mapping'
      : activeStructure?.sourceOfTruth === 'header_inferred'
        ? 'explicitly_inferred'
        : options.smartParsingAvailable === true ? 'ai_structured' : 'deterministic');
    parsed.parseInfo.tbStructureSummary = activeStructure.summary || '';
    parsed.parseInfo.tbStructureFingerprint = activeStructure.fingerprint || '';
    parsed.parseInfo.languagePair = activeStructure.languagePair || { source: '', target: '' };
    parsed.parseInfo.manualMappingRequired = false;
    parsed.parseInfo.manualMapping = asset?.tbManualMapping || {};
    parsed.parseInfo.tbStructureConfidence = activeStructure.confidence || parsed.parseInfo.mappingConfidence;
    parsed.parseInfo.tbStructureSource = activeStructure.sourceOfTruth || '';
    if (activeStructure?.sourceOfTruth === 'header_inferred' || activeStructure?.sourceOfTruth === 'manual_mapping') {
      parsed.parseInfo.mappingWarnings = [];
      parsed.parseInfo.tbStructureWarnings = [];
    }
  } else if (parsed?.parseInfo) {
    parsed.parseInfo.languagePair = asset?.tbLanguagePair || { source: '', target: '' };
    parsed.parseInfo.manualMappingRequired = options.smartParsingAvailable === true && tableLike && parsed.parseInfo.usedFallbackMapping === true;
    parsed.parseInfo.manualMapping = asset?.tbManualMapping || {};
    parsed.parseInfo.tbStructureConfidence = parsed.parseInfo.mappingConfidence;
    parsed.parseInfo.tbStructureSource = '';
  }

  if (extension === '.tbx' && parsed?.parseInfo && !parsed.parseInfo.tbStructure) {
    const firstEntry = (parsed.entries || [])[0] || {};
    if (firstEntry.srcLang || firstEntry.tgtLang) {
      parsed.parseInfo.tbStructure = {
        version: 1,
        derivedFromSha256: String(asset?.sha256 || ''),
        sourceOfTruth: 'xml_inferred',
        confidence: { level: 'high', score: 1 },
        languagePair: {
          source: String(firstEntry.srcLang || ''),
          target: String(firstEntry.tgtLang || '')
        }
      };
      parsed.parseInfo.tbStructureAvailable = true;
      parsed.parseInfo.tbStructuringMode = 'tbx';
      parsed.parseInfo.languagePair = parsed.parseInfo.tbStructure.languagePair;
      parsed.parseInfo.tbStructureConfidence = parsed.parseInfo.tbStructure.confidence;
      parsed.parseInfo.tbStructureSource = 'xml_inferred';
    }
  }

  const limitedEntries = (parsed.entries || []).filter(Boolean).slice(0, MAX_GLOSSARY_ROWS);
  const renderedText = truncateText(createRenderedTb(limitedEntries), MAX_GLOSSARY_CHARACTERS);
  const fingerprint = createTbFingerprint(limitedEntries);
  const matcher = createTbMatcher(limitedEntries);

  return {
    text: renderedText,
    renderedText,
    fingerprint,
    rowCount: limitedEntries.length,
    entries: limitedEntries,
    matcher,
    parseInfo: parsed.parseInfo
  };
}

function parseCustomTmAsset(asset, options = {}) {
  const extension = path.extname(String(asset?.fileName || asset?.name || '')).trim().toLowerCase();
  let parsed;

  if (extension === '.xlsx') {
    parsed = parseWorkbookRows(asset.storedPath, options);
  } else {
    const raw = fs.readFileSync(asset.storedPath, 'utf8');
    parsed = extension === '.tsv'
      ? parseDelimitedGlossary(raw, '\t', options)
      : parsePlainGlossary(raw, options);
  }

  const limitedEntries = (parsed.entries || []).filter(Boolean).slice(0, MAX_GLOSSARY_ROWS);

  return {
    text: '',
    fingerprint: createTbFingerprint(limitedEntries),
    rowCount: limitedEntries.length,
    entries: limitedEntries,
    parseInfo: parsed.parseInfo
  };
}

module.exports = {
  parseGlossaryAsset,
  parseCustomTmAsset,
  __internals: {
    collectRawTableRowsFromAsset,
    collectRawTableRowsFromText,
    parseDelimitedGlossary,
    parsePlainGlossary,
    parseTableRows,
    parseWorkbookRows,
    parseTbxGlossary
  }
};
