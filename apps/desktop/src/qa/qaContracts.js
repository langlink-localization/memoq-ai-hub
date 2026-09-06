'use strict';

const crypto = require('crypto');

const QA_CATEGORIES = Object.freeze([
  'accuracy',
  'completeness',
  'terminology',
  'fluency',
  'style',
  'locale-convention',
  'formatting',
  'other'
]);
const QA_SEVERITIES = Object.freeze(['critical', 'major', 'minor', 'info']);
const QA_FEEDBACK_STATES = Object.freeze(['accepted', 'false-positive', 'fixed', 'ignored', 'rule-disabled']);

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const record = /** @type {Record<string, unknown>} */ (value);
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

/**
 * @param {Record<string, unknown>=} context
 * @param {Record<string, unknown>=} policy
 */
function normalizeContext(context = {}, policy = {}) {
  const maxAdjacentCharacters = Math.max(0, Math.min(4000, Number(policy.maxAdjacentCharacters) || 1200));
  return {
    above: String(context.above || '').slice(-maxAdjacentCharacters),
    below: String(context.below || '').slice(0, maxAdjacentCharacters),
    summary: policy.includeSummary === true ? String(context.summary || '').slice(0, 8000) : '',
    fullText: policy.includeFullText === true ? String(context.fullText || '').slice(0, 50000) : ''
  };
}

/**
 * @typedef {Object} QaSnapshotPayload
 * @property {Record<string, unknown>=} segment
 * @property {Record<string, unknown>=} document
 * @property {Record<string, unknown>=} configuration
 * @property {Record<string, unknown>=} contextPolicy
 * @property {Record<string, unknown>=} context
 * @property {{ source?: unknown, target?: unknown }=} languages
 * @property {{ previewRevision?: unknown, capturedAt?: unknown }=} revision
 * @property {unknown=} source
 * @property {unknown=} target
 * @property {unknown=} sourceLanguage
 * @property {unknown=} targetLanguage
 * @property {unknown=} documentId
 * @property {unknown=} documentName
 * @property {unknown=} profileId
 * @property {unknown=} requestId
 * @property {unknown=} trigger
 * @property {boolean=} mappingCertain
 */

/**
 * @typedef {Object} QaSnapshot
 * @property {string} requestId
 * @property {string} trigger
 * @property {{ id: string, name: string }} document
 * @property {{ previewPartId: string, segmentIndex: number, source: string, target: string, sourceFocusedRange: unknown, targetFocusedRange: unknown }} segment
 * @property {{ source: string, target: string }} languages
 * @property {{ above: string, below: string, summary: string, fullText: string }} context
 * @property {{ includeSummary: boolean, includeFullText: boolean, maxAdjacentCharacters: number }} contextPolicy
 * @property {{ profileId: string, ruleSetVersion: string, glossaryFingerprint: string, tmFingerprint: string, promptVersion: string }} configuration
 * @property {{ previewRevision: number, capturedAt: string, contentHash: string }} revision
 */

/**
 * @param {QaSnapshotPayload=} payload
 * @returns {QaSnapshot}
 */
function createQaSnapshot(payload = {}) {
  const segment = /** @type {Record<string, unknown>} */ (payload.segment && typeof payload.segment === 'object' ? payload.segment : {});
  const document = /** @type {Record<string, unknown>} */ (payload.document && typeof payload.document === 'object' ? payload.document : {});
  const configuration = /** @type {Record<string, unknown>} */ (payload.configuration && typeof payload.configuration === 'object' ? payload.configuration : {});
  const contextPolicy = /** @type {Record<string, unknown>} */ (payload.contextPolicy && typeof payload.contextPolicy === 'object' ? payload.contextPolicy : {});
  const source = String(segment.source ?? payload.source ?? '');
  const target = String(segment.target ?? payload.target ?? '');
  const documentId = String(document.id || payload.documentId || 'imported-document').trim();
  if (!documentId || !source.trim()) {
    const error = /** @type {any} */ (new Error('QA snapshot requires a document id and source text.'));
    error.code = 'QA_INVALID_REQUEST';
    throw error;
  }
  if (payload.mappingCertain === false) {
    const error = /** @type {any} */ (new Error('The active memoQ segment could not be mapped with confidence.'));
    error.code = 'QA_MAPPING_UNCERTAIN';
    throw error;
  }
  const snapshot = {
    requestId: String(payload.requestId || crypto.randomUUID()),
    trigger: String(payload.trigger || 'manual'),
    document: { id: documentId, name: String(document.name || payload.documentName || '') },
    segment: {
      previewPartId: String(segment.previewPartId || ''),
      segmentIndex: Number.isFinite(Number(segment.segmentIndex)) ? Number(segment.segmentIndex) : 0,
      source,
      target,
      sourceFocusedRange: segment.sourceFocusedRange || null,
      targetFocusedRange: segment.targetFocusedRange || null
    },
    languages: {
      source: String(payload.languages?.source || payload.sourceLanguage || ''),
      target: String(payload.languages?.target || payload.targetLanguage || '')
    },
    context: normalizeContext(payload.context || {}, contextPolicy),
    contextPolicy: {
      includeSummary: contextPolicy.includeSummary === true,
      includeFullText: contextPolicy.includeFullText === true,
      maxAdjacentCharacters: Math.max(0, Math.min(4000, Number(contextPolicy.maxAdjacentCharacters) || 1200))
    },
    configuration: {
      profileId: String(configuration.profileId || payload.profileId || ''),
      ruleSetVersion: String(configuration.ruleSetVersion || ''),
      glossaryFingerprint: String(configuration.glossaryFingerprint || ''),
      tmFingerprint: String(configuration.tmFingerprint || ''),
      promptVersion: String(configuration.promptVersion || '')
    },
    revision: {
      previewRevision: Number.isFinite(Number(payload.revision?.previewRevision)) ? Number(payload.revision?.previewRevision) : 0,
      capturedAt: String(payload.revision?.capturedAt || new Date().toISOString())
    }
  };
  (/** @type {Record<string, any>} */ (snapshot)).revision.contentHash = sha256(stableSerialize({
    document: { id: snapshot.document.id },
    segment: {
      previewPartId: snapshot.segment.previewPartId,
      source: snapshot.segment.source,
      target: snapshot.segment.target
    },
    languages: snapshot.languages,
    context: snapshot.context,
    contextPolicy: snapshot.contextPolicy,
    configuration: snapshot.configuration
  }));
  return /** @type {QaSnapshot} */ (deepFreeze(snapshot));
}

/**
 * @param {Record<string, unknown>=} finding
 * @param {string=} contentHash
 */
function normalizeFinding(finding = {}, contentHash = '') {
  const category = QA_CATEGORIES.includes(/** @type {any} */ (finding.category)) ? /** @type {string} */ (finding.category) : 'other';
  const severity = QA_SEVERITIES.includes(/** @type {any} */ (finding.severity)) ? /** @type {string} */ (finding.severity) : 'info';
  const confidence = Math.max(0, Math.min(1, Number(finding.confidence) || 0));
  const targetRange = /** @type {Record<string, unknown> | undefined} */ (finding.targetRange);
  const normalized = {
    id: String(finding.id || ''),
    category,
    severity,
    title: String(finding.title || '').slice(0, 160),
    message: String(finding.message || '').slice(0, 1200),
    sourceEvidence: String(finding.sourceEvidence || '').slice(0, 500),
    targetEvidence: String(finding.targetEvidence || '').slice(0, 500),
    targetRange: targetRange && Number.isFinite(Number(targetRange.start))
      ? { start: Number(targetRange.start), length: Math.max(0, Number(targetRange.length) || 0) }
      : null,
    suggestedTranslation: String(finding.suggestedTranslation || '').slice(0, 4000),
    ruleId: String(finding.ruleId || ''),
    termId: String(finding.termId || ''),
    confidence,
    origin: finding.origin === 'ai' ? 'ai' : 'deterministic',
    dismissible: finding.dismissible !== false
  };
  normalized.id = normalized.id || sha256(stableSerialize({
    contentHash,
    category,
    severity,
    ruleId: normalized.ruleId,
    sourceEvidence: normalized.sourceEvidence,
    targetRange: normalized.targetRange,
    message: normalized.message
  })).slice(0, 24);
  return normalized;
}

module.exports = {
  QA_CATEGORIES,
  QA_FEEDBACK_STATES,
  QA_SEVERITIES,
  createQaSnapshot,
  normalizeFinding,
  sha256,
  stableSerialize
};
