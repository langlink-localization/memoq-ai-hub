'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimePreviewContextResolver } = require('../src/runtime/runtimePreviewContextResolver');

function createResolver(overrides = {}) {
  return createRuntimePreviewContextResolver({
    providerRegistry: { generateText: async () => ({ text: 'Generated summary' }) },
    secretStore: {
      has: () => true,
      get: async () => 'secret'
    },
    persistence: {
      readDocumentSummaryCache: () => '',
      writeDocumentSummaryCache: () => {}
    },
    previewContextClient: null,
    syncPreviewBridgeStatusFromClient: () => ({}),
    previewContextWaitMs: 0,
    previewContextPollMs: 1,
    nowIso: () => '2026-08-20T00:00:00.000Z',
    ...overrides
  });
}

test('preview context resolver returns an explicit empty result when Preview is unavailable', async () => {
  const resolver = createResolver();
  const result = await resolver.resolve({
    state: {},
    routes: [],
    profile: { usePreviewContext: true, usePreviewFullText: true },
    payload: { sourceLanguage: 'en', targetLanguage: 'de' },
    normalizedMetadata: { documentId: 'document-1' },
    incomingSegments: []
  });

  assert.equal(result.requestPreviewContext, null);
  assert.deepEqual(result.segmentPreviewContexts, new Map());
  assert.deepEqual(result.previewPolicy.previewAvailableFeatures, ['fullText']);
});

test('preview context resolver owns shared context and summary-cache lookup', async () => {
  let generated = false;
  let cacheWrites = 0;
  const resolver = createResolver({
    providerRegistry: {
      generateText: async () => {
        generated = true;
        return { text: 'Generated summary' };
      }
    },
    persistence: {
      readDocumentSummaryCache: () => 'Cached summary',
      writeDocumentSummaryCache: () => {
        cacheWrites += 1;
      }
    },
    previewContextClient: {
      getStatus: () => ({ state: 'connected', connected: true }),
      getContext: () => ({
        available: true,
        documentId: 'document-1',
        documentName: 'Guide',
        importPath: 'guide.docx',
        fullText: 'A long document body.'
      })
    }
  });

  const result = await resolver.resolve({
    state: {},
    routes: [{
      provider: { id: 'provider-1', name: 'Provider', secretRef: 'secret-ref' },
      model: { modelName: 'model-1' }
    }],
    profile: {
      usePreviewContext: true,
      usePreviewFullText: true,
      usePreviewSummary: true
    },
    payload: { sourceLanguage: 'en', targetLanguage: 'de' },
    normalizedMetadata: { documentId: 'document-1' },
    incomingSegments: []
  });

  assert.deepEqual(result.requestPreviewContext, {
    documentId: 'document-1',
    documentName: 'Guide',
    importPath: 'guide.docx',
    fullText: 'A long document body.',
    summary: 'Cached summary'
  });
  assert.equal(result.requestPreviewDebug.summary.cacheHit, true);
  assert.equal(generated, false);
  assert.equal(cacheWrites, 0);
});
