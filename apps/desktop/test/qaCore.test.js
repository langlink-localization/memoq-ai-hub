'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQaSnapshot } = require('../src/qa/qaContracts');
const { runDeterministicChecks } = require('../src/qa/deterministicRules');
const { applyConfidenceThreshold, runAiQualityCheck } = require('../src/qa/aiQualityChecker');
const { createQaCoordinator, mergeFindings } = require('../src/qa/qaCoordinator');

function snapshot(target = 'Total: 10 USD on 2026-08-15.') {
  return createQaSnapshot({ document: { id: 'doc-1' }, segment: { source: 'Total: 10 USD on 2026-08-15.', target } });
}

test('QA content hash changes with target, rules, assets, and context policy', () => {
  const base = { document: { id: 'doc-1' }, segment: { source: 'A', target: 'B' }, configuration: { ruleSetVersion: '1', glossaryFingerprint: 'g1' } };
  const first = createQaSnapshot(base);
  const second = createQaSnapshot({ ...base, segment: { source: 'A', target: 'C' } });
  const third = createQaSnapshot({ ...base, configuration: { ...base.configuration, ruleSetVersion: '2' } });
  assert.notEqual(first.revision.contentHash, second.revision.contentHash);
  assert.notEqual(first.revision.contentHash, third.revision.contentHash);
  assert.equal(Object.isFrozen(first), true);
});

test('QA content hash ignores highlight ranges and capture timing but covers checked context', () => {
  const base = {
    document: { id: 'doc-1', name: 'Doc' },
    segment: { previewPartId: 'part-1', segmentIndex: 3, source: 'A', target: 'B' },
    languages: { source: 'ZH', target: 'JA' },
    context: { above: '', below: '', summary: '', fullText: '' },
    contextPolicy: { includeSummary: false, includeFullText: false, maxAdjacentCharacters: 1200 },
    configuration: { ruleSetVersion: '1' }
  };
  const first = createQaSnapshot(base);
  const drifted = createQaSnapshot({
    ...base,
    document: { ...base.document, name: 'Doc renamed' },
    segment: {
      ...base.segment,
      segmentIndex: 9,
      sourceFocusedRange: { start: 1, end: 2 },
      targetFocusedRange: { start: 3, end: 4 }
    },
    revision: { previewRevision: 42, capturedAt: '2026-08-16T00:00:00.000Z' }
  });

  assert.equal(first.revision.contentHash, drifted.revision.contentHash);

  const changedContext = createQaSnapshot({ ...base, context: { ...base.context, above: 'new above' } });
  const changedPolicy = createQaSnapshot({ ...base, contextPolicy: { ...base.contextPolicy, includeSummary: true } });
  const changedConfiguration = createQaSnapshot({ ...base, configuration: { ruleSetVersion: '2' } });
  const changedTarget = createQaSnapshot({ ...base, segment: { ...base.segment, target: 'C' } });
  const changedPart = createQaSnapshot({ ...base, segment: { ...base.segment, previewPartId: 'part-2' } });
  const changedLanguages = createQaSnapshot({ ...base, languages: { source: 'ZH', target: 'EN' } });
  assert.notEqual(first.revision.contentHash, changedContext.revision.contentHash);
  assert.notEqual(first.revision.contentHash, changedPolicy.revision.contentHash);
  assert.notEqual(first.revision.contentHash, changedConfiguration.revision.contentHash);
  assert.notEqual(first.revision.contentHash, changedTarget.revision.contentHash);
  assert.notEqual(first.revision.contentHash, changedPart.revision.contentHash);
  assert.notEqual(first.revision.contentHash, changedLanguages.revision.contentHash);
});

test('deterministic QA catches structural data, whitespace, length, terminology, and custom rules', () => {
  const findings = runDeterministicChecks(snapshot('  Total: 11 EUR  '), {
    terminologyMatches: [{ entry: { id: 'term-1', sourceTerm: 'Total', targetTerm: 'Sum' } }],
    rules: [{ id: 'rule-1', name: 'No EUR', type: 'contains', scope: 'target', value: 'EUR', severity: 'major', category: 'locale-convention' }]
  });
  const ids = new Set(findings.map((finding) => finding.ruleId));
  ['numbers', 'dates', 'currencies', 'outer-whitespace', 'required-term', 'rule-1'].forEach((id) => assert.equal(ids.has(id), true, id));
});

test('AI thresholds hide low confidence and downgrade uncertain findings', () => {
  assert.equal(applyConfidenceThreshold({ severity: 'minor', confidence: 0.54 }), null);
  assert.equal(applyConfidenceThreshold({ severity: 'minor', confidence: 0.69 }).severity, 'info');
  assert.equal(applyConfidenceThreshold({ severity: 'major', confidence: 0.79, sourceEvidence: 'a', targetEvidence: 'b' }).severity, 'info');
  assert.equal(applyConfidenceThreshold({ severity: 'major', confidence: 0.8, sourceEvidence: 'a', targetEvidence: 'b' }).severity, 'major');
});

test('AI schema is repaired once and deterministic evidence wins duplicate merge', async () => {
  let calls = 0;
  const result = await runAiQualityCheck({
    snapshot: snapshot(),
    invoke: async () => ({ output: ++calls === 1 ? '{}' : JSON.stringify({ findings: [{ category: 'accuracy', severity: 'minor', title: 'Issue', message: 'Message', confidence: 0.7 }] }) })
  });
  assert.equal(result.repairAttempted, true);
  assert.equal(calls, 2);
  const duplicate = { ...result.findings[0], ruleId: 'same', sourceEvidence: 'x' };
  const deterministic = { ...duplicate, id: 'det', origin: 'deterministic' };
  assert.equal(mergeFindings([deterministic], [{ ...duplicate, id: 'ai', origin: 'ai' }])[0].id, 'det');
});

test('AI finding validation failures receive the single repair attempt', async () => {
  let calls = 0;
  const result = await runAiQualityCheck({
    snapshot: snapshot(),
    invoke: async () => ({
      output: JSON.stringify({
        findings: ++calls === 1
          ? [{ category: 'accuracy', severity: 'minor', title: 'Issue', message: 'Message' }]
          : []
      })
    })
  });
  assert.equal(result.repairAttempted, true);
  assert.equal(calls, 2);
});

test('AI provider failures are not mislabeled or retried as invalid output', async () => {
  let calls = 0;
  const providerError = new Error('provider unavailable');
  providerError.code = 'PROVIDER_REQUEST_FAILED';
  await assert.rejects(
    () => runAiQualityCheck({
      snapshot: snapshot(),
      invoke: async () => {
        calls += 1;
        throw providerError;
      }
    }),
    (error) => error.code === 'PROVIDER_REQUEST_FAILED'
  );
  assert.equal(calls, 1);
});

test('coordinator cancels an active AI request and discards stale response', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const coordinator = createQaCoordinator({ invokeAi: async () => pending });
  const request = coordinator.checkSegment({ ...snapshot(), requestId: 'request-1', ai: { enabled: true } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coordinator.cancel({ requestId: 'request-1' }).cancelled, 1);
  release({ output: JSON.stringify({ findings: [] }) });
  assert.equal((await request).status, 'stale');
});

test('coordinator opens a bounded circuit after repeated AI failures', async () => {
  const coordinator = createQaCoordinator({ invokeAi: async () => { throw new Error('offline'); } });
  for (let index = 0; index < 3; index += 1) {
    const result = await coordinator.checkSegment({ document: { id: 'circuit-doc' }, segment: { source: 'A', target: `B${index}` }, ai: { enabled: true } });
    assert.equal(result.status, 'local-only');
  }
  const status = coordinator.getStatus();
  assert.equal(status.consecutiveAiFailures, 3);
  assert.notEqual(status.circuitOpenUntil, '');
});

test('coordinator preserves resolved route, repair state, and elapsed time for invalid AI output', async () => {
  const coordinator = createQaCoordinator({
    invokeAi: async () => {
      const error = new SyntaxError('response is not valid JSON');
      error.providerId = 'provider-resolved';
      error.model = 'model-resolved';
      throw error;
    }
  });
  const result = await coordinator.checkSegment({
    ...snapshot(),
    ai: { enabled: true, providerId: 'provider-requested', model: 'draft_model_internal' }
  });
  assert.equal(result.status, 'local-only');
  assert.equal(result.execution.ai.status, 'failed');
  assert.equal(result.execution.ai.errorCode, 'QA_INVALID_AI_OUTPUT');
  assert.equal(result.execution.ai.providerId, 'provider-resolved');
  assert.equal(result.execution.ai.model, 'model-resolved');
  assert.equal(result.execution.ai.repairAttempted, true);
  assert.ok(result.execution.ai.durationMs >= 0);
});

test('coordinator reports deterministic-only completion separately from AI execution', async () => {
  const coordinator = createQaCoordinator();
  const result = await coordinator.checkSegment({ document: { id: 'clean-doc' }, segment: { source: 'Hello', target: '你好' }, ai: { enabled: false } });
  assert.equal(result.execution.deterministic.status, 'complete');
  assert.equal(result.execution.deterministic.findingCount, 0);
  assert.equal(result.execution.ai.requested, false);
  assert.equal(result.execution.ai.executed, false);
  assert.equal(result.execution.ai.status, 'disabled');
});

test('coordinator exposes candidate, displayed, filtered, route, and cache diagnostics without filtered finding text', async () => {
  let calls = 0;
  const coordinator = createQaCoordinator({
    invokeAi: async () => {
      calls += 1;
      return {
        output: JSON.stringify({ findings: [
          { category: 'accuracy', severity: 'major', title: 'Visible', message: 'Visible issue', confidence: 0.9, sourceEvidence: 'a', targetEvidence: 'b' },
          { category: 'style', severity: 'minor', title: 'Hidden secret finding', message: 'Hidden body', confidence: 0.4 }
        ] }),
        providerId: 'provider-1',
        model: 'model-1'
      };
    }
  });
  const payload = { ...snapshot(), ai: { enabled: true, providerId: 'provider-1', model: 'model-1' } };
  const first = await coordinator.checkSegment(payload);
  assert.deepEqual({
    candidate: first.execution.ai.candidateCount,
    displayed: first.execution.ai.displayedCount,
    filtered: first.execution.ai.filteredCount
  }, { candidate: 2, displayed: 1, filtered: 1 });
  assert.equal(first.execution.ai.providerId, 'provider-1');
  assert.equal(JSON.stringify(first).includes('Hidden secret finding'), false);
  const second = await coordinator.checkSegment(payload);
  assert.equal(second.execution.ai.cacheHit, true);
  assert.equal(calls, 1);
});
