// memoQ CSV/Excel Term_Info and QTerm term-level fields. Never infer rules from notes.
const MEMOQ_RULE_VERSION = 'memoq-deterministic-v1';
const RULE_HEADERS = new Set(['terminfo', 'termcasesensitivity', 'termprefixmatching', 'termforbidden']);
const CASES = { casesense: 'sensitive', casesensitive: 'sensitive', casepermissive: 'permissive', caseinsense: 'insensitive', caseinsensitive: 'insensitive' };
const MODES = { noprefix: 'exact', exact: 'exact', halfprefix: 'half_prefix', prefix: 'fuzzy', fuzzy: 'fuzzy', custom: 'custom' };
const GRAMMAR = new Set(['masc', 'fem', 'neu', 'sg', 'pl', 'noun', 'verb', 'adj', 'adv', 'posother']);
/** @param {unknown} value */
function headerKey(value) { return String(value || '').toLowerCase().replace(/[\s_-]/g, ''); }
/** @param {Record<string, any>} metadata @param {unknown} [term] */
function parseMemoqTermRules(metadata, term = '') {
  const fields = Object.entries(metadata || {}).filter(([name]) => RULE_HEADERS.has(headerKey(name)));
  if (!fields.length) return null;
  const tokens = fields.flatMap(([, value]) => String(value ?? '').split(';').map((token) => token.trim()).filter(Boolean));
  const cases = new Set(); const modes = new Set(); const unsupported = [];
  let forbidden = false;
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (Object.hasOwn(CASES, key)) cases.add(CASES[/** @type {keyof typeof CASES} */ (key)]);
    else if (Object.hasOwn(MODES, key)) modes.add(MODES[/** @type {keyof typeof MODES} */ (key)]);
    else if (key === 'nonterm') forbidden = true;
    else if (!GRAMMAR.has(key)) unsupported.push(token);
  }
  if (cases.size > 1) unsupported.push('conflicting_case_rules');
  if (modes.size > 1) unsupported.push('conflicting_matching_rules');
  const caseMode = [...cases][0] || 'permissive';
  const matching = [...modes][0] || 'half_prefix';
  if (!['exact', 'half_prefix'].includes(matching)) unsupported.push(matching);
  if (/[|*]/.test(String(term))) unsupported.push('custom_wildcard');
  return { version: MEMOQ_RULE_VERSION, origin: 'memoq', raw: tokens, caseMode, matching, forbidden,
    defaults: { caseMode: cases.size === 0, matching: modes.size === 0 },
    status: unsupported.length ? 'unsupported' : 'supported', unsupported: [...new Set(unsupported)] };
}
/** @param {any[]} columns @param {any[]} cells @param {unknown} term */
function rulesFromColumns(columns = [], cells, term) {
  return parseMemoqTermRules(Object.fromEntries(columns.map((column) => [column.name, cells[column.index] ?? ''])), term);
}
/** @param {unknown} text */
function normalizedRuleText(text) { return String(text || '').normalize('NFKC').replace(/\s+/gu, ' ').trim(); }
/** @param {string} expected @param {string} actual @param {string} mode */
function caseMatches(expected, actual, mode) {
  if (mode === 'sensitive') return expected === actual;
  if (expected.toLowerCase() !== actual.toLowerCase()) return false;
  if (mode !== 'permissive') return true;
  const left = [...expected]; const right = [...actual];
  return left.length === right.length && left.every((char, index) => char === char.toLowerCase() || char === right[index]);
}
// Preserve contiguous CJK lookup while enforcing word edges for alphabetic terms and numbers.
/** @param {string} char */
function wordChar(char) { return /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}\p{M}_-]/u.test(char); }
/** @param {string} char */
function suffixChar(char) { return /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{M}]/u.test(char); }
/** Match at an indexed candidate position on a case-preserving, normalized surface.
 * @param {string} text @param {number} start @param {string} term @param {any} rule
 * @returns {number} Exclusive end, or -1. Shared by source lookup and target QA.
 */
function matchMemoqAt(text, start, term, rule) {
  if (rule?.status !== 'supported') return -1;
  const tokens = normalizedRuleText(term).split(' ');
  if (!tokens[0] || (wordChar(tokens[0][0]) && wordChar(text[start - 1] || ''))) return -1;
  let cursor = start;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const actual = text.slice(cursor, cursor + token.length);
    if (!caseMatches(token, actual, rule.caseMode)) return -1;
    cursor += token.length;
    if (rule.matching === 'half_prefix' && suffixChar(token.at(-1) || '')) {
      const suffixStart = cursor;
      while (cursor < text.length && suffixChar(text[cursor])) cursor += 1;
      if ([...text.slice(suffixStart, cursor)].length > [...token].length) return -1;
    }
    if (wordChar(token.at(-1) || '') && wordChar(text[cursor] || '')) return -1;
    if (index < tokens.length - 1) {
      if (text[cursor] !== ' ') return -1;
      cursor += 1;
    }
  }
  return cursor;
}
/** @param {unknown} text @param {unknown} term @param {any} rule */
function containsMemoqTerm(text, term, rule) {
  const surface = normalizedRuleText(text);
  const needle = normalizedRuleText(term).split(' ')[0].toLowerCase();
  if (!needle) return false;
  // Case folding can change UTF-16 length (for example Turkish dotted I).
  // Search candidates without borrowing offsets from the folded string.
  for (let cursor = 0; cursor < surface.length; cursor += 1) {
    if (matchMemoqAt(surface, cursor, String(term), rule) >= 0) return true;
  }
  return false;
}
/** @param {any} entry */
function hasUnsupportedMemoqRules(entry) {
  return [entry.sourceRules, entry.targetRules].some((rule) => rule?.status === 'unsupported');
}
module.exports = { MEMOQ_RULE_VERSION, parseMemoqTermRules, rulesFromColumns, normalizedRuleText, matchMemoqAt, containsMemoqTerm, hasUnsupportedMemoqRules };
