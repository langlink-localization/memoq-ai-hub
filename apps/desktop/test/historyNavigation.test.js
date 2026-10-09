const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHistoryLink, historyRequestFromArgv, resolveHistoryRequest } = require('../src/shared/historyNavigation');

test('history links accept only a bounded exact request locator', () => {
  assert.equal(parseHistoryLink('memoq-ai-hub://history?requestId=req_1'), 'req_1');
  assert.equal(historyRequestFromArgv(['app.exe', '--flag', 'memoq-ai-hub://history?requestId=req_1']), 'req_1');
  for (const value of ['https://history?requestId=req_1', 'memoq-ai-hub://other?requestId=req_1', 'memoq-ai-hub://history/extra?requestId=req_1', 'memoq-ai-hub://user@history?requestId=req_1', 'memoq-ai-hub://history?requestId=a&requestId=b', 'memoq-ai-hub://history?requestId=a&x=1', 'memoq-ai-hub://history?requestId=a#fragment', 'memoq-ai-hub://history?requestId=%0a', `memoq-ai-hub://history?requestId=${'a'.repeat(161)}`]) assert.equal(parseHistoryLink(value), '', value);
});
test('request lookup rejects partial and ambiguous records', () => {
  const entries = [{ id: 'hist1', requestId: 'req1' }];
  assert.deepEqual(resolveHistoryRequest(entries, 'req1'), { status: 'found', historyId: 'hist1', requestId: 'req1' });
  assert.equal(resolveHistoryRequest(entries, 'req').status, 'missing');
  assert.equal(resolveHistoryRequest([...entries, { id: 'hist2', requestId: 'req1' }], 'req1').status, 'ambiguous');
});
