const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateRequestEligibility,
  createAdaptiveTranslationCacheKey,
  createTranslationCacheKey,
  createDocumentSummaryCacheKey,
  writeTranslationCache,
  readTranslationCache,
  writeDocumentSummaryCache,
  readDocumentSummaryCache,
  writePromptResponseCache,
  readPromptResponseCache,
  truncateSummarySourceText
} = require('../src/runtime/runtimeTranslationSupport');

test('runtimeTranslationSupport rejects shared-only requests with interactive preview placeholders', () => {
  const result = validateRequestEligibility({
    payload: {
      profileResolution: { useCase: 'pretranslate' },
      segments: [{ index: 0, text: 'Hello' }]
    },
    profile: {
      promptTemplates: {
        batch: {
          systemPrompt: 'Batch system',
          userPrompt: '{{above-source-text!}}'
        }
      }
    },
    incomingSegments: [{ index: 0, sourceText: 'Hello' }, { index: 1, sourceText: 'World' }],
    interactiveOnlyTokens: new Set(['above-source-text'])
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'REQUEST_NOT_ELIGIBLE');
  assert.match(result.message, /interactive-only preview placeholders/i);
});

test('runtimeTranslationSupport writes and reads bounded translation and prompt caches', () => {
  const timestamps = ['2026-03-21T00:00:00.000Z', '2026-03-21T00:00:01.000Z', '2026-03-21T00:00:02.000Z'];
  let index = 0;
  const now = () => timestamps[index++];
  const state = {
    translationCache: [],
    documentSummaryCache: [],
    promptResponseCache: []
  };

  writeTranslationCache(state, 'k1', 't1', now);
  writeDocumentSummaryCache(state, 'k2', 'summary', now);
  writePromptResponseCache(state, 'k3', 'prompt', now);

  assert.equal(readTranslationCache(state, 'k1'), 't1');
  assert.equal(readDocumentSummaryCache(state, 'k2'), 'summary');
  assert.equal(readPromptResponseCache(state, 'k3'), 'prompt');
  assert.equal(state.translationCache[0].updatedAt, '2026-03-21T00:00:00.000Z');
  assert.equal(state.documentSummaryCache[0].updatedAt, '2026-03-21T00:00:01.000Z');
  assert.equal(state.promptResponseCache[0].updatedAt, '2026-03-21T00:00:02.000Z');
});

test('runtimeTranslationSupport generates stable cache keys for equivalent payloads', () => {
  const sharedInput = {
    providerId: 'provider-1',
    modelName: 'gpt-4.1-mini',
    sourceLanguage: 'EN',
    targetLanguage: 'ZH',
    requestType: 'Plaintext',
    sourceText: 'Save',
    tmSource: '',
    tmTarget: '',
    metadata: { client: 'A', segmentLevelMetadata: [{ segmentIndex: 0, segmentId: 'seg-1' }] },
    segmentMetadata: { segmentIndex: 0, segmentId: 'seg-1' },
    profile: { systemPrompt: 's', userPrompt: 'u', assetSelections: {} },
    assetContext: { glossaryFingerprint: 'g', briefFingerprint: 'b' },
    tbFingerprint: 'tb',
    previewContext: { summary: 'sum' },
    segmentPreviewContext: { aboveSourceText: 'prev' }
  };

  assert.equal(createTranslationCacheKey(sharedInput), createTranslationCacheKey(sharedInput));
  assert.equal(
    createAdaptiveTranslationCacheKey({
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      sourceText: 'Save'
    }),
    createAdaptiveTranslationCacheKey({
      sourceLanguage: 'EN',
      targetLanguage: 'ZH',
      requestType: 'Plaintext',
      sourceText: 'Save'
    })
  );
});

test('runtimeTranslationSupport truncates summary source text before cache-key hashing', () => {
  const longText = 'A'.repeat(20050);
  const first = createDocumentSummaryCacheKey({
    providerId: 'provider-1',
    modelName: 'gpt-4.1-mini',
    documentId: 'doc-1',
    sourceLanguage: 'EN',
    targetLanguage: 'ZH',
    fullText: longText
  });
  const second = createDocumentSummaryCacheKey({
    providerId: 'provider-1',
    modelName: 'gpt-4.1-mini',
    documentId: 'doc-1',
    sourceLanguage: 'EN',
    targetLanguage: 'ZH',
    fullText: `${'A'.repeat(18000)}${'B'.repeat(500)}`
  });

  assert.match(truncateSummarySourceText(longText), /\[Truncated for preview-context summary generation\]$/);
  assert.equal(first, second);
});
