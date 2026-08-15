'use strict';

const { QA_CATEGORIES, QA_SEVERITIES, normalizeFinding } = require('./qaContracts');

function parseOutput(output) {
  if (output && typeof output === 'object') return output;
  const text = String(output || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text);
}

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

async function runAiQualityCheck({ invoke, snapshot, context = {} } = {}) {
  if (typeof invoke !== 'function') return { findings: [], latencyMs: 0, status: 'disabled', repairAttempted: false };
  let repairAttempted = false;
  let response;
  try {
    response = await invoke({ snapshot, ...context, repairInstruction: '' });
    validatePayload(parseOutput(response.output));
  } catch (firstError) {
    repairAttempted = true;
    try {
      response = await invoke({
        snapshot,
        ...context,
        repairInstruction: 'The previous response was invalid. Return only JSON that exactly matches the supplied schema.'
      });
      validatePayload(parseOutput(response.output));
    } catch (secondError) {
      const error = new Error(`AI QA output failed schema validation after one repair attempt: ${secondError.message}`);
      error.code = 'QA_INVALID_AI_OUTPUT';
      error.cause = firstError;
      throw error;
    }
  }
  const payload = validatePayload(parseOutput(response.output));
  const visibleFindings = payload.findings
    .map(applyConfidenceThreshold)
    .filter(Boolean);
  return {
    findings: visibleFindings.map((finding) => normalizeFinding(finding, snapshot.revision.contentHash)),
    latencyMs: Number(response.latencyMs || 0),
    status: 'complete',
    repairAttempted,
    candidateCount: payload.findings.length,
    displayedCount: visibleFindings.length,
    filteredCount: payload.findings.length - visibleFindings.length,
    providerId: String(response.providerId || ''),
    model: String(response.model || '')
  };
}

module.exports = { applyConfidenceThreshold, parseOutput, runAiQualityCheck, validatePayload };
