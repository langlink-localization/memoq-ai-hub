const {
  PREVIEW
} = require('../shared/desktopContract');
const {
  mergePreviewPart,
  normalizePreviewPart,
  normalizeSourceDocument
} = require('../preview/previewContext');

function createPreviewState() {
  return {
    status: 'disconnected',
    statusMessage: '',
    serviceBaseUrl: String(PREVIEW.serviceBaseUrl || '').trim(),
    sessionId: '',
    callbackAddress: '',
    connectedAt: '',
    lastUpdatedAt: '',
    lastError: '',
    activePreviewPartId: '',
    activePreviewPartIds: [],
    activeSourceDocument: normalizeSourceDocument(),
    previewPartOrder: [],
    previewPartsById: new Map()
  };
}

function mergePreviewParts(previewState, parts = []) {
  for (const item of Array.isArray(parts) ? parts : []) {
    const normalized = normalizePreviewPart(item);
    if (!normalized.previewPartId) {
      continue;
    }

    previewState.previewPartsById.set(
      normalized.previewPartId,
      mergePreviewPart(previewState.previewPartsById.get(normalized.previewPartId), normalized)
    );
  }
}

module.exports = {
  createPreviewState,
  mergePreviewParts
};
