const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTbMatcher
} = require('../src/asset/assetTerminology');

const {
  buildSegmentTbContext,
  buildTemplatePreflightContext,
  createEmptyAssetContext,
  summarizeAssets,
  validateRuntimePromptTemplates
} = require('../src/runtime/runtimePromptSupport');

test('runtime prompt support creates deterministic empty asset context fingerprints', () => {
  const context = createEmptyAssetContext();

  assert.equal(context.glossaryText, '');
  assert.equal(context.briefText, '');
  assert.equal(context.glossaryFingerprint, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(context.briefFingerprint, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(context.tb.fingerprint, '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
});

test('runtime prompt support summarizes only bound assets', () => {
  const summary = summarizeAssets(
    [
      { id: 'a1', type: 'glossary', name: 'terms.csv' },
      { id: 'a2', type: 'brief', name: 'brief.md' },
      { id: 'a3', type: 'custom_tm', name: 'tm.csv' }
    ],
    [
      { assetId: 'a2' },
      { assetId: 'a1' }
    ]
  );

  assert.deepEqual(summary, ['glossary:terms.csv', 'brief:brief.md']);
});

test('runtime prompt support builds template preflight context using segment tb overrides', () => {
  const context = buildTemplatePreflightContext({
    payload: { sourceLanguage: 'en', targetLanguage: 'fr' },
    profile: { usePreviewContext: true, usePreviewAboveBelow: true, usePreviewSummary: true, usePreviewFullText: true },
    assetContext: { glossaryText: 'global glossary', tbMetadataText: 'global metadata', briefText: 'brief body' },
    previewContext: { summary: 'shared summary', fullText: 'shared full text' },
    segment: {
      sourceText: 'Save',
      tmSource: 'save',
      tmTarget: 'enregistrer',
      previewContext: { above: 'Above', below: 'Below', targetText: 'Target' },
      tbContext: { glossaryText: 'segment glossary', tbMetadataText: 'segment metadata' }
    }
  });

  assert.equal(context['glossary-text'], 'segment glossary');
  assert.equal(context['tb-metadata-text'], 'segment metadata');
  assert.equal(context['brief-text'], 'brief body');
  assert.equal(context['summary-text'], 'shared summary');
  assert.equal(context['full-text'], 'shared full text');
});

test('runtime prompt support validates required placeholders against built context', () => {
  assert.throws(() => validateRuntimePromptTemplates({
    payload: { sourceLanguage: 'en', targetLanguage: 'fr' },
    profile: {
      promptTemplates: {
        single: {
          systemPrompt: '',
          userPrompt: '{{glossary-text!}}'
        }
      }
    },
    assetContext: createEmptyAssetContext(),
    previewContext: {},
    segments: [{ index: 0, sourceText: 'Save' }]
  }), /glossary-text/i);
});

test('runtime prompt support uses batch templates for shared-only preview requests', () => {
  assert.throws(() => validateRuntimePromptTemplates({
    payload: {
      sourceLanguage: 'en',
      targetLanguage: 'fr'
    },
    profile: {
      promptTemplates: {
        single: {
          systemPrompt: '',
          userPrompt: 'single ok'
        },
        batch: {
          systemPrompt: '',
          userPrompt: '{{summary-text!}}'
        }
      }
    },
    assetContext: createEmptyAssetContext(),
    previewContext: {},
    segments: [
      { index: 0, sourceText: 'Save' },
      { index: 1, sourceText: 'Cancel' }
    ]
  }), /summary-text/i);
});

test('runtime prompt support omits disabled tm and preview fields from template context', () => {
  const context = buildTemplatePreflightContext({
    payload: { sourceLanguage: 'en', targetLanguage: 'fr' },
    profile: {
      useBestFuzzyTm: false,
      useCustomTm: false,
      usePreviewContext: false,
      usePreviewAboveBelow: false,
      usePreviewSummary: false,
      usePreviewFullText: false
    },
    assetContext: { glossaryText: 'global glossary', tbMetadataText: 'global metadata', briefText: 'brief body' },
    previewContext: { summary: 'shared summary', fullText: 'shared full text' },
    segment: {
      sourceText: 'Save',
      tmSource: 'save',
      tmTarget: 'enregistrer',
      previewContext: { above: 'Above', below: 'Below', targetText: 'Target' }
    }
  });

  assert.equal(context['tm-source-text'], '');
  assert.equal(context['tm-target-text'], '');
  assert.equal(context['custom-tm-source-text'], '');
  assert.equal(context['custom-tm-target-text'], '');
  assert.equal(context['target-text'], 'Target');
  assert.equal(context['above-text'], '');
  assert.equal(context['below-text'], '');
  assert.equal(context['summary-text'], '');
  assert.equal(context['full-text'], '');
});

test('runtime prompt support builds segment tb context from matcher results', () => {
  const assetContext = {
    tb: {
      matcher: createTbMatcher([{
        sourceTerm: 'Save',
        targetTerm: 'Enregistrer',
        srcLang: 'en',
        tgtLang: 'fr',
        note: 'UI'
      }]),
      languagePair: { source: 'en', target: 'fr' }
    }
  };

  const context = buildSegmentTbContext({
    assetContext,
    segment: { sourceText: 'Save changes now' },
    payload: { sourceLanguage: 'en', targetLanguage: 'fr' },
    metadata: {}
  });

  assert.equal(context.matches.length, 1);
  assert.equal(context.sourcePlainText, 'Save changes now');
  assert.equal(context.termHits.length, 1);
  assert.equal(context.termHits[0].entryId, 'tb-1');
  assert.match(context.glossaryText, /Save/);
  assert.match(context.tbMetadataText, /en -> fr/i);
});
