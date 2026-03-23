const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractChatText,
  extractJsonText,
  extractResponseText,
  mapProviderError,
  normalizeRequestType,
  normalizeTranslatedText,
  parseBatchTranslations,
  parseSingleTranslation,
  stripCodeFences
} = require('../src/provider/providerResponseUtils');

test('provider response utils normalizes legacy request types', () => {
  assert.equal(normalizeRequestType('Plaintext'), 'Plaintext');
  assert.equal(normalizeRequestType('Html'), 'OnlyFormatting');
  assert.equal(normalizeRequestType('both-formatting-and-tags'), 'BothFormattingAndTags');
});

test('provider response utils strip code fences and markup for plaintext translations', () => {
  assert.equal(stripCodeFences('```html\n<p>Hello</p>\n```'), '<p>Hello</p>');
  assert.equal(normalizeTranslatedText('```html\n<p>Hello</p>\n```', 'Plaintext'), 'Hello');
});

test('provider response utils maps provider errors into stable codes', () => {
  assert.equal(mapProviderError(new Error('401 unauthorized')).code, 'PROVIDER_AUTH_FAILED');
  assert.equal(mapProviderError(new Error('429 too many requests, retry after 2')).code, 'PROVIDER_RATE_LIMITED');
  assert.equal(mapProviderError(new Error('fetch failed: ENOTFOUND')).code, 'PROVIDER_NETWORK_FAILED');
  assert.equal(mapProviderError(new Error('request timed out')).code, 'PROVIDER_TIMEOUT');
  assert.equal(mapProviderError({ message: '429 too many requests', retryAfterSeconds: 7 }).retryAfterSeconds, 7);
});

test('provider response utils extract response text from output arrays and embedded objects', () => {
  assert.equal(
    extractResponseText({
      output: [{ content: [{ text: 'Hello' }, { text: 'world' }] }]
    }),
    'Hello\nworld'
  );
  assert.equal(
    extractResponseText({
      output: [{ content: [{ refusal: { reason: 'blocked' } }] }]
    }),
    JSON.stringify({ reason: 'blocked' })
  );
});

test('provider response utils extract chat text from string and array content', () => {
  assert.equal(extractChatText({ choices: [{ message: { content: 'Hello' } }] }), 'Hello');
  assert.equal(
    extractChatText({
      choices: [{ message: { content: [{ text: 'Hello' }, { text: 'world' }] } }]
    }),
    'Hello\nworld'
  );
});

test('provider response utils extract json payload from fenced content', () => {
  assert.equal(
    extractJsonText('```json\n{"translations":[{"index":0,"text":"A"}]}\n```'),
    '{"translations":[{"index":0,"text":"A"}]}'
  );
});

test('provider response utils parse single translation from structured payload', () => {
  assert.equal(
    parseSingleTranslation('{"translation":"<b>Hello</b>"}', 'Plaintext'),
    'Hello'
  );
});

test('provider response utils parse batch translations and sort by index', () => {
  assert.deepEqual(
    parseBatchTranslations(
      '{"translations":[{"index":1,"text":"<b>B</b>"},{"index":0,"text":"<b>A</b>"}]}',
      'Plaintext',
      [0, 1]
    ),
    [
      { index: 0, text: 'A' },
      { index: 1, text: 'B' }
    ]
  );
});

test('provider response utils batch parser describes expected formats on invalid input', () => {
  assert.throws(
    () => parseBatchTranslations('not-json', 'Plaintext', [0]),
    /Expected either \[\{"index":0,"text":"\.\.\."\}\] or \{"translations"/
  );
});
