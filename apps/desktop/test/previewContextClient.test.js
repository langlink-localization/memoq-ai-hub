const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPreviewContextClient, createDocumentCacheFileName } = require('../src/preview/previewContextClient');

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-preview-client-'));
}

function createClient(tempRoot) {
  return createPreviewContextClient({
    appDataRoot: tempRoot,
    helperExecutablePath: path.join(tempRoot, 'missing-helper.exe')
  });
}

function writeDocument(tempRoot, documentId, sourceLanguage, targetLanguage, payload) {
  const documentsDir = path.join(tempRoot, 'preview-helper', 'documents');
  fs.mkdirSync(documentsDir, { recursive: true });

  const filePath = path.join(documentsDir, createDocumentCacheFileName(documentId, sourceLanguage, targetLanguage));
  fs.writeFileSync(filePath, JSON.stringify({
    documentId,
    documentName: 'Guide',
    sourceLanguage,
    targetLanguage,
    ...payload
  }, null, 2));
}

function writeDocumentWithBom(tempRoot, documentId, sourceLanguage, targetLanguage, payload) {
  const documentsDir = path.join(tempRoot, 'preview-helper', 'documents');
  fs.mkdirSync(documentsDir, { recursive: true });

  const filePath = path.join(documentsDir, createDocumentCacheFileName(documentId, sourceLanguage, targetLanguage));
  const json = JSON.stringify({
    documentId,
    documentName: 'Guide',
    sourceLanguage,
    targetLanguage,
    ...payload
  }, null, 2);
  fs.writeFileSync(filePath, `\uFEFF${json}`, 'utf8');
}

test('preview context client prefers active part substring matching over exact text fallback', () => {
  const tempRoot = createTempRoot();

  try {
    const client = createClient(tempRoot);
    writeDocument(tempRoot, 'DOC-1', 'en-us', 'zh-cn', {
      activePreviewPartIds: ['part-a'],
      parts: [
        { previewPartId: 'part-a', sourceText: 'Alpha Second sentence. Omega', targetText: '甲', order: 0 },
        { previewPartId: 'part-b', sourceText: 'Second sentence.', targetText: '乙', order: 1 },
        { previewPartId: 'part-c', sourceText: 'Third sentence.', targetText: '丙', order: 2 }
      ],
      segments: [
        { index: 0, previewPartId: 'part-a', sourceText: 'Alpha Second sentence. Omega', targetText: '甲' },
        { index: 1, previewPartId: 'part-b', sourceText: 'Second sentence.', targetText: '乙' },
        { index: 2, previewPartId: 'part-c', sourceText: 'Third sentence.', targetText: '丙' }
      ]
    });

    const context = client.getContext({
      documentId: 'DOC-1',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      sourceText: 'Second sentence.',
      includeTargetText: true,
      includeFullText: true
    });

    assert.equal(context.available, true);
    assert.equal(context.previewPartId, 'part-a');
    assert.equal(context.previewMatchMode, 'activePartSubstring');
    assert.equal(context.targetText, '甲');
    assert.equal(context.reason, '');
    assert.deepEqual(context.previewAvailableFeatures.sort(), ['fullText', 'targetText']);
    assert.match(context.fullText, /Alpha Second sentence\. Omega/);
    assert.match(context.fullText, /Third sentence\./);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('preview context client prefers focused range over exact text fallback', () => {
  const tempRoot = createTempRoot();

  try {
    const client = createClient(tempRoot);
    writeDocument(tempRoot, 'DOC-1', 'en-us', 'zh-cn', {
      parts: [
        {
          previewPartId: 'part-a',
          sourceText: 'Alpha Beta Gamma',
          targetText: '甲乙丙',
          order: 0,
          sourceFocusedRange: { StartIndex: 6, Length: 4 },
          targetFocusedRange: { StartIndex: 1, Length: 1 }
        },
        { previewPartId: 'part-b', sourceText: 'Beta', targetText: '乙', order: 1 }
      ],
      segments: [
        { index: 0, previewPartId: 'part-a', sourceText: 'Alpha Beta Gamma', targetText: '甲乙丙' },
        { index: 1, previewPartId: 'part-b', sourceText: 'Beta', targetText: '乙' }
      ]
    });

    const context = client.getContext({
      documentId: 'DOC-1',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      sourceText: 'Beta',
      includeTargetText: true,
      includeAboveContext: true,
      includeBelowContext: true,
      aboveOptions: { maxSegments: 1, maxChars: 200, includeSource: true, includeTarget: false },
      belowOptions: { maxSegments: 1, maxChars: 200, includeSource: true, includeTarget: false }
    });

    assert.equal(context.available, true);
    assert.equal(context.previewPartId, 'part-a');
    assert.equal(context.previewMatchMode, 'activeFocusedRange');
    assert.deepEqual(context.sourceFocusedRange, { startIndex: 6, length: 4, endIndex: 9 });
    assert.deepEqual(context.targetFocusedRange, { startIndex: 1, length: 1, endIndex: 1 });
    assert.equal(context.targetText, '甲乙丙');
    assert.equal(context.targetTextSource, 'partTarget');
    assert.equal(context.neighborSource, 'partOrder');
    assert.equal(context.reason, '');
    assert.equal(context.aboveText, '');
    assert.equal(context.belowText, 'Beta');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('preview context client falls back to exact text when no higher-priority match exists', () => {
  const tempRoot = createTempRoot();

  try {
    const client = createClient(tempRoot);
    writeDocument(tempRoot, 'DOC-1', 'en-us', 'zh-cn', {
      parts: [
        { previewPartId: 'part-a', sourceText: 'Alpha sentence.', targetText: '甲', order: 0 },
        { previewPartId: 'part-b', sourceText: 'Beta sentence.', targetText: '乙', order: 1 }
      ],
      segments: [
        { index: 0, previewPartId: 'part-a', sourceText: 'Alpha sentence.', targetText: '甲' },
        { index: 1, previewPartId: 'part-b', sourceText: 'Beta sentence.', targetText: '乙' }
      ]
    });

    const context = client.getContext({
      documentId: 'DOC-1',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      sourceText: 'Beta sentence.',
      includeTargetText: true
    });

    assert.equal(context.available, true);
    assert.equal(context.previewPartId, 'part-b');
    assert.equal(context.previewMatchMode, 'exactTextFallback');
    assert.equal(context.targetText, '乙');
    assert.equal(context.reason, '');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('preview context client uses legacy segment index only after newer matchers fail', () => {
  const tempRoot = createTempRoot();

  try {
    const client = createClient(tempRoot);
    writeDocument(tempRoot, 'DOC-1', 'en-us', 'zh-cn', {
      parts: [
        { previewPartId: 'part-a', sourceText: 'Alpha sentence.', targetText: '甲', order: 0 },
        { previewPartId: 'part-b', sourceText: 'Beta sentence.', targetText: '乙', order: 1 },
        { previewPartId: 'part-c', sourceText: 'Legacy sentence.', targetText: '丙', order: 2 }
      ],
      segments: [
        { index: 5, previewPartId: 'part-a', sourceText: 'Alpha sentence.', targetText: '甲' },
        { index: 6, previewPartId: 'part-b', sourceText: 'Beta sentence.', targetText: '乙' },
        { index: 7, previewPartId: 'part-c', sourceText: 'Legacy sentence.', targetText: '丙' }
      ]
    });

    const context = client.getContext({
      documentId: 'DOC-1',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      segmentIndex: 7,
      sourceText: 'Unrelated text.',
      includeTargetText: true
    });

    assert.equal(context.available, true);
    assert.equal(context.previewPartId, 'part-c');
    assert.equal(context.previewMatchMode, 'legacySegmentIndex');
    assert.equal(context.targetText, '丙');
    assert.equal(context.reason, '');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('preview context client still keeps active-part substring fallback when no focused range is present', () => {
  const tempRoot = createTempRoot();

  try {
    const client = createClient(tempRoot);
    writeDocument(tempRoot, 'DOC-3', 'zh-cn', 'en', {
      activePreviewPartIds: ['part-19'],
      parts: [
        { previewPartId: 'part-19', sourceText: 'A（黑色）：适合全年龄段。', targetText: 'A (black): Suitable for all ages.', order: 0 }
      ]
    });

    const context = client.getContext({
      documentId: 'DOC-3',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      sourceText: '适合全年龄段。',
      includeTargetText: true
    });

    assert.equal(context.available, true);
    assert.equal(context.previewMatchMode, 'activePartSubstring');
    assert.equal(context.reason, '');
    assert.deepEqual(context.activePreviewPartIds, ['part-19']);
    assert.equal(context.hasDocument, true);
    assert.equal(context.hasActivePreviewPart, true);
    assert.equal(context.hasFocusedRange, false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('preview context client keeps neighbor extraction on adjacent parts instead of legacy segment rows', () => {
  const tempRoot = createTempRoot();

  try {
    const client = createClient(tempRoot);
    writeDocument(tempRoot, 'DOC-NEIGHBOR', 'zh-cn', 'en', {
      activePreviewPartIds: ['part-2'],
      parts: [
        { previewPartId: 'part-1', sourceText: '上一句。', targetText: 'Previous sentence.', order: 10 },
        {
          previewPartId: 'part-2',
          sourceText: '当前句子包含较长的正文内容。',
          targetText: '',
          order: 20,
          sourceFocusedRange: { StartIndex: 0, Length: 6 }
        },
        { previewPartId: 'part-3', sourceText: '下一句。', targetText: 'Next sentence.', order: 30 }
      ],
      segments: [
        { index: 1, previewPartId: 'part-x', sourceText: '文档开头说明', targetText: 'Doc intro' },
        { index: 2, previewPartId: 'part-y', sourceText: '另一段说明', targetText: 'Doc note' }
      ]
    });

    const context = client.getContext({
      documentId: 'DOC-NEIGHBOR',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      sourceText: '当前句子',
      includeAboveContext: true,
      includeBelowContext: true,
      aboveOptions: { maxSegments: 1, maxChars: 200, includeSource: true, includeTarget: false },
      belowOptions: { maxSegments: 1, maxChars: 200, includeSource: true, includeTarget: false }
    });

    assert.equal(context.available, true);
    assert.equal(context.previewPartId, 'part-2');
    assert.equal(context.neighborSource, 'partOrder');
    assert.equal(context.aboveText, '上一句。');
    assert.equal(context.belowText, '下一句。');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('preview context client keeps target text empty when active part has no target content', () => {
  const tempRoot = createTempRoot();

  try {
    const client = createClient(tempRoot);
    writeDocument(tempRoot, 'DOC-TARGET', 'zh-cn', 'en', {
      activePreviewPartIds: ['part-9'],
      parts: [
        {
          previewPartId: 'part-9',
          sourceText: '当前句子。',
          targetText: '',
          order: 0,
          sourceFocusedRange: { StartIndex: 0, Length: 5 }
        }
      ],
      segments: [
        { index: 4, previewPartId: 'part-9', sourceText: '当前句子。', targetText: 'Current sentence.' }
      ]
    });

    const context = client.getContext({
      documentId: 'DOC-TARGET',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      sourceText: '当前句子。',
      segmentIndex: 4,
      includeTargetText: true
    });

    assert.equal(context.available, true);
    assert.equal(context.targetText, '');
    assert.equal(context.targetTextSource, 'none');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('preview context client keeps target text empty when legacy matching finds a part without target content', () => {
  const tempRoot = createTempRoot();

  try {
    const client = createClient(tempRoot);
    writeDocument(tempRoot, 'DOC-TARGET-LEGACY', 'zh-cn', 'en', {
      parts: [
        { previewPartId: 'part-9', sourceText: '当前句子。', targetText: '', order: 0 }
      ],
      segments: [
        { index: 4, previewPartId: 'part-9', sourceText: '当前句子。', targetText: 'Current sentence.' }
      ]
    });

    const context = client.getContext({
      documentId: 'DOC-TARGET-LEGACY',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      sourceText: '',
      segmentIndex: 4,
      includeTargetText: true
    });

    assert.equal(context.available, true);
    assert.equal(context.previewMatchMode, 'legacySegmentIndex');
    assert.equal(context.targetText, '');
    assert.equal(context.targetTextSource, 'none');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('preview context client returns debug fields when the document cache is missing', () => {
  const tempRoot = createTempRoot();

  try {
    const client = createClient(tempRoot);
    const context = client.getContext({
      documentId: 'DOC-MISSING',
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      sourceText: 'Anything'
    });

    assert.equal(context.available, false);
    assert.equal(context.previewMatchMode, 'unmatched');
    assert.equal(context.reason, 'document_not_cached');
    assert.deepEqual(context.activePreviewPartIds, []);
    assert.equal(context.sourceFocusedRange, null);
    assert.equal(context.targetFocusedRange, null);
    assert.deepEqual(context.previewAvailableFeatures, []);
    assert.equal(context.hasDocument, false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('preview context client can read document cache files with a UTF-8 BOM', () => {
  const tempRoot = createTempRoot();

  try {
    const client = createClient(tempRoot);
    writeDocumentWithBom(tempRoot, 'DOC-BOM', 'zh-cn', 'en', {
      activePreviewPartIds: ['part-bom'],
      parts: [
        {
          previewPartId: 'part-bom',
          sourceText: '通过遵循CERO的分级规定。',
          targetText: 'By following CERO guidelines.',
          order: 0,
          sourceFocusedRange: { StartIndex: 0, Length: 12 }
        }
      ]
    });

    const context = client.getContext({
      documentId: 'DOC-BOM',
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      sourceText: '通过遵循CERO的分级规定。',
      includeTargetText: true
    });

    assert.equal(context.available, true);
    assert.equal(context.previewPartId, 'part-bom');
    assert.equal(context.targetText, 'By following CERO guidelines.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('preview context client can read helper status files with a UTF-8 BOM', () => {
  const tempRoot = createTempRoot();

  try {
    const helperRoot = path.join(tempRoot, 'preview-helper');
    fs.mkdirSync(helperRoot, { recursive: true });
    const helperExecutablePath = path.join(tempRoot, 'MemoQ.AI.Preview.Helper.exe');
    fs.writeFileSync(helperExecutablePath, '');
    fs.writeFileSync(
      path.join(helperRoot, 'status.json'),
      '\uFEFF' + JSON.stringify({
        connected: true,
        state: 'connected',
        lastConnectedAt: '2026-03-19T00:00:00.000Z',
        lastUpdatedAt: '2026-03-19T00:00:00.000Z',
        previewToolId: 'tool-1'
      }),
      'utf8'
    );

    const client = createPreviewContextClient({
      appDataRoot: tempRoot,
      helperExecutablePath
    });

    const status = client.getStatus();
    assert.equal(status.available, true);
    assert.equal(status.connected, true);
    assert.equal(status.state, 'connected');
    assert.equal(status.previewToolId, 'tool-1');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
