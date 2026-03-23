const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PREVIEW
} = require('../src/shared/desktopContract');
const {
  createPreviewState,
  mergePreviewParts
} = require('../src/runtime/runtimePreviewStateSupport');

test('runtime preview state support creates disconnected preview state defaults', () => {
  const state = createPreviewState();

  assert.equal(state.status, 'disconnected');
  assert.equal(state.serviceBaseUrl, String(PREVIEW.serviceBaseUrl || '').trim());
  assert.equal(state.activePreviewPartId, '');
  assert.deepEqual(state.activePreviewPartIds, []);
  assert.deepEqual(state.previewPartOrder, []);
  assert.equal(state.previewPartsById.size, 0);
  assert.equal(typeof state.activeSourceDocument, 'object');
});

test('runtime preview state support merges normalized preview parts by id', () => {
  const state = createPreviewState();

  mergePreviewParts(state, [
    {
      PreviewPartId: 'part-1',
      TargetContent: {
        Content: 'First value',
        Complexity: 'medium'
      },
      SourceLangCode: 'en'
    },
    {
      PreviewPartId: 'part-1',
      TargetContent: {
        Content: 'Updated value'
      },
      TargetLangCode: 'fr'
    },
    {
      PreviewPartId: '',
      TargetContent: {
        Content: 'Ignored'
      }
    }
  ]);

  assert.equal(state.previewPartsById.size, 1);
  assert.equal(state.previewPartsById.get('part-1').targetContent.content, 'Updated value');
  assert.equal(state.previewPartsById.get('part-1').sourceLangCode, 'en');
  assert.equal(state.previewPartsById.get('part-1').targetLangCode, 'fr');
});
