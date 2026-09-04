const crypto = require('crypto');
const {
  getBaseLanguage,
  getLanguageAliasKeys,
  normalizeCanonicalLanguageTag
} = require('../shared/languageNormalization');

const NORMALIZED_MATCHER_VERSION = 'normalized-ac-v1';

/** @typedef {Record<string, any>} TbEntry */

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
 * @returns {any[]}
 */
function toArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function normalizeBoolean(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y'].includes(normalized);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeMatchMode(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'wholeword') return 'whole_word';
  if (normalized === 'normalized') return 'normalized';
  if (normalized === 'exact') return 'exact';
  if (normalized === 'phrase') return 'phrase';
  if (normalized === 'whole_word') return 'whole_word';
  return 'phrase';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeLanguageKey(value) {
  return normalizeCanonicalLanguageTag(value) || '*';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stripMarkup(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

/**
 * @param {string} char
 * @returns {boolean}
 */
function isSeparatorChar(char) {
  return /[\s\u00a0_\-/\\.,;:!?()[\]{}"'`~@#$%^&*+=|<>]/.test(char);
}

/**
 * @param {string} char
 * @param {TbEntry=} entry
 * @returns {string[]}
 */
function normalizeCharChunk(char, entry = {}) {
  const normalized = String(char || '').normalize('NFKC');
  const output = [];

  for (const item of normalized) {
    let next = item;
    if (entry.caseSensitive !== true) {
      next = next.toLocaleLowerCase();
    }

    if (normalizeMatchMode(entry.matchMode) === 'normalized' && isSeparatorChar(next)) {
      output.push(' ');
      continue;
    }

    if (/\s/.test(next)) {
      output.push(' ');
      continue;
    }

    output.push(next);
  }

  return output;
}

/**
 * @param {unknown} value
 * @param {TbEntry=} entry
 * @returns {{ text: string, map: number[], source: string }}
 */
function createNormalizedMatchSurface(value, entry = {}) {
  const source = stripMarkup(value);
  const chars = [];
  const map = [];

  for (let index = 0; index < source.length; index += 1) {
    const chunk = normalizeCharChunk(source[index], entry);
    for (const char of chunk) {
      const previous = chars[chars.length - 1] || '';
      if (char === ' ' && (!chars.length || previous === ' ')) {
        continue;
      }
      chars.push(char);
      map.push(index);
    }
  }

  while (chars[0] === ' ') {
    chars.shift();
    map.shift();
  }
  while (chars[chars.length - 1] === ' ') {
    chars.pop();
    map.pop();
  }

  return {
    text: chars.join(''),
    map,
    source
  };
}

/**
 * @param {unknown} value
 * @param {TbEntry=} entry
 * @returns {string}
 */
function normalizeTermMatchText(value, entry = {}) {
  return createNormalizedMatchSurface(value, entry).text;
}

/**
 * @param {unknown} value
 * @param {TbEntry=} entry
 * @returns {string}
 */
function normalizeForMatch(value, entry = {}) {
  return normalizeTermMatchText(value, entry);
}

/**
 * @param {Record<string, unknown>=} entry
 * @param {number=} index
 * @returns {TbEntry}
 */
function normalizeTbEntry(entry = {}, index = 0) {
  /** @type {TbEntry} */
  const normalized = {
    id: String(entry.id || `tb-${index + 1}`).trim() || `tb-${index + 1}`,
    assetId: String(entry.assetId || '').trim(),
    assetName: String(entry.assetName || '').trim(),
    sourceTerm: normalizeWhitespace(entry.sourceTerm),
    targetTerm: normalizeWhitespace(entry.targetTerm),
    srcLang: normalizeWhitespace(entry.srcLang),
    tgtLang: normalizeWhitespace(entry.tgtLang),
    domain: normalizeWhitespace(entry.domain),
    client: normalizeWhitespace(entry.client),
    project: normalizeWhitespace(entry.project),
    partOfSpeech: normalizeWhitespace(entry.partOfSpeech),
    caseSensitive: normalizeBoolean(entry.caseSensitive),
    matchMode: normalizeMatchMode(entry.matchMode),
    priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 0,
    forbidden: normalizeBoolean(entry.forbidden),
    allowedVariants: toArray(entry.allowedVariants).map((item) => normalizeWhitespace(item)).filter(Boolean),
    note: normalizeWhitespace(entry.note),
    metadata: entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
    tbMetadataText: normalizeWhitespace(entry.tbMetadataText)
  };
  normalized.normalizedSourceTerm = normalizeForMatch(normalized.sourceTerm, normalized);
  normalized.normalizedTargetTerm = normalizeForMatch(normalized.targetTerm, normalized);
  normalized.scopeRank = (normalized.project ? 4 : 0) + (normalized.client ? 2 : 0) + (normalized.domain ? 1 : 0);
  normalized.matchRank = normalized.matchMode === 'exact'
    ? 4
    : normalized.matchMode === 'whole_word'
      ? 3
      : normalized.matchMode === 'phrase'
        ? 2
        : 1;
  return normalized;
}

/**
 * @param {TbEntry=} entry
 * @returns {TbEntry}
 */
function createReverseTerminologyEntry(entry = {}) {
  return {
    ...entry,
    sourceTerm: entry.targetTerm,
    targetTerm: entry.sourceTerm,
    srcLang: entry.tgtLang,
    tgtLang: entry.srcLang,
    normalizedSourceTerm: entry.normalizedTargetTerm,
    normalizedTargetTerm: entry.normalizedSourceTerm,
    directionRank: 0,
    matchDirection: 'reverse'
  };
}

/**
 * @param {unknown=} entries
 * @returns {string}
 */
function createTbFingerprint(entries = []) {
  return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

/**
 * @param {TbEntry[]=} entries
 * @returns {{ nodes: any[] }}
 */
function createAutomaton(entries = []) {
  /** @type {Array<{ next: Map<string, number>, fail: number, outputs: any[] }>} */
  const nodes = [{ next: new Map(), fail: 0, outputs: [] }];

  /**
   * @param {number} parentIndex
   * @param {string} char
   * @returns {number}
   */
  function ensureNode(parentIndex, char) {
    const parent = nodes[parentIndex];
    if (parent.next.has(char)) {
      return /** @type {number} */ (parent.next.get(char));
    }

    const index = nodes.length;
    parent.next.set(char, index);
    nodes.push({ next: new Map(), fail: 0, outputs: [] });
    return index;
  }

  for (const entry of entries) {
    if (!entry.normalizedSourceTerm) {
      continue;
    }

    let nodeIndex = 0;
    for (const char of entry.normalizedSourceTerm) {
      nodeIndex = ensureNode(nodeIndex, char);
    }
    nodes[nodeIndex].outputs.push(entry);
  }

  /** @type {number[]} */
  const queue = [];
  for (const nextIndex of nodes[0].next.values()) {
    queue.push(nextIndex);
  }

  while (queue.length) {
    const nodeIndex = /** @type {number} */ (queue.shift());
    const node = nodes[nodeIndex];

    for (const [char, childIndex] of node.next.entries()) {
      let failIndex = node.fail;
      while (failIndex && !nodes[failIndex].next.has(char)) {
        failIndex = nodes[failIndex].fail;
      }

      if (nodes[failIndex].next.has(char)) {
        nodes[childIndex].fail = /** @type {number} */ (nodes[failIndex].next.get(char));
      }

      nodes[childIndex].outputs = nodes[childIndex].outputs.concat(nodes[nodes[childIndex].fail].outputs);
      queue.push(childIndex);
    }
  }

  return { nodes };
}

/**
 * @param {unknown=} entries
 * @returns {Record<string, any>}
 */
function createTerminologyMatcher(entries = []) {
  const normalizedEntries = toArray(entries)
    .map((entry, index) => normalizeTbEntry(entry, index))
    .filter((entry) => entry.sourceTerm && entry.targetTerm && entry.normalizedSourceTerm);
  normalizedEntries.forEach((entry) => {
    entry.directionRank = 1;
    entry.matchDirection = 'forward';
  });
  /** @type {Map<string, any[]>} */
  const buckets = new Map();

  for (const entry of normalizedEntries) {
    const sourceKeys = getLanguageAliasKeys(entry.srcLang);
    const targetKeys = getLanguageAliasKeys(entry.tgtLang);
    for (const sourceKey of sourceKeys) {
      for (const targetKey of targetKeys) {
        const key = `${sourceKey}:${targetKey}`;
        const bucketEntries = buckets.get(key) || [];
        if (!bucketEntries.some((item) => item.id === entry.id)) {
          bucketEntries.push(entry);
          buckets.set(key, bucketEntries);
        }
      }
    }
  }

  const compiledBuckets = new Map();
  for (const [key, bucketEntries] of buckets.entries()) {
    const defaultEntries = bucketEntries.filter((entry) => entry.matchMode !== 'normalized');
    const normalizedEntries = bucketEntries.filter((entry) => entry.matchMode === 'normalized');
    const reverseEntries = bucketEntries.map((entry) => createReverseTerminologyEntry(entry));
    const reverseDefaultEntries = reverseEntries.filter((entry) => entry.matchMode !== 'normalized');
    const reverseNormalizedEntries = reverseEntries.filter((entry) => entry.matchMode === 'normalized');
    compiledBuckets.set(key, {
      entries: bucketEntries,
      automaton: createAutomaton(defaultEntries),
      normalizedAutomaton: createAutomaton(normalizedEntries),
      reverseAutomaton: createAutomaton(reverseDefaultEntries),
      reverseNormalizedAutomaton: createAutomaton(reverseNormalizedEntries)
    });
  }

  return {
    version: NORMALIZED_MATCHER_VERSION,
    entries: normalizedEntries,
    buckets: compiledBuckets
  };
}

/**
 * @param {unknown=} entries
 * @returns {Record<string, any>}
 */
function createTbMatcher(entries = []) {
  return createTerminologyMatcher(entries);
}

/**
 * @param {string} text
 * @param {number} index
 * @returns {string}
 */
function charAt(text, index) {
  if (index < 0 || index >= text.length) return '';
  return text[index];
}

/**
 * @param {string} char
 * @returns {boolean}
 */
function isAsciiWordChar(char) {
  return /[0-9A-Za-z]/.test(char);
}

/**
 * @param {string} char
 * @returns {boolean}
 */
function isCjkChar(char) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(char);
}

/**
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {TbEntry} entry
 * @returns {boolean}
 */
function passesBoundary(text, start, end, entry) {
  if (entry.matchMode === 'phrase' || entry.matchMode === 'normalized') {
    const prev = charAt(text, start - 1);
    const next = charAt(text, end);
    if (isCjkChar(prev) || isCjkChar(next)) return true;
    if (!prev && !next) return true;
    if (!prev || !isAsciiWordChar(prev)) {
      return !next || !isAsciiWordChar(next);
    }
    return false;
  }

  if (entry.matchMode === 'whole_word' || entry.matchMode === 'exact') {
    const prev = charAt(text, start - 1);
    const next = charAt(text, end);
    return (!prev || !isAsciiWordChar(prev)) && (!next || !isAsciiWordChar(next));
  }

  return true;
}

/**
 * @param {Record<string, any> | undefined} matcher
 * @param {unknown} srcLang
 * @param {unknown} tgtLang
 * @returns {any[]}
 */
function getCandidateBuckets(matcher, srcLang, tgtLang) {
  const sourceFull = normalizeLanguageKey(srcLang);
  const targetFull = normalizeLanguageKey(tgtLang);
  const sourceBase = getBaseLanguage(sourceFull);
  const targetBase = getBaseLanguage(targetFull);
  const candidateKeys = [
    `${sourceFull}:${targetFull}`,
    `${sourceFull}:${targetBase || targetFull}`,
    `${sourceBase || sourceFull}:${targetFull}`,
    `${sourceBase || sourceFull}:${targetBase || targetFull}`,
    `*:${targetFull}`,
    `*:${targetBase || targetFull}`,
    `${sourceFull}:*`,
    `${sourceBase || sourceFull}:*`,
    '*:*'
  ];
  const seen = new Set();
  return candidateKeys
    .filter((key) => key && !seen.has(key) && seen.add(key))
    .map((key) => matcher?.buckets?.get(key))
    .filter(Boolean);
}

/**
 * @param {{ text: string, map: number[], source: string }} surface
 * @param {number} normalizedStart
 * @param {TbEntry} entry
 * @returns {Record<string, any> | null}
 */
function createStructuredHit(surface, normalizedStart, entry) {
  const normalizedEnd = normalizedStart + entry.normalizedSourceTerm.length;
  if (normalizedStart < 0 || normalizedEnd > surface.text.length) {
    return null;
  }

  const originalStart = surface.map[normalizedStart];
  const originalEndIndex = surface.map[normalizedEnd - 1];
  const start = Number.isFinite(originalStart) ? originalStart : normalizedStart;
  const end = Number.isFinite(originalEndIndex) ? originalEndIndex + 1 : normalizedEnd;
  const matchedText = surface.source.slice(start, end);
  const normalizedMatchText = surface.text.slice(normalizedStart, normalizedEnd);

  return {
    start,
    end,
    normalizedStart,
    normalizedEnd,
    matchedText,
    normalizedMatchText,
    entry,
    entryId: entry.id,
    sourceTerm: entry.sourceTerm,
    targetTerm: entry.targetTerm,
    forbidden: entry.forbidden,
    note: entry.note,
    priority: entry.priority
  };
}

/**
 * @param {{ nodes: any[] }} automaton
 * @param {{ text: string, map: number[], source: string }} surface
 * @returns {any[]}
 */
function matchAutomaton(automaton, surface) {
  const hits = [];
  let nodeIndex = 0;

  for (let index = 0; index < surface.text.length; index += 1) {
    const char = surface.text[index];

    while (nodeIndex && !automaton.nodes[nodeIndex].next.has(char)) {
      nodeIndex = automaton.nodes[nodeIndex].fail;
    }

    if (automaton.nodes[nodeIndex].next.has(char)) {
      nodeIndex = automaton.nodes[nodeIndex].next.get(char);
    }

    const node = automaton.nodes[nodeIndex];
    if (!node.outputs.length) {
      continue;
    }

    for (const entry of node.outputs) {
      const normalizedStart = index - entry.normalizedSourceTerm.length + 1;
      const normalizedEnd = index + 1;
      if (!passesBoundary(surface.text, normalizedStart, normalizedEnd, entry)) {
        continue;
      }

      const hit = createStructuredHit(surface, normalizedStart, entry);
      if (hit) {
        hits.push(hit);
      }
    }
  }

  return hits;
}

/**
 * @param {any[]=} hits
 * @returns {any[]}
 */
function dedupeMatches(hits = []) {
  const selected = [];
  let cursor = -1;

  for (const hit of hits) {
    if (hit.normalizedStart < cursor) {
      continue;
    }
    selected.push(hit);
    cursor = hit.normalizedEnd;
  }

  return selected;
}

/**
 * @param {{ matcher?: Record<string, any>, text?: unknown, srcLang?: unknown, tgtLang?: unknown, metadata?: Record<string, unknown> }} options
 * @returns {any[]}
 */
function matchTbEntries({ matcher, text, srcLang, tgtLang, metadata = {} }) {
  if (!matcher || !text) return [];

  const surfaces = {
    default: createNormalizedMatchSurface(text, { matchMode: 'phrase' }),
    normalized: createNormalizedMatchSurface(text, { matchMode: 'normalized' })
  };
  if (!surfaces.default.text && !surfaces.normalized.text) {
    return [];
  }

  const forwardHits = getCandidateBuckets(matcher, srcLang, tgtLang).flatMap((bucket) => ([
    ...(surfaces.default.text ? matchAutomaton(bucket.automaton, surfaces.default) : []),
    ...(surfaces.normalized.text ? matchAutomaton(bucket.normalizedAutomaton, surfaces.normalized) : [])
  ]));
  const reverseHits = getCandidateBuckets(matcher, tgtLang, srcLang).flatMap((bucket) => ([
    ...(surfaces.default.text ? matchAutomaton(bucket.reverseAutomaton, surfaces.default) : []),
    ...(surfaces.normalized.text ? matchAutomaton(bucket.reverseNormalizedAutomaton, surfaces.normalized) : [])
  ]));
  const hits = [...forwardHits, ...reverseHits];

  hits.sort((left, right) => {
    const byStart = left.normalizedStart - right.normalizedStart;
    if (byStart !== 0) return byStart;
    const byLength = (right.normalizedEnd - right.normalizedStart) - (left.normalizedEnd - left.normalizedStart);
    if (byLength !== 0) return byLength;
    const byPriority = right.entry.priority - left.entry.priority;
    if (byPriority !== 0) return byPriority;
    const byScope = right.entry.scopeRank - left.entry.scopeRank;
    if (byScope !== 0) return byScope;
    const byDirection = (right.entry.directionRank || 0) - (left.entry.directionRank || 0);
    if (byDirection !== 0) return byDirection;
    return right.entry.matchRank - left.entry.matchRank;
  });

  return dedupeMatches(hits);
}

/**
 * @param {any[]=} matches
 * @returns {string}
 */
function renderMatchedTerminologyBlock(matches = []) {
  const required = [];
  const forbidden = [];
  const seen = new Set();

  for (const match of matches) {
    const entry = match.entry || match;
    const key = `${entry.sourceTerm}|${entry.targetTerm}|${entry.forbidden ? '1' : '0'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry.forbidden) forbidden.push(entry);
    else required.push(entry);
  }

  const sections = [];
  if (required.length) {
    sections.push([
      'Required terminology:',
      ...required.map((entry) => entry.note
        ? `- "${entry.sourceTerm}" => "${entry.targetTerm}" (note: ${entry.note})`
        : `- "${entry.sourceTerm}" => "${entry.targetTerm}"`)
    ].join('\n'));
  }
  if (forbidden.length) {
    sections.push([
      'Forbidden terminology:',
      ...forbidden.map((entry) => entry.note
        ? `- Do not translate "${entry.sourceTerm}" as "${entry.targetTerm}" (note: ${entry.note})`
        : `- Do not translate "${entry.sourceTerm}" as "${entry.targetTerm}"`)
    ].join('\n'));
  }
  return sections.join('\n\n').trim();
}

/**
 * @param {any[]=} matches
 * @param {Record<string, unknown>=} tb
 * @returns {string}
 */
function renderMatchedTbMetadataBlock(matches = [], tb = {}) {
  const sections = [];
  const languagePair = /** @type {Record<string, any>} */ (tb?.languagePair || {});
  if (languagePair.source || languagePair.target) {
    sections.push(`TB language pair: ${languagePair.source || ''} -> ${languagePair.target || ''}`.trim());
  }

  const seen = new Set();
  for (const match of matches) {
    const entry = match.entry || match;
    const key = `${entry.sourceTerm}|${entry.targetTerm}|${entry.tbMetadataText || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!entry?.tbMetadataText) continue;
    sections.push([
      `Matched TB entry: ${entry.sourceTerm} -> ${entry.targetTerm}`,
      entry.tbMetadataText
    ].filter(Boolean).join('\n'));
  }

  return sections.join('\n\n').trim();
}

/**
 * @param {string} haystack
 * @param {unknown[]=} variants
 * @param {TbEntry=} entry
 * @returns {boolean}
 */
function includesVariant(haystack, variants = [], entry) {
  const normalizedHaystack = normalizeForMatch(haystack, entry);
  return variants.some((variant) => normalizedHaystack.includes(normalizeForMatch(variant, entry)));
}

/**
 * @param {{ translatedText?: unknown, matches?: any[] }=} options
 * @returns {Record<string, any>}
 */
function evaluateTerminologyQa({ translatedText, matches = [] } = {}) {
  const issues = [];

  for (const match of matches) {
    const entry = match.entry || match;
    const requiredVariants = [entry.targetTerm, ...(entry.allowedVariants || [])].filter(Boolean);

    if (entry.forbidden) {
      if (includesVariant(/** @type {string} */ (translatedText), [entry.targetTerm], entry)) {
        issues.push({
          type: 'forbidden_term_present',
          sourceTerm: entry.sourceTerm,
          targetTerm: entry.targetTerm,
          message: `"${entry.sourceTerm}" must not be translated as "${entry.targetTerm}".`
        });
      }
      continue;
    }

    if (!includesVariant(/** @type {string} */ (translatedText), requiredVariants, entry)) {
      issues.push({
        type: 'required_term_missing',
        sourceTerm: entry.sourceTerm,
        targetTerm: entry.targetTerm,
        message: `"${entry.sourceTerm}" should use "${entry.targetTerm}" in the translation.`
      });
    }
  }

  return {
    ok: issues.length === 0,
    blocking: false,
    issues
  };
}

module.exports = {
  NORMALIZED_MATCHER_VERSION,
  createTbFingerprint,
  createTbMatcher,
  createTerminologyMatcher,
  evaluateTerminologyQa,
  matchTbEntries,
  normalizeForMatch,
  normalizeTbEntry,
  normalizeTermMatchText,
  renderMatchedTbMetadataBlock,
  renderMatchedTerminologyBlock
};
