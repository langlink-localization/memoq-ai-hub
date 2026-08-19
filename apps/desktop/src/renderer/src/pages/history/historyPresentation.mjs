import { parseDateInputToEpochMs } from '../../timeFormatting.mjs';

export const HISTORY_ISSUE_OPTIONS = ['failed', 'timeout', 'rate_limit', 'fallback', 'slow'];
export const EMPTY_HISTORY_FILTERS = {
  search: '',
  projectId: '',
  subject: '',
  provider: '',
  model: '',
  status: '',
  issue: '',
  dateFrom: '',
  dateTo: ''
};

const SLOW_HISTORY_LATENCY_MS = 30000;

function normalizeFilterText(value) {
  return String(value || '').trim().toLowerCase();
}

export function createEmptyHistoryFilters() {
  return { ...EMPTY_HISTORY_FILTERS };
}

function getHistoryAttempts(entry = {}) {
  return Array.isArray(entry.attempts) ? entry.attempts : [];
}

function getHistoryAttemptErrorCode(attempt = {}) {
  return String(attempt?.errorCode || '').trim().toUpperCase();
}

function hasHistoryFallback(entry = {}) {
  if (entry?.issueFlags?.fallback === true || entry.finalizedByFallbackRoute === true) return true;
  if (Array.isArray(entry.throughput?.fallbackReasons) && entry.throughput.fallbackReasons.length > 0) return true;
  return getHistoryAttempts(entry).some((attempt) => attempt?.finalizedByFallbackRoute === true);
}

function matchesHistoryIssue(entry = {}, issue = '') {
  const normalizedIssue = String(issue || '').trim().toLowerCase();
  if (!normalizedIssue || !HISTORY_ISSUE_OPTIONS.includes(normalizedIssue)) return true;

  if (normalizedIssue === 'failed') {
    return entry?.issueFlags?.failed === true || String(entry?.status || '').trim().toLowerCase() === 'failed';
  }
  if (normalizedIssue === 'timeout') {
    if (entry?.issueFlags?.timeout === true) return true;
    return getHistoryAttempts(entry).some((attempt) => {
      const errorCode = getHistoryAttemptErrorCode(attempt);
      return errorCode === 'PROVIDER_TIMEOUT' || errorCode === 'TRANSLATION_TIMEOUT';
    });
  }
  if (normalizedIssue === 'rate_limit') {
    if (entry?.issueFlags?.rate_limit === true) return true;
    return getHistoryAttempts(entry).some((attempt) => getHistoryAttemptErrorCode(attempt) === 'PROVIDER_RATE_LIMITED');
  }
  if (normalizedIssue === 'fallback') return hasHistoryFallback(entry);
  if (normalizedIssue === 'slow') {
    if (entry?.issueFlags?.slow === true) return true;
    const latencyMs = Number(entry?.latencyMs);
    return Number.isFinite(latencyMs) && latencyMs > SLOW_HISTORY_LATENCY_MS;
  }
  return true;
}

export function getHistoryIssueLabel(t, issue = '') {
  const normalizedIssue = String(issue || '').trim().toLowerCase();
  if (!normalizedIssue) return '';
  const key = `history.issue.${normalizedIssue}`;
  const label = t(key);
  return label === key ? normalizedIssue : label;
}

export function buildHistoryActiveFilterTags(filters = {}, t) {
  const labelsByField = {
    search: t('history.search'),
    provider: t('history.providerFilter'),
    model: t('history.modelFilter'),
    projectId: t('history.projectIdFilter'),
    subject: t('history.subjectFilter'),
    status: t('history.statusFilter'),
    issue: t('history.issueFilter'),
    dateFrom: t('history.dateFrom'),
    dateTo: t('history.dateTo')
  };

  return Object.entries(filters).map(([field, value]) => {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) return null;
    const displayValue = field === 'issue'
      ? getHistoryIssueLabel(t, normalizedValue)
      : field === 'status'
        ? t(`history.status${normalizedValue === 'success' ? 'Success' : 'Failed'}`)
        : normalizedValue;
    return {
      field,
      value: normalizedValue,
      label: `${labelsByField[field] || field}: ${displayValue}`
    };
  }).filter(Boolean);
}

export function getHistoryInsightFocusMessage(t, focus = {}) {
  if (!focus || typeof focus !== 'object') return '';
  if (focus.code) return t(`history.insights.attention.${focus.code}`, focus.values || {});
  if (focus.provider || focus.model) {
    return t('history.insights.providerFocusMessage', {
      provider: focus.provider || '-',
      model: focus.model || '-'
    });
  }
  return t('history.insights.genericFocusMessage');
}

function hasHistoryCacheHit(entry = {}) {
  if (entry?.issueFlags?.cache_hit === true) return true;
  return getHistoryAttempts(entry).some((attempt) => {
    const cacheKind = String(attempt?.cacheKind || '').trim().toLowerCase();
    return cacheKind === 'exact' || cacheKind === 'adaptive';
  });
}

export function buildHistoryIssueTags(record = {}) {
  const tags = [];
  const addTag = (key, color = 'default', issue = '') => {
    if (!tags.some((tag) => tag.key === key)) tags.push({ key, color, issue });
  };

  if (matchesHistoryIssue(record, 'failed')) addTag('failed', 'red', 'failed');
  if (matchesHistoryIssue(record, 'timeout')) addTag('timeout', 'orange', 'timeout');
  if (matchesHistoryIssue(record, 'rate_limit')) addTag('rate_limit', 'gold', 'rate_limit');
  if (matchesHistoryIssue(record, 'fallback')) addTag('fallback', 'blue', 'fallback');
  if (matchesHistoryIssue(record, 'slow')) addTag('slow', 'volcano', 'slow');
  if (hasHistoryCacheHit(record)) addTag('cache_hit', 'green', '');
  return tags;
}

function getHistoryAttemptErrorMessage(attempt = {}) {
  return String(attempt?.errorCode || attempt?.error?.code || attempt?.error?.message || attempt?.message || '').trim();
}

export function buildHistoryDiagnosticSummary(record = {}) {
  const attempts = getHistoryAttempts(record);
  const issueTags = buildHistoryIssueTags(record);
  const errorCodes = Array.from(new Set(attempts.map(getHistoryAttemptErrorMessage).filter(Boolean)));
  const throughputFallbackReasons = Array.isArray(record?.throughput?.fallbackReasons)
    ? record.throughput.fallbackReasons.map((reason) => String(reason || '').trim()).filter(Boolean)
    : [];
  const fallbackStages = Array.from(new Set(attempts
    .map((attempt) => String(attempt?.fallbackStage || '').trim())
    .filter(Boolean)));

  return {
    issueTags,
    issueCount: issueTags.filter((tag) => tag.issue).length,
    totalLatencyMs: Number.isFinite(Number(record?.latencyMs)) ? Number(record.latencyMs) : null,
    attemptCount: attempts.length,
    fallbackActive: hasHistoryFallback(record),
    fallbackReasons: Array.from(new Set([...throughputFallbackReasons, ...fallbackStages])),
    primaryError: errorCodes[0] || '',
    errorCodes
  };
}

export function buildHistoryAttemptRows(record = {}) {
  return getHistoryAttempts(record).map((attempt, index) => ({
    key: `${record?.id || 'history'}-${index}`,
    index: index + 1,
    route: String(attempt?.routeKind || attempt?.effectiveExecutionMode || '').trim(),
    provider: String(attempt?.providerName || attempt?.providerId || '').trim(),
    model: String(attempt?.model || '').trim(),
    mode: String(attempt?.effectiveExecutionMode || (attempt?.batch ? 'batch' : '')).trim(),
    success: attempt?.success === true,
    latencyMs: Number.isFinite(Number(attempt?.latencyMs)) ? Number(attempt.latencyMs) : null,
    cacheKind: String(attempt?.cacheKind || '').trim(),
    error: getHistoryAttemptErrorMessage(attempt),
    fallbackStage: String(attempt?.fallbackStage || '').trim(),
    batchSize: Number.isFinite(Number(attempt?.batchSize)) ? Number(attempt.batchSize) : null,
    retryCount: Number.isFinite(Number(attempt?.retryCount)) ? Number(attempt.retryCount) : null
  }));
}

export function filterHistoryItems(items = [], filters = {}) {
  const search = normalizeFilterText(filters.search);
  const projectId = normalizeFilterText(filters.projectId);
  const subject = normalizeFilterText(filters.subject);
  const provider = normalizeFilterText(filters.provider);
  const model = normalizeFilterText(filters.model);
  const status = normalizeFilterText(filters.status);
  const issue = normalizeFilterText(filters.issue);
  const dateFrom = parseDateInputToEpochMs(filters.dateFrom);
  const dateTo = parseDateInputToEpochMs(filters.dateTo, { endOfDay: true });

  return items.filter((item) => {
    const searchableText = [
      item.requestId,
      item.projectId,
      item.subject,
      item.providerId,
      item.providerName,
      item.model,
      item.status,
      item.segmentSummary
    ].map((value) => String(value || '').toLowerCase()).join(' ');

    if (search && !searchableText.includes(search)) return false;
    if (projectId && !String(item.projectId || '').toLowerCase().includes(projectId)) return false;
    if (subject && !String(item.subject || '').toLowerCase().includes(subject)) return false;
    if (provider && !String(item.providerName || item.providerId || '').toLowerCase().includes(provider)) return false;
    if (model && !String(item.model || '').toLowerCase().includes(model)) return false;
    if (status && String(item.status || '').toLowerCase() !== status) return false;
    if (issue && !matchesHistoryIssue(item, issue)) return false;

    const submittedAtTime = new Date(item.submittedAt || '').getTime();
    if (dateFrom && Number.isFinite(submittedAtTime) && submittedAtTime < dateFrom) return false;
    if (dateTo && Number.isFinite(submittedAtTime) && submittedAtTime > dateTo) return false;
    return true;
  });
}

export function buildHistorySegments(record) {
  if (Array.isArray(record?.segments) && record.segments.length) {
    return record.segments.map((segment, index) => ({
      segmentIndex: segment.segmentIndex ?? index,
      segmentId: segment.segmentId || '',
      segmentStatus: segment.segmentStatus ?? '',
      source: segment.sourceText || segment.source || '',
      target: segment.targetText || segment.target || '',
      tmSource: segment.tmSource || '',
      tmTarget: segment.tmTarget || '',
      customTmMatches: Array.isArray(segment.customTmMatches) ? segment.customTmMatches : []
    }));
  }

  const metadataSegments = record?.metadata?.segmentLevelMetadata || [];
  const translations = record?.result?.translations || [];
  return metadataSegments.map((segment, index) => ({
    segmentIndex: segment.segmentIndex ?? index,
    segmentId: segment.segmentId || '',
    segmentStatus: segment.segmentStatus ?? '',
    source: segment.source || '',
    target: translations.find((translation) => Number(translation.index) === index)?.text || '',
    tmSource: segment.tmSource || '',
    tmTarget: segment.tmTarget || '',
    customTmMatches: Array.isArray(segment.customTmMatches) ? segment.customTmMatches : []
  }));
}

export function formatHistoryThroughputValue(record, t) {
  const throughput = record?.throughput;
  if (!throughput) return '';
  const parts = [];
  if (throughput.mode) parts.push(`${throughput.mode}${throughput.status ? `/${throughput.status}` : ''}`);
  if (throughput.effectiveMaxBatchSegments) parts.push(t('history.throughputSegments', { count: throughput.effectiveMaxBatchSegments }));
  if (throughput.effectiveMaxBatchCharacters) parts.push(t('history.throughputCharacters', { count: throughput.effectiveMaxBatchCharacters }));
  if (throughput.effectiveConcurrencyLimit) parts.push(t('history.throughputConcurrency', { count: throughput.effectiveConcurrencyLimit }));
  if (throughput.batchSplitCount) parts.push(t('history.throughputSplits', { count: throughput.batchSplitCount }));
  if (throughput.queuedMs) parts.push(t('history.throughputQueued', { count: throughput.queuedMs }));
  if (throughput.providerLatencyMs) parts.push(t('history.throughputProviderLatency', { count: throughput.providerLatencyMs }));
  if (throughput.providerAttemptTimeoutMs) parts.push(t('history.throughputTimeout', { count: throughput.providerAttemptTimeoutMs }));
  if (Array.isArray(throughput.fallbackReasons) && throughput.fallbackReasons.length) {
    parts.push(t('history.throughputFallback', { value: throughput.fallbackReasons.join(', ') }));
  }
  return parts.join(' | ');
}

export function formatInsightLatency(value, fallback = '-') {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return fallback;
  if (normalized >= 1000) return `${(normalized / 1000).toFixed(1).replace(/\.0$/, '')}s`;
  return `${Math.round(normalized)}ms`;
}
