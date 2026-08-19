'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeQaService } = require('../src/runtime/runtimeQaService');

function createHarness() {
  const savedResults = [];
  const feedback = [];
  const state = {
    profiles: [],
    providers: [],
    assets: [],
    promptPresets: [],
    defaultProfileId: ''
  };
  const service = createRuntimeQaService({
    persistence: {
      saveQaResult(result) {
        savedResults.push(result);
        return result;
      },
      saveQaFeedback(entry) {
        feedback.push(entry);
        return entry;
      },
      listQaResults() {
        return savedResults;
      }
    },
    loadState: () => state,
    secretStore: { get: async () => '' },
    providerRegistry: {},
    previewContextClient: null,
    parsedAssetCache: new Map(),
    performTranslation: async () => ({ statusCode: 500, body: { success: false } }),
    runtimeLogger: { warn() {} },
    nowIso: () => '2026-08-20T00:00:00.000Z',
    selectModel: () => null,
    hasSmartTbParsingCapability: () => false
  });
  return { service, savedResults, feedback };
}

function segmentPayload(overrides = {}) {
  return {
    document: { id: 'document-1', name: 'Document' },
    languages: { source: 'en', target: 'zh' },
    segment: { source: 'Hello  world', target: '你好 世界', segmentIndex: 0 },
    ...overrides
  };
}

test('QA service owns deterministic segment and document orchestration', async () => {
  const { service, savedResults } = createHarness();
  try {
    const segmentResult = await service.checkSegment(segmentPayload());
    assert.equal(segmentResult.status, 'complete');
    assert.ok(savedResults.length >= 1);

    const documentResult = await service.checkDocument({
      document: { id: 'document-2', name: 'Document 2' },
      languages: { source: 'en', target: 'zh' },
      segments: [
        { source: 'One', target: '一', segmentIndex: 0 },
        { source: 'Two', target: '二', segmentIndex: 1 }
      ]
    });
    assert.equal(documentResult.status, 'complete');
    assert.equal(documentResult.results.length, 2);
    assert.equal(documentResult.summary.total, documentResult.results.flatMap((item) => item.findings).length);
  } finally {
    service.dispose();
  }
});

test('QA service owns feedback, cancellation, and status projection', async () => {
  const { service, feedback } = createHarness();
  try {
    await service.checkSegment(segmentPayload());
    assert.equal(service.getStatus().enabled, true);
    assert.equal(service.cancelAssistant({}).cancelled, 0);
    assert.equal(service.cancel({ paused: true }).paused, true);
    assert.equal(service.getStatus().paused, true);

    const saved = service.saveFeedback({ requestId: 'request-1', findingId: 'finding-1', state: 'accepted' });
    assert.equal(saved.state, 'accepted');
    assert.equal(feedback.length, 1);
  } finally {
    service.dispose();
  }
});

test('QA service rejects document checks without segments', async () => {
  const { service } = createHarness();
  try {
    await assert.rejects(service.checkDocument({ segments: [] }), /at least one segment/i);
  } finally {
    service.dispose();
  }
});
