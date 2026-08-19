import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLogDiagnosticText,
  flattenLogFiles,
  formatLogBytes,
  normalizeLogStatePayload
} from '../src/renderer/src/pages/logs/logPresentation.mjs';

test('log presentation normalizes runtime payloads before rendering', () => {
  const normalized = normalizeLogStatePayload({
    ok: false,
    logsDir: 42,
    policy: { maxFileBytes: '1024', maxFiles: '5', retentionDays: '7' },
    totalSizeBytes: '2048',
    groups: 'invalid'
  });

  assert.equal(normalized.ok, false);
  assert.equal(normalized.logsDir, '42');
  assert.deepEqual(normalized.policy, { maxFileBytes: 1024, maxFiles: 5, retentionDays: 7 });
  assert.equal(normalized.totalSizeBytes, 2048);
  assert.deepEqual(normalized.groups, []);
});

test('log presentation formats sizes and flattens grouped files', () => {
  assert.equal(formatLogBytes(0), '0 B');
  assert.equal(formatLogBytes(1536), '1.5 KB');
  assert.deepEqual(flattenLogFiles({
    groups: [{ source: 'runtime', files: [{ name: 'runtime.log', sizeBytes: 10 }] }]
  }), [{
    key: 'runtime-runtime.log',
    source: 'runtime',
    name: 'runtime.log',
    sizeBytes: 10
  }]);
});

test('log diagnostics preserve support fields without embedding log contents', () => {
  const t = (key, values = {}) => `${key}:${values.value ?? values.product ?? values.source ?? ''}`;
  const diagnostic = buildLogDiagnosticText({
    logsDir: 'C:/logs',
    totalSizeBytes: 10,
    latestUpdatedAt: '2026-08-20T00:00:00.000Z',
    groups: [{ source: 'runtime', totalSizeBytes: 10, files: [{ name: 'runtime.log' }] }]
  }, {
    productName: 'memoQ AI Hub',
    contractVersion: '1',
    gatewayBaseUrl: 'http://127.0.0.1',
    startup: { status: 'ready' }
  }, t);

  assert.match(diagnostic, /logs\.diagnosticContract:1/);
  assert.match(diagnostic, /logs\.diagnosticDirectory:C:\/logs/);
  assert.match(diagnostic, /logs\.diagnosticGroup:runtime/);
  assert.doesNotMatch(diagnostic, /runtime\.log/);
});
