const crypto = require('crypto');

const DEFAULT_MIN_SCORE = 75;
const DEFAULT_MAX_MATCHES = 3;
const DEFAULT_CANDIDATE_LIMIT = 50;
const CUSTOM_TM_MATCH_BUCKETS = Object.freeze(['101%', '100%', '95-99', '85-94', '75-84', '<75']);
const DEFAULT_CUSTOM_TM_MATCH_BUCKETS = Object.freeze(['101%', '100%', '95-99', '85-94', '75-84']);

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeWhitespace(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeLanguageKey(value) {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function getBaseLanguage(value) {
  return normalizeLanguageKey(value).split('-')[0] || '';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stripInlineMarkup(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, (match) => ` ${match} `)
    .replace(/\{\d+\}/g, (match) => ` ${match} `);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function extractPlaceholders(value) {
  const text = String(value || '');
  const matches = text.match(/(\{\d+\}|<[^>]+>|\{\{[^}]+\}\}|%[A-Za-z0-9_.-]+%|\$[A-Za-z0-9_.-]+)/g);
  return matches ? matches.map((item) => item.toLowerCase()) : [];
}

/**
 * @typedef {Object} TmTokenizeOptions
 * @property {boolean=} caseSensitive
 */

/**
 * @param {unknown} value
 * @param {TmTokenizeOptions=} options
 * @returns {string[]}
 */
function tokenizeForTmMatch(value, options = {}) {
  const lower = options.caseSensitive === true
    ? stripInlineMarkup(value)
    : stripInlineMarkup(value).toLocaleLowerCase();
  const normalized = normalizeWhitespace(lower);
  if (!normalized) {
    return [];
  }

  const tokens = [];
  const pattern = /<[^>]+>|\{\d+\}|\{\{[^}]+\}\}|%[A-Za-z0-9_.-]+%|\$[A-Za-z0-9_.-]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu;
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

/**
 * @param {unknown=} left
 * @param {unknown=} right
 * @returns {number}
 */
function levenshteinDistance(left = [], right = []) {
  const source = Array.isArray(left) ? left : [];
  const target = Array.isArray(right) ? right : [];
  if (!source.length) return target.length;
  if (!target.length) return source.length;

  let previous = Array.from({ length: source.length + 1 }, (_, index) => index);
  let current = new Array(source.length + 1);

  for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
    current[0] = targetIndex;
    const targetToken = target[targetIndex - 1];
    for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
      const cost = source[sourceIndex - 1] === targetToken ? 0 : 1;
      current[sourceIndex] = Math.min(
        current[sourceIndex - 1] + 1,
        previous[sourceIndex] + 1,
        previous[sourceIndex - 1] + cost
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[source.length];
}

/**
 * @param {string[]=} leftTokens
 * @param {string[]=} rightTokens
 * @returns {number}
 */
function calculateTokenSimilarity(leftTokens = [], rightTokens = []) {
  const maxLength = Math.max(leftTokens.length, rightTokens.length);
  if (!maxLength) {
    return 0;
  }

  const distance = levenshteinDistance(leftTokens, rightTokens);
  return Math.max(0, Math.min(100, Math.round((100 * (maxLength - distance)) / maxLength)));
}

/**
 * @param {string[]=} leftTokens
 * @param {string[]=} rightTokens
 * @returns {number}
 */
function calculateTokenOverlap(leftTokens = [], rightTokens = []) {
  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const rightCounts = new Map();
  for (const token of rightTokens) {
    rightCounts.set(token, (rightCounts.get(token) || 0) + 1);
  }

  let shared = 0;
  for (const token of leftTokens) {
    const count = rightCounts.get(token) || 0;
    if (count > 0) {
      shared += 1;
      rightCounts.set(token, count - 1);
    }
  }

  return shared / Math.max(leftTokens.length, rightTokens.length);
}

/**
 * @param {unknown} sourceText
 * @param {unknown} candidateText
 * @returns {number}
 */
function calculatePlaceholderPenalty(sourceText, candidateText) {
  const sourcePlaceholders = extractPlaceholders(sourceText);
  const candidatePlaceholders = extractPlaceholders(candidateText);
  if (!sourcePlaceholders.length && !candidatePlaceholders.length) {
    return 0;
  }

  const sourceKey = sourcePlaceholders.join('|');
  const candidateKey = candidatePlaceholders.join('|');
  if (sourceKey === candidateKey) {
    return 0;
  }

  const sourceSet = new Set(sourcePlaceholders);
  const candidateSet = new Set(candidatePlaceholders);
  let missing = 0;
  for (const item of sourceSet) {
    if (!candidateSet.has(item)) missing += 1;
  }
  for (const item of candidateSet) {
    if (!sourceSet.has(item)) missing += 1;
  }

  return Math.min(25, 8 + missing * 6);
}

/**
 * @param {unknown} score
 * @param {boolean=} hasContextMatch
 * @returns {string}
 */
function bucketTmScore(score, hasContextMatch = false) {
  const normalized = Math.max(0, Math.min(101, Math.round(Number(score) || 0)));
  if (normalized === 100 && hasContextMatch) return '101%';
  if (normalized >= 100) return '100%';
  if (normalized >= 95) return '95-99';
  if (normalized >= 85) return '85-94';
  if (normalized >= 75) return '75-84';
  return '<75';
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeCustomTmMatchBuckets(value) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_CUSTOM_TM_MATCH_BUCKETS];
  }

  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    const bucket = String(item || '').trim();
    if (!CUSTOM_TM_MATCH_BUCKETS.includes(bucket) || seen.has(bucket)) {
      continue;
    }
    seen.add(bucket);
    normalized.push(bucket);
  }

  return normalized.length ? normalized : [...DEFAULT_CUSTOM_TM_MATCH_BUCKETS];
}

/** @typedef {Record<string, unknown>} CustomTmEntryInput */

/**
 * @typedef {Object} CustomTmEntry
 * @property {string} id
 * @property {string} sourceText
 * @property {string} targetText
 * @property {string} sourceTerm
 * @property {string} targetTerm
 * @property {string} sourceLang
 * @property {string} targetLang
 * @property {string} srcLang
 * @property {string} tgtLang
 * @property {string} assetId
 * @property {string} assetName
 * @property {Record<string, unknown>} metadata
 * @property {Record<string, unknown>} context
 */

/**
 * @param {CustomTmEntryInput=} entry
 * @param {number=} index
 * @param {{ id?: unknown, name?: unknown }=} asset
 * @returns {CustomTmEntry | null}
 */
function normalizeCustomTmEntry(entry = {}, index = 0, asset = {}) {
  const sourceText = normalizeWhitespace(entry.sourceText || entry.sourceTerm || entry.source || '');
  const targetText = normalizeWhitespace(entry.targetText || entry.targetTerm || entry.target || '');
  if (!sourceText || !targetText) {
    return null;
  }

  return {
    id: String(entry.id || `tm-${index + 1}`),
    sourceText,
    targetText,
    sourceTerm: sourceText,
    targetTerm: targetText,
    sourceLang: String(entry.sourceLang || entry.srcLang || ''),
    targetLang: String(entry.targetLang || entry.tgtLang || ''),
    srcLang: String(entry.sourceLang || entry.srcLang || ''),
    tgtLang: String(entry.targetLang || entry.tgtLang || ''),
    assetId: String(asset.id || entry.assetId || ''),
    assetName: String(asset.name || entry.assetName || ''),
    metadata: entry.metadata && typeof entry.metadata === 'object' ? /** @type {Record<string, unknown>} */ (entry.metadata) : {},
    context: entry.context && typeof entry.context === 'object' ? /** @type {Record<string, unknown>} */ (entry.context) : {}
  };
}

/**
 * @param {CustomTmEntry[]=} entries
 * @returns {string}
 */
function createCustomTmFingerprint(entries = []) {
  return crypto.createHash('sha256').update(JSON.stringify((entries || []).map((entry) => ({
    sourceText: entry.sourceText,
    targetText: entry.targetText,
    sourceLang: entry.sourceLang,
    targetLang: entry.targetLang,
    assetId: entry.assetId,
    assetName: entry.assetName
  })))).digest('hex');
}

/**
 * @param {CustomTmEntry} entry
 * @param {unknown} sourceLanguage
 * @param {unknown} targetLanguage
 * @returns {boolean}
 */
function languageMatches(entry, sourceLanguage, targetLanguage) {
  const source = normalizeLanguageKey(sourceLanguage);
  const target = normalizeLanguageKey(targetLanguage);
  const entrySource = normalizeLanguageKey(entry.sourceLang || entry.srcLang);
  const entryTarget = normalizeLanguageKey(entry.targetLang || entry.tgtLang);

  const sourceOk = !entrySource || !source || entrySource === source || getBaseLanguage(entrySource) === getBaseLanguage(source);
  const targetOk = !entryTarget || !target || entryTarget === target || getBaseLanguage(entryTarget) === getBaseLanguage(target);
  return sourceOk && targetOk;
}

/**
 * @typedef {Object} TmMatchSegment
 * @property {unknown=} sourceText
 * @property {unknown=} plainText
 * @property {{ previousSegment?: { sourceText?: unknown }, nextSegment?: { sourceText?: unknown } }=} neighborContext
 */

/**
 * @param {CustomTmEntry=} entry
 * @param {TmMatchSegment=} segment
 * @returns {boolean}
 */
function hasContextMatch(entry = /** @type {CustomTmEntry} */ ({}), segment = /** @type {TmMatchSegment} */ ({})) {
  const context = entry.context && typeof entry.context === 'object' ? entry.context : {};
  const previous = segment?.neighborContext?.previousSegment;
  const next = segment?.neighborContext?.nextSegment;
  const previousSource = normalizeWhitespace(context.previousSource || context.prevSource || context.beforeSource || '');
  const nextSource = normalizeWhitespace(context.nextSource || context.afterSource || '');

  return Boolean(
    previousSource && previous && normalizeWhitespace(previous.sourceText) === previousSource
    || nextSource && next && normalizeWhitespace(next.sourceText) === nextSource
  );
}

/**
 * @typedef {Object} CustomTmEntryScore
 * @property {number} score
 * @property {number} baseScore
 * @property {number} penalty
 * @property {string} bucket
 * @property {number} tokenOverlap
 * @property {boolean} contextMatched
 */

/**
 * @param {TmMatchSegment=} segment
 * @param {(CustomTmEntry & { tokens?: string[] })=} entry
 * @returns {CustomTmEntryScore}
 */
function scoreCustomTmEntry(segment = /** @type {TmMatchSegment} */ ({}), entry = /** @type {CustomTmEntry & { tokens?: string[] }} */ ({})) {
  const sourceText = String(segment.sourceText || segment.plainText || '');
  const sourceTokens = tokenizeForTmMatch(sourceText);
  const entryTokens = entry.tokens || tokenizeForTmMatch(entry.sourceText);
  const baseScore = calculateTokenSimilarity(sourceTokens, entryTokens);
  const penalty = calculatePlaceholderPenalty(sourceText, entry.sourceText);
  const finalScore = Math.max(0, Math.min(100, baseScore - penalty));
  const contextMatched = finalScore === 100 && hasContextMatch(entry, segment);

  return {
    score: contextMatched ? 101 : finalScore,
    baseScore,
    penalty,
    bucket: bucketTmScore(finalScore, contextMatched),
    tokenOverlap: calculateTokenOverlap(sourceTokens, entryTokens),
    contextMatched
  };
}

/**
 * @typedef {Object} CustomTmMatch
 * @property {string} sourceText
 * @property {string} targetText
 * @property {string} sourceLang
 * @property {string} targetLang
 * @property {number} score
 * @property {number} baseScore
 * @property {number} penalty
 * @property {string} bucket
 * @property {string} scoreType
 * @property {string} assetId
 * @property {string} assetName
 * @property {boolean} contextMatched
 */

/**
 * @param {CustomTmMatch[]=} matches
 * @returns {CustomTmMatch[]}
 */
function dedupeCustomTmMatches(matches = []) {
  const seen = new Set();
  const deduped = [];
  for (const match of matches) {
    const key = [
      match.sourceText,
      match.targetText,
      match.sourceLang,
      match.targetLang,
      match.assetId,
      match.assetName
    ].map((value) => String(value || '').toLocaleLowerCase()).join('\u0001');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(match);
  }
  return deduped;
}

/**
 * @typedef {Object} CustomTmMatcher
 * @property {Array<CustomTmEntry & { tokens: string[], tokenSet: Set<string> }>} entries
 * @property {string} fingerprint
 */

/**
 * @param {CustomTmEntryInput[]=} entries
 * @returns {CustomTmMatcher}
 */
function createCustomTmMatcher(entries = []) {
  const normalizedEntries = /** @type {Array<CustomTmEntry & { tokens: string[], tokenSet: Set<string> }>} */ (
    (entries || [])
      .map((entry, index) => normalizeCustomTmEntry(entry, index, {
        id: entry.assetId,
        name: entry.assetName
      }))
      .filter((item) => item !== null)
      .map((entry) => ({
        ...entry,
        tokens: tokenizeForTmMatch(entry.sourceText),
        tokenSet: new Set(tokenizeForTmMatch(entry.sourceText))
      }))
  );

  return {
    entries: normalizedEntries,
    fingerprint: createCustomTmFingerprint(normalizedEntries)
  };
}

/**
 * @typedef {Object} MatchCustomTmOptions
 * @property {CustomTmMatcher=} matcher
 * @property {TmMatchSegment=} segment
 * @property {unknown=} sourceLanguage
 * @property {unknown=} targetLanguage
 * @property {number=} minScore
 * @property {number=} maxMatches
 * @property {number=} candidateLimit
 * @property {unknown=} allowedBuckets
 */

/**
 * @param {MatchCustomTmOptions=} options
 * @returns {CustomTmMatch[]}
 */
function matchCustomTmEntries({
  matcher,
  segment,
  sourceLanguage,
  targetLanguage,
  minScore = DEFAULT_MIN_SCORE,
  maxMatches = DEFAULT_MAX_MATCHES,
  candidateLimit = DEFAULT_CANDIDATE_LIMIT,
  allowedBuckets
} = {}) {
  const entries = Array.isArray(matcher?.entries) ? matcher.entries : [];
  if (!entries.length || !segment) {
    return [];
  }

  const sourceTokens = tokenizeForTmMatch(segment.sourceText || segment.plainText || '');
  const sourceSet = new Set(sourceTokens);
  const candidates = entries
    .filter((entry) => languageMatches(entry, sourceLanguage, targetLanguage))
    .map((entry) => {
      let shared = 0;
      for (const token of sourceSet) {
        if (entry.tokenSet.has(token)) shared += 1;
      }
      const overlap = sourceSet.size ? shared / sourceSet.size : 0;
      const exactNormalized = normalizeWhitespace(entry.sourceText).toLocaleLowerCase()
        === normalizeWhitespace(segment.sourceText || segment.plainText || '').toLocaleLowerCase();
      return { entry, overlap, exactNormalized };
    })
    .filter((candidate) => candidate.exactNormalized || candidate.overlap > 0)
    .sort((left, right) => {
      if (left.exactNormalized !== right.exactNormalized) return left.exactNormalized ? -1 : 1;
      return right.overlap - left.overlap;
    })
    .slice(0, Math.max(1, Number(candidateLimit) || DEFAULT_CANDIDATE_LIMIT));

  const sortedMatches = candidates
    .map(({ entry }) => {
      const scored = scoreCustomTmEntry(segment, entry);
      return {
        sourceText: entry.sourceText,
        targetText: entry.targetText,
        sourceLang: entry.sourceLang,
        targetLang: entry.targetLang,
        score: scored.score,
        baseScore: scored.baseScore,
        penalty: scored.penalty,
        bucket: scored.bucket,
        scoreType: 'AI Hub TM score',
        assetId: entry.assetId,
        assetName: entry.assetName,
        contextMatched: scored.contextMatched === true
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(left.sourceText).localeCompare(String(right.sourceText));
    });

  const selectedBuckets = normalizeCustomTmMatchBuckets(allowedBuckets);
  const selectedBucketSet = new Set(selectedBuckets);
  const useScoreThreshold = !Array.isArray(allowedBuckets);

  return dedupeCustomTmMatches(sortedMatches)
    .filter((match) => (
      selectedBucketSet.has(match.bucket)
      && (!useScoreThreshold || match.score >= minScore)
    ))
    .slice(0, Math.max(1, Number(maxMatches) || DEFAULT_MAX_MATCHES));
}

module.exports = {
  CUSTOM_TM_MATCH_BUCKETS,
  DEFAULT_CUSTOM_TM_MATCH_BUCKETS,
  DEFAULT_MAX_MATCHES,
  DEFAULT_MIN_SCORE,
  bucketTmScore,
  calculatePlaceholderPenalty,
  calculateTokenSimilarity,
  createCustomTmFingerprint,
  createCustomTmMatcher,
  levenshteinDistance,
  matchCustomTmEntries,
  normalizeCustomTmEntry,
  normalizeCustomTmMatchBuckets,
  tokenizeForTmMatch
};
