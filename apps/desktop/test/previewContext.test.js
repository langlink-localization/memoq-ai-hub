const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPreviewContextBundle } = require('../src/preview/previewContext');

function createPreviewState() {
  const partA = {
    previewPartId: 'part-a',
    sourceDocument: { documentGuid: 'doc-1', documentName: 'Guide' },
    sourceLangCode: 'EN',
    targetLangCode: 'ZH',
    sourceContent: { content: 'First sentence.' },
    targetContent: { content: '第一句。' }
  };
  const partB = {
    previewPartId: 'part-b',
    sourceDocument: { documentGuid: 'doc-1', documentName: 'Guide' },
    sourceLangCode: 'EN',
    targetLangCode: 'ZH',
    sourceContent: { content: 'Second sentence.' },
    targetContent: { content: '第二句。' },
    sourceFocusedRange: { startIndex: 0, length: 6 },
    targetFocusedRange: { startIndex: 0, length: 3 }
  };
  const partC = {
    previewPartId: 'part-c',
    sourceDocument: { documentGuid: 'doc-1', documentName: 'Guide' },
    sourceLangCode: 'EN',
    targetLangCode: 'ZH',
    sourceContent: { content: 'Third sentence.' },
    targetContent: { content: '第三句。' }
  };

  return {
    activePreviewPartIds: ['part-b'],
    previewPartOrder: ['part-a', 'part-b', 'part-c'],
    previewPartsById: new Map([
      ['part-a', partA],
      ['part-b', partB],
      ['part-c', partC]
    ])
  };
}

test('buildPreviewContextBundle derives full text, summary, and neighbors from active preview parts', () => {
  const bundle = buildPreviewContextBundle(createPreviewState(), [
    {
      index: 0,
      sourceText: 'Second sentence.',
      plainText: 'Second sentence.'
    }
  ], {
    sourceLanguage: 'EN',
    targetLanguage: 'ZH'
  });

  assert.equal(bundle.available, true);
  assert.equal(bundle.shared.activePreviewPartId, 'part-b');
  assert.match(bundle.shared.fullText, /First sentence\./);
  assert.match(bundle.shared.fullText, /Third sentence\./);
  assert.match(bundle.shared.summary, /Current source: Second sentence\./);

  const segmentContext = bundle.segments.get(0);
  assert.equal(segmentContext.previewPartId, 'part-b');
  assert.equal(segmentContext.targetText, '第二句。');
  assert.equal(segmentContext.above, 'First sentence.');
  assert.equal(segmentContext.below, 'Third sentence.');
});
