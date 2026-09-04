'use strict';

const { QA_CATEGORIES, QA_SEVERITIES, normalizeFinding } = require('./qaContracts');

/** @typedef {Record<string, unknown>} QaFindingInput */

/**
 * @param {unknown} output
 * @returns {Record<string, unknown>}
 */
function parseOutput(output) {
  if (output && typeof output === 'object') return /** @type {Record<string, unknown>} */ (output);
  const text = String(output || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text);
}

/**
 * @param {Record<string, unknown>=} payload
 * @returns {Record<string, unknown>}
 */
function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.findings)) {
    throw new Error('AI QA response must contain a findings array.');
  }
  if (payload.findings.length > 20) throw new Error('AI QA response contains too many findings.');
  payload.findings.forEach((finding) => {
    if (!QA_CATEGORIES.includes(finding?.category)) throw new Error('AI QA response contains an invalid category.');
    if (!QA_SEVERITIES.includes(finding?.severity)) throw new Error('AI QA response contains an invalid severity.');
    if (!String(finding?.title || '').trim() || !String(finding?.message || '').trim()) throw new Error('AI QA finding requires title and message.');
    if (!Number.isFinite(Number(finding?.confidence))) throw new Error('AI QA finding requires numeric confidence.');
  });
  return payload;
}

/**
 * @param {QaFindingInput} finding
 * @returns {Record<string, unknown> | null}
 */
function applyConfidenceThreshold(finding) {
  const confidence = Math.max(0, Math.min(1, Number(finding.confidence) || 0));
  if (confidence < 0.55) return null;
  let severity = finding.severity;
  if ((severity === 'critical' || severity === 'major') && confidence < 0.80) severity = 'info';
  if (severity === 'minor' && confidence < 0.70) severity = 'info';
  if ((severity === 'critical' || severity === 'major')
    && (!String(finding.sourceEvidence || '').trim() || !String(finding.targetEvidence || '').trim())) {
    severity = 'info';
  }
  return { ...finding, severity, confidence, origin: 'ai' };
}

/**
 * @param {any} error
 * @returns {boolean}
 */
function isInvalidQaOutputError(error) {
  if (error instanceof SyntaxError) return true;
  if (String(error?.code || '') === 'QA_INVALID_AI_OUTPUT') return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('ai qa response')
    || message.includes('ai qa finding')
    || message.includes('not valid json')
    || message.includes('unexpected token')
    || message.includes('invalid category')
    || message.includes('invalid severity');
}

/**
 * @param {any} error
 * @param {{ repairAttempted?: unknown, startedAt?: unknown }=} diagnostics
 * @returns {Error}
 */
function attachFailureDiagnostics(error, diagnostics = {}) {
  const failure = /** @type {any} */ (error instanceof Error ? error : new Error(String(error || 'AI QA request failed.')));
  failure.repairAttempted = diagnostics.repairAttempted === true;
  failure.durationMs = Number.isFinite(Number(failure.durationMs))
    ? Number(failure.durationMs)
    : Math.max(0, Date.now() - Number(diagnostics.startedAt || Date.now()));
  return failure;
}

/**
 * @typedef {Object} AiQualityCheckInput
 * @property {((payload: Record<string, unknown>) => Promise<any>)=} invoke
 * @property {any=} snapshot
 * @property {Record<string, unknown>=} context
 */

/**
 * @param {AiQualityCheckInput=} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function runAiQualityCheck({ invoke, snapshot, context = {} } = {}) {
  if (typeof invoke !== 'function') return { findings: [], latencyMs: 0, status: 'disabled', repairAttempted: false };
  const startedAt = Date.now();
  let repairAttempted = false;
  /** @type {any} */
  let response;
  try {
    response = await invoke({ snapshot, ...context, repairInstruction: '' });
    validatePayload(parseOutput(response.output));
  } catch (/** @type {any} */ firstError) {
    if (!isInvalidQaOutputError(firstError)) {
      throw attachFailureDiagnostics(firstError, { repairAttempted: false, startedAt });
    }
    repairAttempted = true;
    try {
      response = await invoke({
        snapshot,
        ...context,
        repairInstruction: 'The previous response was invalid. Return only JSON that exactly matches the supplied schema.'
      });
      validatePayload(parseOutput(response.output));
    } catch (/** @type {any} */ secondError) {
      if (!isInvalidQaOutputError(secondError)) {
        throw attachFailureDiagnostics(secondError, { repairAttempted: true, startedAt });
      }
      const error = /** @type {any} */ (new Error(`AI QA output failed schema validation after one repair attempt: ${secondError.message}`));
      error.code = 'QA_INVALID_AI_OUTPUT';
      error.cause = firstError;
      error.providerId = String(secondError?.providerId || firstError?.providerId || '');
      error.providerName = String(secondError?.providerName || firstError?.providerName || '');
      error.model = String(secondError?.model || firstError?.model || '');
      throw attachFailureDiagnostics(error, { repairAttempted: true, startedAt });
    }
  }
  const payload = validatePayload(parseOutput(response.output));
  /** @type {any[]} */
  const rawFindings = /** @type {any[]} */ (payload.findings);
  const visibleFindings = rawFindings
    .map((finding) => applyConfidenceThreshold(finding))
    .filter(Boolean);
  return {
    findings: visibleFindings.map((finding) => normalizeFinding(/** @type {Record<string, unknown>} */ (finding), snapshot?.revision?.contentHash)),
    latencyMs: Number(response.latencyMs || 0),
    status: 'complete',
    repairAttempted,
    candidateCount: rawFindings.length,
    displayedCount: visibleFindings.length,
    filteredCount: rawFindings.length - visibleFindings.length,
    providerId: String(response.providerId || ''),
    providerName: String(response.providerName || ''),
    model: String(response.model || '')
  };
}

module.exports = { applyConfidenceThreshold, isInvalidQaOutputError, parseOutput, runAiQualityCheck, validatePayload };
