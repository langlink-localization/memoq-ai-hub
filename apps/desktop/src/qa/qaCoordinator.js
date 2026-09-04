'use strict';

const crypto = require('crypto');
const { createQaSnapshot, QA_FEEDBACK_STATES, sha256 } = require('./qaContracts');
const { runDeterministicChecks } = require('./deterministicRules');
const { runAiQualityCheck } = require('./aiQualityChecker');

const QA_CHECKER_VERSION = 'qa-v1';

/** @typedef {Record<string, any>} QaFinding */

/**
 * @param {QaFinding[]=} findings
 * @returns {{ counts: Record<string, number>, total: number }}
 */
function createSummary(findings = []) {
  /** @type {Record<string, number>} */
  const counts = { critical: 0, major: 0, minor: 0, info: 0 };
  findings.forEach((finding) => {
    const key = String(finding.severity);
    counts[key] = Number(counts[key] || 0) + 1;
  });
  return { counts, total: findings.length };
}

/**
 * @param {QaFinding[]=} deterministic
 * @param {QaFinding[]=} ai
 * @returns {QaFinding[]}
 */
function mergeFindings(deterministic = [], ai = []) {
  /** @type {Map<string, QaFinding>} */
  const selected = new Map();
  for (const finding of [...deterministic, ...ai]) {
    const key = [finding.category, finding.ruleId, finding.sourceEvidence, finding.targetRange?.start ?? ''].join('|');
    const current = selected.get(key);
    if (!current || (finding.origin === 'deterministic' && current.origin !== 'deterministic')) selected.set(key, finding);
  }
  /** @type {Record<string, number>} */
  const severityRank = { critical: 0, major: 1, minor: 2, info: 3 };
  return Array.from(selected.values()).sort((left, right) => (
    severityRank[left.severity] - severityRank[right.severity]
    || left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id)
  ));
}

/**
 * @typedef {Object} QaCoordinatorOptions
 * @property {any=} persistence
 * @property {((payload: Record<string, unknown>) => Promise<any>)=} invokeAi
 * @property {(() => Date)=} now
 */

/**
 * @param {QaCoordinatorOptions=} options
 */
function createQaCoordinator(options = {}) {
  const persistence = options.persistence;
  const invokeAi = options.invokeAi;
  const now = options.now || (() => new Date());
  const currentHashes = new Map();
  /** @type {Map<string, AbortController & { requestId?: string }>} */
  const activeRequests = new Map();
  /** @type {Map<string, any>} */
  const resultCache = new Map();
  let lastError = '';
  let lastCompletedAt = '';
  /** @type {any} */
  let latestResult = null;
  let consecutiveAiFailures = 0;
  let circuitOpenUntil = 0;
  let paused = false;

  /**
   * @param {Record<string, any>} snapshot
   * @returns {string}
   */
  function snapshotKey(snapshot) {
    return `${snapshot.document.id}:${snapshot.segment.segmentIndex}:${snapshot.segment.previewPartId}`;
  }

  /**
   * @param {Record<string, any>=} payload
   * @returns {Promise<Record<string, any>>}
   */
  async function checkSegment(payload = {}) {
    const snapshot = /** @type {Record<string, any>} */ (createQaSnapshot(payload));
    const key = snapshotKey(snapshot);
    currentHashes.set(key, snapshot.revision.contentHash);
    const controller = /** @type {AbortController & { requestId?: string }} */ (new AbortController());
    controller.requestId = snapshot.requestId;
    activeRequests.get(key)?.abort?.();
    activeRequests.set(key, controller);
    const startedAt = Date.now();
    const fastStartedAt = Date.now();
    const deterministicFindings = runDeterministicChecks(snapshot, {
      terminologyMatches: payload.terminologyMatches,
      rules: payload.rules
    });
    const fastCheckMs = Date.now() - fastStartedAt;
    const cacheKey = sha256(`${QA_CHECKER_VERSION}:${snapshot.revision.contentHash}:${payload.ai?.providerId || ''}:${payload.ai?.model || ''}`);
    /** @type {any} */
    let aiResult = {
      findings: [], latencyMs: 0, status: payload.ai?.enabled === true ? 'pending' : 'disabled', repairAttempted: false,
      candidateCount: 0, displayedCount: 0, filteredCount: 0, providerId: '', model: ''
    };
    /** @type {any} */
    let result = {
      requestId: snapshot.requestId,
      trigger: snapshot.trigger,
      contentHash: snapshot.revision.contentHash,
      document: snapshot.document,
      segment: {
        previewPartId: snapshot.segment.previewPartId,
        segmentIndex: snapshot.segment.segmentIndex,
        source: snapshot.segment.source,
        target: snapshot.segment.target
      },
      languages: snapshot.languages,
      revision: snapshot.revision,
      configuration: snapshot.configuration,
      contextPolicy: snapshot.contextPolicy,
      status: payload.ai?.enabled === true ? 'checking-ai' : 'complete',
      summary: createSummary(deterministicFindings),
      findings: deterministicFindings,
      execution: {
        deterministic: { status: 'complete', durationMs: fastCheckMs, findingCount: deterministicFindings.length },
        ai: {
          requested: payload.ai?.enabled === true,
          executed: false,
          status: payload.ai?.enabled === true ? 'pending' : 'disabled',
          cacheHit: false,
          providerId: String(payload.ai?.providerId || ''),
          providerName: String(payload.ai?.providerName || ''),
          model: String(payload.ai?.model || ''),
          durationMs: 0,
          candidateCount: 0,
          displayedCount: 0,
          filteredCount: 0,
          repairAttempted: false,
          errorCode: ''
        }
      },
      diagnostics: { fastCheckMs, aiCheckMs: 0, cacheHit: false, checkerVersion: QA_CHECKER_VERSION }
    };
    persistence?.saveQaResult?.(result);
    latestResult = result;

    try {
      if (payload.ai?.enabled === true) {
        if (Date.now() < circuitOpenUntil) {
          const error = /** @type {any} */ (new Error('AI quality checks are temporarily paused after repeated provider failures.'));
          error.code = 'QA_CIRCUIT_OPEN';
          throw error;
        }
        const cached = resultCache.get(cacheKey);
        if (cached) {
          aiResult = cached;
          result.diagnostics.cacheHit = true;
        } else {
          aiResult = await runAiQualityCheck({
            invoke: invokeAi,
            snapshot,
            context: {
              signal: controller.signal,
              providerId: payload.ai.providerId,
              model: payload.ai.model,
              terminology: payload.ai.terminology || [],
              tmMatches: payload.ai.tmMatches || [],
              naturalLanguageRules: payload.ai.naturalLanguageRules || [],
              promptTemplate: payload.ai.promptTemplate || {},
              additionalInstruction: payload.ai.additionalInstruction || ''
            }
          });
          resultCache.set(cacheKey, aiResult);
          if (resultCache.size > 500) resultCache.delete(/** @type {string} */ (resultCache.keys().next().value));
        }
        consecutiveAiFailures = 0;
        circuitOpenUntil = 0;
      }
      if (controller.signal.aborted || currentHashes.get(key) !== snapshot.revision.contentHash) {
        return {
          ...result,
          status: 'stale', findings: [], summary: createSummary([]),
          execution: {
            ...result.execution,
            ai: { ...result.execution.ai, status: 'stale', executed: payload.ai?.enabled === true }
          }
        };
      }
      const findings = mergeFindings(deterministicFindings, aiResult.findings);
      result = {
        ...result,
        status: 'complete',
        summary: createSummary(findings),
        findings,
        execution: {
          deterministic: result.execution.deterministic,
          ai: {
            requested: payload.ai?.enabled === true,
            executed: payload.ai?.enabled === true,
            status: payload.ai?.enabled === true ? 'complete' : 'disabled',
            cacheHit: result.diagnostics.cacheHit === true,
            providerId: String(aiResult.providerId || payload.ai?.providerId || ''),
            providerName: String(aiResult.providerName || payload.ai?.providerName || ''),
            model: String(aiResult.model || payload.ai?.model || ''),
            durationMs: Number(aiResult.latencyMs || 0),
            candidateCount: Number(aiResult.candidateCount || 0),
            displayedCount: Number(aiResult.displayedCount || 0),
            filteredCount: Number(aiResult.filteredCount || 0),
            repairAttempted: aiResult.repairAttempted === true,
            errorCode: ''
          }
        },
        diagnostics: {
          ...result.diagnostics,
          aiCheckMs: Number(aiResult.latencyMs || 0),
          repairAttempted: aiResult.repairAttempted === true,
          providerId: String(payload.ai?.providerId || ''),
          model: String(payload.ai?.model || ''),
          totalMs: Date.now() - startedAt
        }
      };
      persistence?.saveQaResult?.(result);
      latestResult = result;
      lastCompletedAt = now().toISOString();
      lastError = '';
      return result;
    } catch (/** @type {any} */ error) {
      if (payload.ai?.enabled === true && error?.name !== 'AbortError') {
        consecutiveAiFailures += 1;
        if (consecutiveAiFailures >= 3) {
          const backoffMs = Math.min(120000, 30000 * (2 ** Math.min(2, consecutiveAiFailures - 3)));
          circuitOpenUntil = Date.now() + backoffMs;
        }
      }
      lastError = String(error?.message || error);
      const errorCode = String(error?.code || 'QA_PROVIDER_UNAVAILABLE');
      const circuitOpen = errorCode === 'QA_CIRCUIT_OPEN';
      const cancelled = error?.name === 'AbortError';
      result = {
        ...result,
        status: 'local-only',
        execution: {
          deterministic: result.execution.deterministic,
          ai: {
            ...result.execution.ai,
            executed: payload.ai?.enabled === true && !circuitOpen,
            status: cancelled ? 'cancelled' : circuitOpen ? 'circuit-open' : 'failed',
            providerId: String(error?.providerId || payload.ai?.providerId || ''),
            providerName: String(error?.providerName || payload.ai?.providerName || ''),
            model: String(error?.model || payload.ai?.model || ''),
            durationMs: circuitOpen ? 0 : Math.max(0, Number(error?.durationMs ?? (Date.now() - startedAt)) || 0),
            repairAttempted: error?.repairAttempted === true,
            errorCode
          }
        },
        diagnostics: { ...result.diagnostics, aiErrorCode: errorCode, totalMs: Date.now() - startedAt }
      };
      persistence?.saveQaResult?.(result);
      latestResult = result;
      return result;
    } finally {
      if (activeRequests.get(key) === controller) activeRequests.delete(key);
    }
  }

  /**
   * @param {Record<string, any>=} payload
   * @returns {Promise<Record<string, any>>}
   */
  async function checkDocument(payload = {}) {
    const segments = Array.isArray(payload.segments) ? payload.segments : [];
    if (!segments.length) {
      const error = /** @type {any} */ (new Error('Document QA requires at least one segment.'));
      error.code = 'QA_INVALID_REQUEST';
      throw error;
    }
    const concurrency = Math.max(1, Math.min(4, Number(payload.concurrency) || 2));
    const results = new Array(segments.length);
    let cursor = 0;
    async function worker() {
      while (cursor < segments.length) {
        const index = cursor++;
        results[index] = await checkSegment({
          ...payload,
          requestId: crypto.randomUUID(),
          segment: { ...segments[index], segmentIndex: segments[index].segmentIndex ?? index }
        });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, segments.length) }, () => worker()));
    return {
      document: payload.document || { id: payload.documentId || 'imported-document', name: payload.documentName || '' },
      status: results.some((item) => item.status === 'local-only') ? 'local-only' : 'complete',
      summary: createSummary(results.flatMap((item) => item.findings)),
      results
    };
  }

  return {
    checkSegment,
    checkDocument,
    /**
     * @param {Record<string, any>=} payload
     */
    cancel(payload = {}) {
      const requestId = String(payload.requestId || '');
      const documentId = String(payload.documentId || '');
      let cancelled = 0;
      for (const [key, controller] of activeRequests.entries()) {
        if ((!requestId && !documentId) || key.startsWith(`${documentId}:`) || controller.requestId === requestId) {
          controller.abort();
          activeRequests.delete(key);
          cancelled += 1;
        }
      }
      if (typeof payload.paused === 'boolean') paused = payload.paused;
      return { ok: true, cancelled, paused };
    },
    /**
     * @param {Record<string, any>=} payload
     */
    saveFeedback(payload = {}) {
      if (!QA_FEEDBACK_STATES.includes(payload.state)) {
        const error = /** @type {any} */ (new Error('Unsupported QA feedback state.'));
        error.code = 'QA_INVALID_REQUEST';
        throw error;
      }
      return persistence.saveQaFeedback({
        id: String(payload.id || crypto.randomUUID()),
        requestId: String(payload.requestId || ''),
        findingId: String(payload.findingId || ''),
        state: payload.state,
        ruleId: String(payload.ruleId || '')
      });
    },
    /**
     * @param {unknown=} documentId
     */
    listResults(documentId) { return persistence?.listQaResults?.(documentId) || []; },
    getStatus() {
      return {
        enabled: true,
        paused,
        aiDefaultEnabled: false,
        activeRequestCount: activeRequests.size,
        cacheEntryCount: resultCache.size,
        retentionDays: 30,
        circuitOpenUntil: circuitOpenUntil ? new Date(circuitOpenUntil).toISOString() : '',
        consecutiveAiFailures,
        lastCompletedAt,
        lastError,
        latestResult
      };
    },
    dispose() {
      for (const controller of activeRequests.values()) controller.abort();
      activeRequests.clear();
    }
  };
}

module.exports = { QA_CHECKER_VERSION, createQaCoordinator, createSummary, mergeFindings };
