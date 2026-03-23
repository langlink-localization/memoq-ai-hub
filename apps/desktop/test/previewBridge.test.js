const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_PREVIEW_TOOL_DESCRIPTION,
  DEFAULT_PREVIEW_TOOL_NAME,
  PREVIEW_TOOL_CONTRACT,
  buildPreviewRegistrationRequest
} = require('../src/preview/previewBridge');

const helperProgramPath = path.resolve(__dirname, '..\\..\\..\\native\\preview-helper/MemoQ.AI.Preview.Helper/Program.cs');

test('preview bridge registration payload uses the shared minimal preview contract', () => {
  const payload = buildPreviewRegistrationRequest({
    previewToolId: 'tool-123'
  });

  assert.deepEqual(payload, {
    PreviewToolId: 'tool-123',
    PreviewToolName: DEFAULT_PREVIEW_TOOL_NAME,
    PreviewToolDescription: DEFAULT_PREVIEW_TOOL_DESCRIPTION,
    PreviewPartIdRegex: PREVIEW_TOOL_CONTRACT.PreviewPartIdRegex,
    RequiresWebPreviewBaseUrl: PREVIEW_TOOL_CONTRACT.RequiresWebPreviewBaseUrl,
    ContentComplexity: PREVIEW_TOOL_CONTRACT.ContentComplexity,
    RequiredProperties: []
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'AutoStartupCommand'));
});

test('preview bridge registration normalizes blank overrides back to the shared contract defaults', () => {
  const payload = buildPreviewRegistrationRequest({
    previewToolId: 'tool-123',
    previewToolName: '   ',
    previewToolDescription: ''
  });

  assert.equal(payload.PreviewToolName, DEFAULT_PREVIEW_TOOL_NAME);
  assert.equal(payload.PreviewToolDescription, DEFAULT_PREVIEW_TOOL_DESCRIPTION);
  assert.notEqual(payload.RequiredProperties, PREVIEW_TOOL_CONTRACT.RequiredProperties);
  assert.deepEqual(payload.RequiredProperties, []);
});

test('preview helper source keeps the same registration semantics as the bridge contract', () => {
  const source = fs.readFileSync(helperProgramPath, 'utf8');

  assert.match(source, /private const string PreviewToolName = "memoQ AI Hub Preview Helper";/);
  assert.match(source, /private const string PreviewToolDescription = "Provides target-text, above-text, below-text, full-text, and summary support for memoQ AI Hub\.";/
  );
  assert.match(source, /private const string PreviewContentComplexity = "Minimal";/);
  assert.match(source, /\["PreviewPartIdRegex"\] = PreviewPartIdRegex,/);
  assert.match(source, /\["RequiresWebPreviewBaseUrl"\] = false,/);
  assert.match(source, /\["ContentComplexity"\] = PreviewContentComplexity,/);
  assert.match(source, /\["RequiredProperties"\] = new string\[0\]/);
  assert.doesNotMatch(source, /\["AutoStartupCommand"\]/);
});
