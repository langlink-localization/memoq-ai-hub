'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPreviewState } = require('../src/runtime/runtimePreviewStateSupport');
const { createRuntimePreviewBridge } = require('../src/runtime/runtimePreviewBridge');

function createBridge(status = {}) {
  const previewState = createPreviewState();
  const bridge = createRuntimePreviewBridge({
    previewState,
    previewContextClient: { getStatus: () => status },
    runtimeStartedAt: '2026-10-04T02:00:00.000Z',
    nowIso: () => '2026-10-04T03:00:00.000Z'
  });
  return { previewState, bridge };
}

test('preview bridge treats a stale helper status as memoQ startup', () => {
  const { bridge } = createBridge({
    available: true,
    connected: false,
    state: 'disconnected',
    lastUpdatedAt: '2026-10-04T01:00:00.000Z',
    lastError: 'old error'
  });

  const snapshot = bridge.syncPreviewBridgeStatusFromClient();

  assert.equal(snapshot.status, 'starting');
  assert.equal(snapshot.statusMessage, 'Waiting for memoQ startup.');
  assert.equal(snapshot.lastError, '');
});

test('preview bridge keeps a connected helper connected', () => {
  const { bridge } = createBridge({
    available: true,
    connected: true,
    state: 'connected',
    lastConnectedAt: '2026-10-04T02:30:00.000Z',
    lastUpdatedAt: '2026-10-04T02:30:00.000Z'
  });

  const snapshot = bridge.syncPreviewBridgeStatusFromClient();

  assert.equal(snapshot.status, 'connected');
  assert.equal(snapshot.connectedAt, '2026-10-04T02:30:00.000Z');
});

test('preview bridge reports a missing helper executable', () => {
  const { bridge } = createBridge({
    available: false,
    connected: false,
    state: 'missing',
    lastUpdatedAt: '2026-10-04T02:30:00.000Z'
  });

  const snapshot = bridge.syncPreviewBridgeStatusFromClient();

  assert.equal(snapshot.statusMessage, 'Preview helper executable is not available.');
});

test('preview bridge ingests parts, highlight, and part order into the shared state', () => {
  const { previewState, bridge } = createBridge();
  const part = {
    previewPartId: 'part-1',
    sourceDocument: { documentName: 'Spec.docx' }
  };

  const ingested = bridge.ingestPreviewContentUpdate({ previewParts: [part] });
  assert.equal(ingested.cachedPreviewPartCount, 1);
  assert.equal(previewState.previewPartsById.get('part-1').sourceDocument.documentName, 'Spec.docx');

  const highlighted = bridge.ingestPreviewHighlight({ activePreviewParts: [part] });
  assert.equal(highlighted.activePreviewPartId, 'part-1');
  assert.equal(highlighted.sourceDocumentName, 'Spec.docx');

  const ordered = bridge.ingestPreviewPartIds({ previewPartIds: ['part-1', ' ', 'part-2'] });
  assert.equal(ordered.lastUpdatedAt, '2026-10-04T03:00:00.000Z');
  assert.deepEqual(previewState.previewPartOrder, ['part-1', 'part-2']);
});
