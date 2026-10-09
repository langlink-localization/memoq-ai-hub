const HISTORY_PROTOCOL = 'memoq-ai-hub';
/** @param {unknown} value */
function isHistoryRequestId(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value); }
/** @param {unknown} value */
function parseHistoryLink(value) {
  if (typeof value !== 'string' || value.length > 512) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== `${HISTORY_PROTOCOL}:` || url.hostname !== 'history' || url.port || url.username || url.password || url.hash || !['', '/'].includes(url.pathname)) return '';
    const entries = [...url.searchParams];
    return entries.length === 1 && entries[0][0] === 'requestId' && isHistoryRequestId(entries[0][1]) ? entries[0][1] : '';
  } catch { return ''; }
}
/** @param {string[]} argv */
function historyRequestFromArgv(argv = []) { return argv.map(parseHistoryLink).find(Boolean) || ''; }
/** @param {any[]} entries @param {unknown} requestId */
function resolveHistoryRequest(entries, requestId) {
  if (!isHistoryRequestId(requestId)) return { status: 'missing' };
  const matches = entries.filter((entry) => entry.requestId === requestId);
  return matches.length === 1 ? { status: 'found', historyId: matches[0].id, requestId } : { status: matches.length ? 'ambiguous' : 'missing' };
}
module.exports = { HISTORY_PROTOCOL, isHistoryRequestId, parseHistoryLink, historyRequestFromArgv, resolveHistoryRequest };
