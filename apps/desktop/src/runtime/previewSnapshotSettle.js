'use strict';

const DEFAULT_SETTLE_MS = 400;
const DEFAULT_MAX_WAITS = 3;

function previewSnapshotSignature(payload) {
  if (!payload || payload.mappingCertain === false) {
    return 'unmapped';
  }
  const segment = payload.segment || {};
  const revision = payload.revision || {};
  return [
    String(payload.document?.id || ''),
    String(payload.document?.name || ''),
    String(revision.previewRevision || ''),
    String(revision.capturedAt || ''),
    String(segment.previewPartId || ''),
    String(segment.segmentIndex || ''),
    String(segment.source || ''),
    String(segment.target || '')
  ].join('|');
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The preview helper fills its document cache asynchronously: switching the
// active segment triggers a content request whose answer lands a moment later.
// Reading while that push is still in flight returns stale segment data, so
// callers wait until consecutive reads agree before trusting the snapshot.
async function settleActivePreviewSnapshot(options = {}) {
  const readActive = typeof options.readActive === 'function' ? options.readActive : (() => null);
  const settleMs = Number.isFinite(Number(options.settleMs)) ? Math.max(0, Number(options.settleMs)) : DEFAULT_SETTLE_MS;
  const maxWaits = Number.isFinite(Number(options.maxWaits))
    ? Math.max(1, Math.floor(Number(options.maxWaits)))
    : DEFAULT_MAX_WAITS;
  const sleep = typeof options.sleep === 'function' ? options.sleep : defaultSleep;

  let current = readActive();
  for (let attempt = 0; attempt < maxWaits; attempt += 1) {
    const signature = previewSnapshotSignature(current);
    await sleep(settleMs);
    const next = readActive();
    if (previewSnapshotSignature(next) === signature) {
      return next;
    }
    current = next;
  }
  return current;
}

module.exports = {
  settleActivePreviewSnapshot,
  previewSnapshotSignature,
  DEFAULT_PREVIEW_SETTLE_MS: DEFAULT_SETTLE_MS,
  DEFAULT_PREVIEW_SETTLE_MAX_WAITS: DEFAULT_MAX_WAITS
};
