function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeSegmentStatus(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (Number.isFinite(Number(value))) {
    return Number(value);
  }

  return normalizeText(value);
}

function normalizeSegmentMetadataItem(item = {}, fallbackIndex = -1) {
  return {
    segmentId: normalizeText(item.segmentId || item.SegmentID || item.segmentID),
    segmentStatus: normalizeSegmentStatus(item.segmentStatus ?? item.SegmentStatus),
    segmentIndex: Number.isFinite(Number(item.segmentIndex ?? item.SegmentIndex))
      ? Number(item.segmentIndex ?? item.SegmentIndex)
      : fallbackIndex
  };
}

function normalizeSegmentLevelMetadata(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => normalizeSegmentMetadataItem(item, index))
    .filter((item) => item.segmentIndex >= 0);
}

function normalizeMemoQMetadata(metadata = {}) {
  const normalized = {
    client: normalizeText(metadata.client || metadata.Client),
    domain: normalizeText(metadata.domain || metadata.Domain),
    subject: normalizeText(metadata.subject || metadata.Subject),
    projectId: normalizeText(metadata.projectId || metadata.ProjectID || metadata.PorjectID),
    documentId: normalizeText(metadata.documentId || metadata.DocumentID),
    projectGuid: normalizeText(metadata.projectGuid || metadata.ProjectGuid),
    segmentStatus: normalizeSegmentStatus(metadata.segmentStatus ?? metadata.SegmentStatus),
    segmentLevelMetadata: normalizeSegmentLevelMetadata(metadata.segmentLevelMetadata || metadata.SegmentLevelMetadata)
  };

  if (normalized.segmentStatus === '' && normalized.segmentLevelMetadata.length === 1) {
    normalized.segmentStatus = normalized.segmentLevelMetadata[0].segmentStatus;
  }

  return normalized;
}

function getProjectMetadataEntries(metadata = {}) {
  const normalized = normalizeMemoQMetadata(metadata);
  return [
    ['Project ID', normalized.projectId],
    ['Client', normalized.client],
    ['Domain', normalized.domain],
    ['Subject', normalized.subject],
    ['Document ID', normalized.documentId],
    ['Project GUID', normalized.projectGuid]
  ].filter(([, value]) => value !== '');
}

function hasStructuredMetadata(metadata = {}) {
  const normalized = normalizeMemoQMetadata(metadata);
  return Boolean(
    normalized.client
    || normalized.domain
    || normalized.subject
    || normalized.projectId
    || normalized.documentId
    || normalized.projectGuid
    || normalized.segmentStatus !== ''
    || normalized.segmentLevelMetadata.length
  );
}

module.exports = {
  getProjectMetadataEntries,
  hasStructuredMetadata,
  normalizeMemoQMetadata,
  normalizeSegmentLevelMetadata,
  normalizeSegmentMetadataItem,
  normalizeSegmentStatus
};
