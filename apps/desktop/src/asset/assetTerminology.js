const crypto = require('crypto');
const {
  getBaseLanguage,
  getLanguageAliasKeys,
  normalizeCanonicalLanguageTag
} = require('../shared/languageNormalization');

const NORMALIZED_MATCHER_VERSION = 'normalized-ac-v1';

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function normalizeBoolean(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y'].includes(normalized);
}

function normalizeMatchMode(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'wholeword') return 'whole_word';
  if (normalized === 'normalized') return 'normalized';
  if (normalized === 'exact') return 'exact';
  if (normalized === 'phrase') return 'phrase';
  if (normalized === 'whole_word') return 'whole_word';
  return 'phrase';
}

function normalizeLanguageKey(value) {
  return normalizeCanonicalLanguageTag(value) || '*';
}

function stripMarkup(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function isSeparatorChar(char) {
  return /[\s\u00a0_\-/\\.,;:!?()[\]{}"'`~@#$%^&*+=|<>]/.test(char);
}

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

function normalizeTermMatchText(value, entry = {}) {
  return createNormalizedMatchSurface(value, entry).text;
}

function normalizeForMatch(value, entry = {}) {
  return normalizeTermMatchText(value, entry);
}

function normalizeTbEntry(entry = {}, index = 0) {
  const normalized = {
    id: String(entry.id || `tb-${index + 1}`).trim() || `tb-${index + 1}`,
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

function createTbFingerprint(entries = []) {
  return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

function createAutomaton(entries = []) {
  const nodes = [{ next: new Map(), fail: 0, outputs: [] }];

  function ensureNode(parentIndex, char) {
    const parent = nodes[parentIndex];
    if (parent.next.has(char)) {
      return parent.next.get(char);
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

  const queue = [];
  for (const nextIndex of nodes[0].next.values()) {
    queue.push(nextIndex);
  }

  while (queue.length) {
    const nodeIndex = queue.shift();
    const node = nodes[nodeIndex];

    for (const [char, childIndex] of node.next.entries()) {
      let failIndex = node.fail;
      while (failIndex && !nodes[failIndex].next.has(char)) {
        failIndex = nodes[failIndex].fail;
      }

      if (nodes[failIndex].next.has(char)) {
        nodes[childIndex].fail = nodes[failIndex].next.get(char);
      }

      nodes[childIndex].outputs = nodes[childIndex].outputs.concat(nodes[nodes[childIndex].fail].outputs);
      queue.push(childIndex);
    }
  }

  return { nodes };
}

function createTerminologyMatcher(entries = []) {
  const normalizedEntries = toArray(entries)
    .map((entry, index) => normalizeTbEntry(entry, index))
    .filter((entry) => entry.sourceTerm && entry.targetTerm && entry.normalizedSourceTerm);
  normalizedEntries.forEach((entry) => {
    entry.directionRank = 1;
    entry.matchDirection = 'forward';
  });
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

function createTbMatcher(entries = []) {
  return createTerminologyMatcher(entries);
}

function charAt(text, index) {
  if (index < 0 || index >= text.length) return '';
  return text[index];
}

function isAsciiWordChar(char) {
  return /[0-9A-Za-z]/.test(char);
}

function isCjkChar(char) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(char);
}

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

function renderMatchedTbMetadataBlock(matches = [], tb = {}) {
  const sections = [];
  const languagePair = tb?.languagePair || {};
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

function includesVariant(haystack, variants = [], entry) {
  const normalizedHaystack = normalizeForMatch(haystack, entry);
  return variants.some((variant) => normalizedHaystack.includes(normalizeForMatch(variant, entry)));
}

function evaluateTerminologyQa({ translatedText, matches = [] } = {}) {
  const issues = [];

  for (const match of matches) {
    const entry = match.entry || match;
    const requiredVariants = [entry.targetTerm, ...(entry.allowedVariants || [])].filter(Boolean);

    if (entry.forbidden) {
      if (includesVariant(translatedText, [entry.targetTerm], entry)) {
        issues.push({
          type: 'forbidden_term_present',
          sourceTerm: entry.sourceTerm,
          targetTerm: entry.targetTerm,
          message: `"${entry.sourceTerm}" must not be translated as "${entry.targetTerm}".`
        });
      }
      continue;
    }

    if (!includesVariant(translatedText, requiredVariants, entry)) {
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
