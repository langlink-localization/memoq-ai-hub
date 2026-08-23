'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hasStructuredMetadata, normalizeMemoQMetadata } = require('../src/shared/memoqMetadataNormalizer');

test('memoQ metadata normalization keeps source and target languages for rule testing', () => {
  assert.deepEqual(normalizeMemoQMetadata({ SourceLanguage: ' EN ', targetLang: 'zh-CN' }), {
    client: '', domain: '', subject: '', projectId: '', documentId: '', projectGuid: '',
    sourceLanguage: 'EN', targetLanguage: 'zh-CN', segmentStatus: '', segmentLevelMetadata: []
  });
  assert.equal(hasStructuredMetadata({ sourceLanguage: 'DE' }), true);
});
