'use strict';

const { PREVIEW } = require('../shared/desktopContract');
const {
  buildPreviewStatusSnapshot,
  normalizePreviewPart,
  normalizeSourceDocument
} = require('../preview/previewContext');
const { parseTimeMs } = require('./runtimeHistory');
const { looksLikePreviewStartupTimeout } = require('./runtimePreviewPolicy');
const { mergePreviewParts } = require('./runtimePreviewStateSupport');

// Mutates the composition root's shared previewState. Translation and the
// app-state read model observe that same object; this owner does not copy it.
/**
 * @param {{
 *   previewState: Record<string, any>,
 *   previewContextClient?: { getStatus?: () => any } | null,
 *   runtimeStartedAt?: string,
 *   nowIso: () => string
 * }} dependencies
 */
function createRuntimePreviewBridge({
  previewState,
  previewContextClient,
  runtimeStartedAt,
  nowIso
}) {
  /**
   * @param {Record<string, any>=} statusPatch
   */
  function updatePreviewBridgeStatus(statusPatch = {}) {
    if (typeof statusPatch !== 'object' || !statusPatch) {
      return buildPreviewStatusSnapshot(previewState);
    }

    previewState.status = String(statusPatch.status || previewState.status || 'disconnected').trim() || 'disconnected';
    previewState.statusMessage = String(statusPatch.statusMessage || previewState.statusMessage || '').trim();
    previewState.serviceBaseUrl = String(statusPatch.serviceBaseUrl || previewState.serviceBaseUrl || PREVIEW.serviceBaseUrl || '').trim();
    previewState.sessionId = String(statusPatch.sessionId || previewState.sessionId || '').trim();
    previewState.callbackAddress = String(statusPatch.callbackAddress || previewState.callbackAddress || '').trim();
    previewState.connectedAt = String(statusPatch.connectedAt || previewState.connectedAt || '').trim();
    previewState.lastUpdatedAt = String(statusPatch.lastUpdatedAt || nowIso()).trim();
    previewState.lastError = String(statusPatch.lastError || '').trim();
    return buildPreviewStatusSnapshot(previewState);
  }

  /**
   * @param {Record<string, any>=} payload
   */
  function ingestPreviewContentUpdate(payload = {}) {
    const previewParts = payload.PreviewParts || payload.previewParts || [];
    mergePreviewParts(previewState, previewParts);
    previewState.lastUpdatedAt = nowIso();
    return buildPreviewStatusSnapshot(previewState);
  }

  /**
   * @param {Record<string, any>=} payload
   */
  function ingestPreviewHighlight(payload = {}) {
    const activePreviewParts = payload.ActivePreviewParts || payload.activePreviewParts || [];
    mergePreviewParts(previewState, activePreviewParts);
    previewState.activePreviewPartIds = activePreviewParts
      .map((/** @type {any} */ item) => normalizePreviewPart(item).previewPartId)
      .filter(Boolean);
    previewState.activePreviewPartId = previewState.activePreviewPartIds[0] || '';
    const firstActivePart = previewState.activePreviewPartId ? previewState.previewPartsById.get(previewState.activePreviewPartId) : null;
    previewState.activeSourceDocument = firstActivePart?.sourceDocument || normalizeSourceDocument();
    previewState.lastUpdatedAt = nowIso();
    return buildPreviewStatusSnapshot(previewState);
  }

  /**
   * @param {Record<string, any>=} payload
   */
  function ingestPreviewPartIds(payload = {}) {
    const previewPartIds = Array.isArray(payload.PreviewPartIds || payload.previewPartIds)
      ? (payload.PreviewPartIds || payload.previewPartIds)
      : [];
    previewState.previewPartOrder = previewPartIds.map((/** @type {any} */ item) => String(item || '').trim()).filter(Boolean);
    previewState.lastUpdatedAt = nowIso();
    return buildPreviewStatusSnapshot(previewState);
  }

  function syncPreviewBridgeStatusFromClient() {
    const status = previewContextClient?.getStatus?.() || {};
    const runtimeStartedMs = parseTimeMs(runtimeStartedAt) ?? Number.NaN;
    const statusUpdatedAtMs = parseTimeMs(status.lastUpdatedAt) ?? Number.NaN;
    const normalizedStatus = String(status.state || status.status || 'disconnected').trim().toLowerCase() || 'disconnected';
    const staleStatus = !Number.isFinite(statusUpdatedAtMs)
      || (Number.isFinite(runtimeStartedMs) && Number(statusUpdatedAtMs) < Number(runtimeStartedMs));
    const timeoutRetryState = looksLikePreviewStartupTimeout(status, normalizedStatus);
    const shouldTreatAsStarting = status.available !== false
      && status.connected !== true
      && (staleStatus || timeoutRetryState);

    return updatePreviewBridgeStatus({
      status: status.connected ? 'connected' : (shouldTreatAsStarting ? 'starting' : normalizedStatus),
      statusMessage: status.available === false
        ? 'Preview helper executable is not available.'
        : (shouldTreatAsStarting ? 'Waiting for memoQ startup.' : ''),
      connectedAt: status.lastConnectedAt || '',
      lastUpdatedAt: status.lastUpdatedAt || nowIso(),
      lastError: shouldTreatAsStarting ? '' : (status.lastError || '')
    });
  }

  return {
    updatePreviewBridgeStatus,
    ingestPreviewContentUpdate,
    ingestPreviewHighlight,
    ingestPreviewPartIds,
    syncPreviewBridgeStatusFromClient
  };
}

module.exports = {
  createRuntimePreviewBridge
};
