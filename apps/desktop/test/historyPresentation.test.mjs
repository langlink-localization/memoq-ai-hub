import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHistoryActiveFilterTags,
  buildHistoryAttemptRows,
  buildHistoryDiagnosticSummary,
  buildHistorySegments,
  createEmptyHistoryFilters,
  filterHistoryItems,
  formatInsightLatency
} from '../src/renderer/src/pages/history/historyPresentation.mjs';

const t = (key, values = {}) => `${key}${values.count === undefined ? '' : `:${values.count}`}`;

test('history presentation returns independent empty filter drafts', () => {
  const first = createEmptyHistoryFilters();
  const second = createEmptyHistoryFilters();

  first.search = 'changed';
  assert.equal(second.search, '');
  assert.deepEqual(Object.keys(second), ['search', 'projectId', 'subject', 'provider', 'model', 'status', 'issue', 'dateFrom', 'dateTo']);
});

test('history presentation keeps filters, diagnostics, and detail rows page-local', () => {
  const timeoutRecord = {
    id: 'timeout-record',
    requestId: 'REQ-1',
    status: 'failed',
    latencyMs: 42000,
    submittedAt: '2026-08-01T09:00:00.000Z',
    throughput: { fallbackReasons: ['batch-timeout'] },
    attempts: [{
      errorCode: 'PROVIDER_TIMEOUT',
      providerName: 'Provider A',
      model: 'model-a',
      latencyMs: 42000,
      success: false,
      fallbackStage: 'single'
    }]
  };
  const healthyRecord = {
    id: 'healthy-record',
    requestId: 'REQ-2',
    status: 'success',
    latencyMs: 300,
    submittedAt: '2026-08-02T09:00:00.000Z'
  };

  assert.deepEqual(filterHistoryItems([timeoutRecord, healthyRecord], { issue: 'timeout' }), [timeoutRecord]);
  assert.deepEqual(filterHistoryItems([timeoutRecord, healthyRecord], { search: 'req-2' }), [healthyRecord]);

  const diagnostic = buildHistoryDiagnosticSummary(timeoutRecord);
  assert.equal(diagnostic.fallbackActive, true);
  assert.equal(diagnostic.attemptCount, 1);
  assert.equal(diagnostic.primaryError, 'PROVIDER_TIMEOUT');
  assert.equal(buildHistoryAttemptRows(timeoutRecord)[0].provider, 'Provider A');
  assert.equal(formatInsightLatency(timeoutRecord.latencyMs), '42s');

  assert.deepEqual(buildHistoryActiveFilterTags({ status: 'failed', search: '' }, t), [{
    field: 'status',
    value: 'failed',
    label: 'history.statusFilter: history.statusFailed'
  }]);
});

test('history presentation normalizes stored and legacy segment shapes', () => {
  assert.deepEqual(buildHistorySegments({
    segments: [{ segmentIndex: 4, sourceText: 'Source', targetText: 'Target' }]
  }), [{
    segmentIndex: 4,
    segmentId: '',
    segmentStatus: '',
    source: 'Source',
    target: 'Target',
    tmSource: '',
    tmTarget: '',
    customTmMatches: []
  }]);

  assert.equal(buildHistorySegments({
    metadata: { segmentLevelMetadata: [{ source: 'Legacy source' }] },
    result: { translations: [{ index: 0, text: 'Legacy target' }] }
  })[0].target, 'Legacy target');
});
