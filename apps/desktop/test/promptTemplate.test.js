const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTemplateContext,
  getSupportedPlaceholders,
  renderTemplate,
  validateProfileTemplates,
  validateTemplate
} = require('../src/shared/promptTemplate');

test('prompt template exposes supported placeholders', () => {
  const placeholders = getSupportedPlaceholders();

  assert.ok(placeholders.some((item) => item.token === 'source-text'));
  assert.ok(placeholders.some((item) => item.token === 'summary-text'));
  assert.ok(placeholders.some((item) => item.token === 'glossary-text'));
  assert.ok(placeholders.some((item) => item.token === 'tb-metadata-text'));
  assert.ok(placeholders.some((item) => item.token === 'brief-text'));
  assert.ok(placeholders.some((item) => item.token === 'above-source-text'));
  assert.ok(placeholders.some((item) => item.token === 'above-target-text'));
  assert.ok(placeholders.some((item) => item.token === 'below-source-text'));
  assert.ok(placeholders.some((item) => item.token === 'below-target-text'));
});

test('prompt template renders supported placeholders', () => {
  const result = renderTemplate(
    'Translate {{source-text}} from {{source-language}} to {{target-language}}. {{tb-metadata-text}}',
    createTemplateContext({
      sourceText: 'Hello',
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      tbMetadataText: 'TB language pair: EN -> ZH'
    }),
    { fieldLabel: 'User prompt' }
  );

  assert.equal(result, 'Translate Hello from EN to ZH. TB language pair: EN -> ZH');
});

test('prompt template renders explicit neighbor placeholders and keeps legacy compatibility placeholders', () => {
  const context = createTemplateContext({
    aboveSourceText: 'Previous source',
    belowTargetText: 'Next target',
    aboveText: 'Legacy above',
    belowText: 'Legacy below'
  });

  assert.equal(
    renderTemplate(
      'A={{above-source-text}} B={{below-target-text}}',
      context,
      { fieldLabel: 'User prompt' }
    ),
    'A=Previous source B=Next target'
  );

  assert.equal(
    renderTemplate(
      'Legacy A={{above-text}} Legacy B={{below-text}}',
      context,
      { fieldLabel: 'User prompt' }
    ),
    'Legacy A=Legacy above Legacy B=Legacy below'
  );
});

test('prompt template removes wrappers when the placeholder is empty', () => {
  const result = renderTemplate(
    '[Summary:\n]{{summary-text}}[\nEnd]',
    createTemplateContext({}),
    { fieldLabel: 'User prompt' }
  );

  assert.equal(result, '');
});

test('prompt template fails when a required placeholder is empty', () => {
  assert.throws(
    () => renderTemplate('{{summary-text!}}', createTemplateContext({}), { fieldLabel: 'User prompt' }),
    /requires a value/i
  );
});

test('prompt template rejects malformed placeholder syntax', () => {
  assert.throws(
    () => validateTemplate('Broken {{source-text', { fieldLabel: 'User prompt' }),
    /malformed placeholder syntax/i
  );
});

test('prompt template rejects unsupported placeholders', () => {
  assert.throws(
    () => validateProfileTemplates({ systemPrompt: 'Hi', userPrompt: '{{unknown-placeholder}}' }),
    /unsupported placeholder/i
  );
});
