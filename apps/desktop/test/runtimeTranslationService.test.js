'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSegmentMetadataIndex,
  hasSmartTbParsingCapability,
  selectModel
} = require('../src/runtime/runtimeTranslationService');

test('translation service helpers keep model and metadata selection deterministic', () => {
  const provider = {
    defaultModelId: 'model_default',
    models: [
      { id: 'model_disabled', enabled: false },
      { id: 'model_default', enabled: true },
      { id: 'model_other', enabled: true }
    ]
  };
  const metadata = buildSegmentMetadataIndex([
    { segmentIndex: 2, segmentStatus: 'Confirmed' },
    { segmentIndex: 'invalid', segmentStatus: 'Unknown' }
  ]);

  assert.equal(selectModel(provider).id, 'model_default');
  assert.equal(metadata.get(2).segmentStatus, 'Confirmed');
  assert.equal(metadata.get(-1).segmentStatus, 'Unknown');
});

test('translation service detects smart TB capability only on enabled routes', () => {
  assert.equal(hasSmartTbParsingCapability({
    providers: [{ enabled: false, models: [{ enabled: true }] }]
  }), false);
  assert.equal(hasSmartTbParsingCapability({
    providers: [{ enabled: true, models: [{ enabled: false }, { enabled: true }] }]
  }), true);
});
