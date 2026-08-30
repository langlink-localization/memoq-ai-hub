const test = require('node:test');
const assert = require('node:assert/strict');

const { validateGatewayPayload } = require('../src/gatewayRequestValidation');

const VALID_TRANSLATE_PAYLOAD = {
  requestId: 'req-1',
  contractVersion: '1',
  sourceLanguage: 'EN',
  targetLanguage: 'FR',
  segments: [{ index: 0, text: 'Hello' }]
};

test('valid translate payloads pass validation', () => {
  assert.equal(validateGatewayPayload('mtTranslate', VALID_TRANSLATE_PAYLOAD), null);
  assert.equal(validateGatewayPayload('mtTranslateAggregate', VALID_TRANSLATE_PAYLOAD), null);
});

test('non-object bodies are rejected on every route', () => {
  assert.match(validateGatewayPayload('mtTranslate', []), /JSON object/);
  assert.match(validateGatewayPayload('mtTranslate', null), /JSON object/);
  assert.match(validateGatewayPayload('mtTranslate', 'text'), /JSON object/);
  assert.match(validateGatewayPayload('qaCheckDocument', 'text'), /JSON object/);
  assert.match(validateGatewayPayload('integrationInstall', [1]), /JSON object/);
});

test('translate payloads require segments and both languages', () => {
  const missingSegments = { ...VALID_TRANSLATE_PAYLOAD };
  delete missingSegments.segments;
  assert.match(validateGatewayPayload('mtTranslate', missingSegments), /segments/);

  const missingLanguages = { ...VALID_TRANSLATE_PAYLOAD, sourceLanguage: '' };
  assert.match(validateGatewayPayload('mtTranslate', missingLanguages), /sourceLanguage/);

  const wrongLanguageType = { ...VALID_TRANSLATE_PAYLOAD, targetLanguage: 42 };
  assert.match(validateGatewayPayload('mtTranslate', wrongLanguageType), /targetLanguage/);
});

test('aggregate result payloads require jobRequestId', () => {
  assert.equal(validateGatewayPayload('mtTranslateAggregateResult', { jobRequestId: 'job-1' }), null);
  assert.match(validateGatewayPayload('mtTranslateAggregateResult', {}), /jobRequestId/);
  assert.match(validateGatewayPayload('mtTranslateAggregateResult', { jobRequestId: '  ' }), /jobRequestId/);
});

test('store translation payloads require languages and translations array', () => {
  const validPayload = {
    sourceLanguage: 'EN',
    targetLanguage: 'FR',
    translations: [{ index: 0, sourceText: 'a', targetText: 'b' }]
  };
  assert.equal(validateGatewayPayload('mtStoreTranslations', validPayload), null);
  assert.match(validateGatewayPayload('mtStoreTranslations', { ...validPayload, translations: 'nope' }), /translations/);
  assert.match(validateGatewayPayload('mtStoreTranslations', { translations: [] }), /sourceLanguage/);
});

test('routes without dedicated validators only require an object body', () => {
  assert.equal(validateGatewayPayload('qaCheckDocument', {}), null);
  assert.equal(validateGatewayPayload('qaCancel', { documentId: 'doc-1' }), null);
  assert.equal(validateGatewayPayload('qaFeedback', { id: 'f-1' }), null);
  assert.equal(validateGatewayPayload('integrationInstall', {}), null);
});
