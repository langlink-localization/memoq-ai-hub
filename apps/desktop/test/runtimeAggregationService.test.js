'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRuntimeAggregationService,
  getPayloadCharacterCount,
  getPayloadSegmentCount,
  resolveRuntimeAggregationSettings
} = require('../src/runtime/runtimeAggregationService');
const { CONTRACT_VERSION } = require('../src/shared/desktopContract');

function createMetadataIndex(items = []) {
  return new Map(items.map((item) => [Number(item.segmentIndex), item]));
}

function createHarness(overrides = {}) {
  let id = 0;
  const calls = [];
  const service = createRuntimeAggregationService({
    settings: resolveRuntimeAggregationSettings({
      aggregateQuietWindowMs: 5,
      aggregateDeadlineMs: 30,
      aggregateResultWaitMaxMs: 100,
      aggregateSoftDeadlineMs: 200,
      aggregateHardDeadlineMs: 300,
      ...overrides.settings
    }),
    createId: (prefix) => `${prefix}-${++id}`,
    buildSegmentMetadataIndex: createMetadataIndex,
    runtimeLogger: { info() {} },
    performTranslation: overrides.performTranslation || (async (payload) => {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          success: true,
          providerId: 'provider-1',
          model: 'model-1',
          translations: payload.segments.map((segment) => ({ index: segment.index, text: `T:${segment.text}` }))
        }
      };
    })
  });
  return { service, calls };
}

function request(requestId, index, text) {
  return {
    contractVersion: CONTRACT_VERSION,
    requestId,
    traceId: `trace-${requestId}`,
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    requestType: 'Plaintext',
    profileResolution: { profileId: 'profile-1' },
    metadata: { documentId: 'document-1', segmentLevelMetadata: [{ segmentIndex: index }] },
    segments: [{ index, text }]
  };
}

test('aggregation settings and payload metrics stay deterministic', () => {
  const settings = resolveRuntimeAggregationSettings({
    aggregateMaxBufferedRequests: 0,
    aggregateRescueConcurrency: 99,
    aggregateRescueBatchSize: 0,
    aggregateRescueSingleTimeoutMs: 10
  });
  assert.equal(settings.maxBufferedRequests, 1);
  assert.equal(settings.rescueConcurrency, 4);
  assert.equal(settings.rescueBatchSize, 1);
  assert.equal(settings.rescueSingleTimeoutMs, 1000);
  assert.equal(getPayloadSegmentCount({ segments: [{ text: 'a' }, { text: 'bc' }] }), 2);
  assert.equal(getPayloadCharacterCount({ segments: [{ text: 'a' }, { plainText: 'bc' }] }), 3);
});

test('aggregation service owns grouping and restores original segment indexes', async () => {
  const { service, calls } = createHarness();
  try {
    const first = await service.submit(request('request-1', 5, 'one'));
    const second = await service.submit(request('request-2', 9, 'two'));
    const [firstResult, secondResult] = await Promise.all([
      service.wait({ jobRequestId: first.body.jobRequestId, waitTimeoutMs: 100 }),
      service.wait({ jobRequestId: second.body.jobRequestId, waitTimeoutMs: 100 })
    ]);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].segments.length, 2);
    assert.deepEqual(firstResult.body.translations, [{ index: 5, text: 'T:one' }]);
    assert.deepEqual(secondResult.body.translations, [{ index: 9, text: 'T:two' }]);
  } finally {
    service.dispose();
  }
});

test('aggregation service rejects contract drift and reports duplicate and missing jobs', async () => {
  const { service, calls } = createHarness();
  try {
    const mismatch = await service.submit({ ...request('bad', 0, 'x'), contractVersion: 'old' });
    assert.equal(mismatch.statusCode, 409);
    assert.equal(calls.length, 0);

    const submitted = await service.submit(request('request-1', 0, 'x'));
    const duplicate = await service.submit(request('request-1', 0, 'x'));
    assert.equal(submitted.statusCode, 200);
    assert.equal(duplicate.body.duplicate, true);

    const missing = await service.wait({ jobRequestId: 'missing' });
    assert.equal(missing.statusCode, 404);
  } finally {
    service.dispose();
  }
});
