'use strict';

const { normalizeMemoQMetadata, normalizeSegmentMetadataItem } = require('../shared/memoqMetadataNormalizer');
const { mapProviderError } = require('../provider/providerRegistry');
const { CONTRACT_VERSION, ERROR_CODES } = require('../shared/desktopContract');

const DEFAULT_AGGREGATE_QUIET_WINDOW_MS = 250;
const DEFAULT_AGGREGATE_MAX_BUFFERED_REQUESTS = 2;
const DEFAULT_AGGREGATE_MAX_BUFFERED_SEGMENTS = 20;
const DEFAULT_AGGREGATE_MAX_BUFFERED_CHARACTERS = 12000;
const DEFAULT_AGGREGATE_DEADLINE_MS = 1500;
const DEFAULT_AGGREGATE_RESULT_WAIT_MS = 25000;
const DEFAULT_AGGREGATE_RESULT_WAIT_MAX_MS = 30000;
const DEFAULT_AGGREGATE_SOFT_DEADLINE_MS = 35000;
const DEFAULT_AGGREGATE_HARD_DEADLINE_MS = 90000;
const DEFAULT_AGGREGATE_RESCUE_BATCH_SIZE = 3;
const DEFAULT_AGGREGATE_RESCUE_CONCURRENCY = 2;
const DEFAULT_AGGREGATE_RESCUE_SINGLE_TIMEOUT_MS = 12000;
const DEFAULT_AGGREGATE_RESCUE_COLLECT_WINDOW_MS = 3000;
const DEFAULT_AGGREGATE_RESCUE_MIN_SETTLE_TRANSLATIONS = 3;
const DEFAULT_AGGREGATE_CONGESTED_MAX_BUFFERED_REQUESTS = 1;
const DEFAULT_AGGREGATE_CONGESTED_MAX_BUFFERED_SEGMENTS = 10;
const DEFAULT_AGGREGATE_CONGESTED_MAX_BUFFERED_CHARACTERS = 6000;
const DEFAULT_AGGREGATE_CONGESTION_RECOVERY_SUCCESSES = 3;

/**
 * @param {any} options
 */
function resolveRuntimeAggregationSettings(options = {}) {
  const softDeadlineMs = Number.isFinite(Number(options.aggregateSoftDeadlineMs))
    ? Math.max(1, Number(options.aggregateSoftDeadlineMs))
    : DEFAULT_AGGREGATE_SOFT_DEADLINE_MS;
  return {
    quietWindowMs: Number.isFinite(Number(options.aggregateQuietWindowMs)) ? Math.max(0, Number(options.aggregateQuietWindowMs)) : DEFAULT_AGGREGATE_QUIET_WINDOW_MS,
    maxBufferedRequests: Number.isFinite(Number(options.aggregateMaxBufferedRequests)) ? Math.max(1, Number(options.aggregateMaxBufferedRequests)) : DEFAULT_AGGREGATE_MAX_BUFFERED_REQUESTS,
    maxBufferedSegments: Number.isFinite(Number(options.aggregateMaxBufferedSegments)) ? Math.max(1, Number(options.aggregateMaxBufferedSegments)) : DEFAULT_AGGREGATE_MAX_BUFFERED_SEGMENTS,
    maxBufferedCharacters: Number.isFinite(Number(options.aggregateMaxBufferedCharacters)) ? Math.max(1, Number(options.aggregateMaxBufferedCharacters)) : DEFAULT_AGGREGATE_MAX_BUFFERED_CHARACTERS,
    deadlineMs: Number.isFinite(Number(options.aggregateDeadlineMs)) ? Math.max(1, Number(options.aggregateDeadlineMs)) : DEFAULT_AGGREGATE_DEADLINE_MS,
    resultWaitMaxMs: Number.isFinite(Number(options.aggregateResultWaitMaxMs)) ? Math.max(1, Number(options.aggregateResultWaitMaxMs)) : DEFAULT_AGGREGATE_RESULT_WAIT_MAX_MS,
    softDeadlineMs,
    hardDeadlineMs: Number.isFinite(Number(options.aggregateHardDeadlineMs)) ? Math.max(softDeadlineMs + 1, Number(options.aggregateHardDeadlineMs)) : DEFAULT_AGGREGATE_HARD_DEADLINE_MS,
    rescueBatchSize: Number.isFinite(Number(options.aggregateRescueBatchSize)) ? Math.max(1, Math.min(3, Math.floor(Number(options.aggregateRescueBatchSize)))) : DEFAULT_AGGREGATE_RESCUE_BATCH_SIZE,
    rescueConcurrency: Number.isFinite(Number(options.aggregateRescueConcurrency)) ? Math.max(1, Math.min(4, Math.floor(Number(options.aggregateRescueConcurrency)))) : DEFAULT_AGGREGATE_RESCUE_CONCURRENCY,
    rescueSingleTimeoutMs: Number.isFinite(Number(options.aggregateRescueSingleTimeoutMs)) ? Math.max(1000, Math.floor(Number(options.aggregateRescueSingleTimeoutMs))) : DEFAULT_AGGREGATE_RESCUE_SINGLE_TIMEOUT_MS,
    rescueCollectWindowMs: Number.isFinite(Number(options.aggregateRescueCollectWindowMs)) ? Math.max(0, Math.floor(Number(options.aggregateRescueCollectWindowMs))) : DEFAULT_AGGREGATE_RESCUE_COLLECT_WINDOW_MS,
    rescueMinSettleTranslations: Number.isFinite(Number(options.aggregateRescueMinSettleTranslations)) ? Math.max(1, Math.floor(Number(options.aggregateRescueMinSettleTranslations))) : DEFAULT_AGGREGATE_RESCUE_MIN_SETTLE_TRANSLATIONS
  };
}

/**
 * @param {any} payload
 */
function getPayloadSegmentCount(payload = {}) {
  return Array.isArray(payload.segments) ? payload.segments.length : 0;
}

/**
 * @param {any} payload
 */
function getPayloadCharacterCount(payload = {}) {
  return (Array.isArray(payload.segments) ? payload.segments : [])
    .reduce((total, segment) => total + String(segment?.text || segment?.plainText || '').length, 0);
}

/**
 * @param {any} options
 */
function createRuntimeAggregationService(options = {}) {
  const settings = options.settings || resolveRuntimeAggregationSettings(options);
  const runtimeLogger = options.runtimeLogger || { info() {} };
  const performTranslation = options.performTranslation;
  const createId = options.createId;
  const buildSegmentMetadataIndex = options.buildSegmentMetadataIndex;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (typeof performTranslation !== 'function' || typeof createId !== 'function' || typeof buildSegmentMetadataIndex !== 'function') {
    throw new TypeError('Aggregation translation, id, and metadata dependencies are required.');
  }
  const aggregateJobs = new Map();
  const aggregateGroups = new Map();
  const aggregateGroupHealth = new Map();
  let activeAggregateJobs = 0;
  const aggregateQuietWindowMs = settings.quietWindowMs;
  const aggregateMaxBufferedRequests = settings.maxBufferedRequests;
  const aggregateMaxBufferedSegments = settings.maxBufferedSegments;
  const aggregateMaxBufferedCharacters = settings.maxBufferedCharacters;
  const aggregateDeadlineMs = settings.deadlineMs;
  const aggregateResultWaitMaxMs = settings.resultWaitMaxMs;
  const aggregateSoftDeadlineMs = settings.softDeadlineMs;
  const aggregateHardDeadlineMs = settings.hardDeadlineMs;
  const aggregateRescueBatchSize = settings.rescueBatchSize;
  const aggregateRescueConcurrency = settings.rescueConcurrency;
  const aggregateRescueSingleTimeoutMs = settings.rescueSingleTimeoutMs;
  const aggregateRescueCollectWindowMs = settings.rescueCollectWindowMs;
  const aggregateRescueMinSettleTranslations = settings.rescueMinSettleTranslations;

  /**
   * @param {any} value
   */
  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  /**
   * @param {any} payload
   */
  function createAggregationGroupId(payload = {}) {
    const metadata = normalizeMemoQMetadata(payload.metadata || {});
    const profileResolution = payload.profileResolution || {};
    return [
      String(payload.sourceLanguage || ''),
      String(payload.targetLanguage || ''),
      String(payload.requestType || ''),
      String(profileResolution.profileId || ''),
      String(metadata.projectGuid || ''),
      String(metadata.documentId || ''),
      String(metadata.projectId || ''),
      String(metadata.client || ''),
      String(metadata.domain || ''),
      String(metadata.subject || '')
    ].join('|');
  }

  /**
   * @param {any} groupId
   */
  function ensureAggregationGroup(groupId) {
    let group = aggregateGroups.get(groupId);
    if (!group) {
      group = {
        id: groupId,
        entries: [],
        quietTimer: null,
        deadlineTimer: null,
        flushing: false,
        createdAtMs: Date.now()
      };
      aggregateGroups.set(groupId, group);
    }
    return group;
  }

  /**
   * @param {any} groupId
   */
  function getAggregateGroupHealth(groupId) {
    let health = aggregateGroupHealth.get(groupId);
    if (!health) {
      health = {
        congested: false,
        stableCompletions: 0,
        slowEvents: 0,
        lastReason: '',
        updatedAtMs: 0
      };
      aggregateGroupHealth.set(groupId, health);
    }
    return health;
  }

  /**
   * @param {any} groupId
   * @param {any} reason
   */
  function markAggregateGroupCongested(groupId, reason) {
    const health = getAggregateGroupHealth(groupId);
    health.congested = true;
    health.stableCompletions = 0;
    health.slowEvents += 1;
    health.lastReason = reason;
    health.updatedAtMs = Date.now();
  }

  /**
   * @param {any} groupId
   */
  function markAggregateGroupStable(groupId) {
    const health = getAggregateGroupHealth(groupId);
    if (!health.congested) {
      return;
    }
    health.stableCompletions += 1;
    health.updatedAtMs = Date.now();
    if (health.stableCompletions >= DEFAULT_AGGREGATE_CONGESTION_RECOVERY_SUCCESSES) {
      health.congested = false;
      health.stableCompletions = 0;
      health.lastReason = 'recovered';
    }
  }

  /**
   * @param {any} groupId
   */
  function getAggregateBufferLimits(groupId) {
    const health = getAggregateGroupHealth(groupId);
    if (health.congested) {
      return {
        mode: 'congested',
        maxBufferedRequests: DEFAULT_AGGREGATE_CONGESTED_MAX_BUFFERED_REQUESTS,
        maxBufferedSegments: DEFAULT_AGGREGATE_CONGESTED_MAX_BUFFERED_SEGMENTS,
        maxBufferedCharacters: DEFAULT_AGGREGATE_CONGESTED_MAX_BUFFERED_CHARACTERS,
        reason: health.lastReason || 'congestion'
      };
    }
    return {
      mode: 'normal',
      maxBufferedRequests: aggregateMaxBufferedRequests,
      maxBufferedSegments: aggregateMaxBufferedSegments,
      maxBufferedCharacters: aggregateMaxBufferedCharacters,
      reason: ''
    };
  }

  /**
   * @param {any} group
   */
  function clearAggregationTimers(group) {
    if (group.quietTimer) {
      clearTimeout(group.quietTimer);
      group.quietTimer = null;
    }
    if (group.deadlineTimer) {
      clearTimeout(group.deadlineTimer);
      group.deadlineTimer = null;
    }
  }

  /**
   * @param {any} entry
   */
  function scheduleAggregateJobCleanup(entry) {
    const cleanupTimer = setTimeout(() => {
      if (aggregateJobs.get(entry.jobRequestId) === entry) {
        aggregateJobs.delete(entry.jobRequestId);
      }
    }, 5 * 60 * 1000);
    cleanupTimer.unref?.();
  }

  /**
   * @param {any} group
   * @param {any} reason
   */
  function scheduleAggregationFlush(group, reason = 'quiet_window') {
    if (group.flushing) {
      return;
    }

    const totalSegments = group.entries.reduce((total, entry) => total + entry.segmentCount, 0);
    const totalCharacters = group.entries.reduce((total, entry) => total + entry.characterCount, 0);
    const limits = getAggregateBufferLimits(group.id);
    const thresholdReason = group.entries.length >= limits.maxBufferedRequests
      ? 'request_threshold'
      : totalSegments >= limits.maxBufferedSegments
        ? 'segment_threshold'
        : totalCharacters >= limits.maxBufferedCharacters
          ? 'character_threshold'
          : '';
    if (thresholdReason) {
      clearAggregationTimers(group);
      void flushAggregationGroup(group.id, thresholdReason);
      return;
    }

    if (group.quietTimer) {
      clearTimeout(group.quietTimer);
    }
    group.quietTimer = setTimeout(() => flushAggregationGroup(group.id, reason), aggregateQuietWindowMs);

    if (!group.deadlineTimer) {
      group.deadlineTimer = setTimeout(() => flushAggregationGroup(group.id, 'deadline'), aggregateDeadlineMs);
    }
  }

  /**
   * @param {any} entries
   */
  function buildAggregatePayload(entries) {
    const firstPayload = entries[0]?.payload || {};
    const aggregatePayload = cloneJson(firstPayload);
    const combinedSegments = [];
    const combinedMetadata = [];
    const mappings = new Map();
    let nextIndex = 0;

    for (const entry of entries) {
      const metadata = normalizeMemoQMetadata(entry.payload.metadata || {});
      const metadataByIndex = buildSegmentMetadataIndex(metadata.segmentLevelMetadata);
      for (const [localPosition, segment] of (entry.payload.segments || []).entries()) {
        const originalIndex = Number.isFinite(Number(segment?.index)) ? Number(segment.index) : localPosition;
        const aggregateIndex = nextIndex;
        nextIndex += 1;
        combinedSegments.push({
          ...cloneJson(segment),
          index: aggregateIndex
        });
        const segmentMetadata = normalizeSegmentMetadataItem(metadataByIndex.get(originalIndex) || {}, aggregateIndex);
        combinedMetadata.push({
          ...segmentMetadata,
          segmentIndex: aggregateIndex
        });
        mappings.set(aggregateIndex, {
          entry,
          originalIndex
        });
      }
    }

    aggregatePayload.requestId = createId('agg');
    aggregatePayload.traceId = createId('trace');
    aggregatePayload.profileResolution = cloneJson(firstPayload.profileResolution || {});
    aggregatePayload.metadata = {
      ...cloneJson(firstPayload.metadata || {}),
      segmentLevelMetadata: combinedMetadata
    };
    aggregatePayload.segments = combinedSegments;
    aggregatePayload.aggregation = {
      enabled: true,
      groupId: entries[0]?.groupId || '',
      requestCount: entries.length,
      originalRequestIds: entries.map((entry) => entry.requestId)
    };

    return { aggregatePayload, mappings };
  }

  /**
   * @param {any} job
   * @param {any} settleMode
   */
  function maybeCloseAggregateJob(job, settleMode = 'normal') {
    if (!job || job.closed || job.entries.some((entry) => !entry.settled)) {
      return;
    }
    job.closed = true;
    if (job.softTimer) {
      clearTimeout(job.softTimer);
      job.softTimer = null;
    }
    if (job.hardTimer) {
      clearTimeout(job.hardTimer);
      job.hardTimer = null;
    }
    activeAggregateJobs = Math.max(0, activeAggregateJobs - 1);
    job.closedBy = settleMode;
  }

  /**
   * @param {any} entry
   * @param {any} result
   * @param {any} settleMode
   */
  function settleAggregateEntry(entry, result, settleMode = 'normal') {
    if (!entry || entry.settled) {
      return false;
    }
    entry.settled = true;
    entry.settledAtMs = Date.now();
    entry.settleMode = settleMode;
    entry.result = result;
    entry.resolve(result);
    scheduleAggregateJobCleanup(entry);
    maybeCloseAggregateJob(entry.aggregateJob, settleMode);
    return true;
  }

  /**
   * @param {any} entry
   * @param {any} reason
   */
  function buildAggregateTimeoutResult(entry, reason) {
    const fallbackState = entry.fallbackState || (entry.fallbackStarted ? 'fallback_in_progress' : 'fallback_not_started');
    return {
      statusCode: 504,
      body: {
        success: false,
        requestId: entry.requestId,
        traceId: entry.traceId,
        jobRequestId: entry.jobRequestId,
        aggregationGroupId: entry.groupId,
        pending: false,
        partial: false,
        error: {
          code: 'AGGREGATE_HARD_TIMEOUT',
          message: `Aggregated translation exceeded the ${aggregateHardDeadlineMs} ms service deadline.`
        },
        aggregation: {
          groupId: entry.groupId,
          flushReason: entry.aggregateJob?.flushReason || '',
          settleMode: 'hard_timeout',
          timeoutReason: reason,
          requestCount: entry.aggregateJob?.entries?.length || 1,
          segmentCount: entry.aggregateJob?.segmentCount || entry.segmentCount,
          queuedMs: Date.now() - entry.enqueuedAtMs,
          jobAgeMs: entry.aggregateJob ? Date.now() - entry.aggregateJob.startedAtMs : Date.now() - entry.enqueuedAtMs,
          fallbackState,
          rescueMode: entry.rescueMode || '',
          rescueBatchSize: Number(entry.rescueBatchSize || 0),
          rescueConcurrency: Number(entry.rescueConcurrency || 0),
          singleAttemptTimeoutMs: Number(entry.rescueSingleTimeoutMs || 0)
        },
        translations: []
      }
    };
  }

  /**
   * @param {any} response
   */
  function getFallbackProviderQueuedMs(response) {
    const body = response?.body || {};
    return Number(body.providerQueuedMs || body.aggregation?.providerQueuedMs || 0);
  }

  /**
   * @param {any} entry
   * @param {any} rescueResult
   * @param {any} reason
   */
  function buildRescueFallbackResult(entry, rescueResult, reason) {
    const translations = Array.isArray(rescueResult.translations) ? rescueResult.translations : [];
    const missingCount = Math.max(0, entry.segmentCount - translations.length);
    const hasTranslations = translations.length > 0;
    const error = rescueResult.error || (missingCount > 0 ? {
      code: ERROR_CODES.translationFailed,
      message: 'Translation failed for one or more rescue segments.'
    } : null);

    return {
      statusCode: hasTranslations ? 200 : (rescueResult.statusCode || 502),
      body: {
        success: hasTranslations,
        requestId: entry.requestId,
        traceId: entry.traceId,
        jobRequestId: entry.jobRequestId,
        aggregationGroupId: entry.groupId,
        providerId: rescueResult.providerId || '',
        model: rescueResult.model || '',
        pending: false,
        partial: missingCount > 0 || Boolean(error),
        error,
        profileResolution: rescueResult.profileResolution || null,
        aggregation: {
          groupId: entry.groupId,
          flushReason: entry.aggregateJob?.flushReason || '',
          settleMode: 'rescue',
          fallbackReason: reason,
          fallbackState: entry.fallbackState || 'fallback_completed',
          rescueMode: entry.rescueMode || 'single_segment_fast',
          rescueBatchSize: Number(entry.rescueBatchSize || aggregateRescueBatchSize),
          rescueConcurrency: Number(entry.rescueConcurrency || aggregateRescueConcurrency),
          singleAttemptTimeoutMs: Number(entry.rescueSingleTimeoutMs || aggregateRescueSingleTimeoutMs),
          firstSuccessMs: Number(entry.firstRescueSuccessAtMs && entry.fallbackStartedAtMs ? entry.firstRescueSuccessAtMs - entry.fallbackStartedAtMs : 0),
          providerQueuedMs: Number(rescueResult.providerQueuedMs || 0),
          requestCount: entry.aggregateJob?.entries?.length || 1,
          segmentCount: entry.aggregateJob?.segmentCount || entry.segmentCount,
          queuedMs: Date.now() - entry.enqueuedAtMs,
          jobAgeMs: entry.aggregateJob ? Date.now() - entry.aggregateJob.startedAtMs : Date.now() - entry.enqueuedAtMs
        },
        translations
      }
    };
  }

  /**
   * @param {any} entry
   * @param {any} reason
   */
  async function settleAggregateEntryWithRescue(entry, reason = 'soft_deadline') {
    if (!entry || entry.settled || entry.fallbackStarted) {
      return false;
    }
    entry.fallbackStarted = true;
    entry.fallbackState = 'fallback_in_progress';
    entry.fallbackStartedAtMs = Date.now();
    entry.rescueMode = 'single_segment_fast';
    entry.rescueBatchSize = 1;
    entry.rescueConcurrency = aggregateRescueConcurrency;
    entry.rescueSingleTimeoutMs = aggregateRescueSingleTimeoutMs;
    markAggregateGroupCongested(entry.groupId, reason);
    runtimeLogger.info('aggregate-fallback-start', 'Aggregate fallback started.', {
      groupId: entry.groupId,
      reason,
      requestId: entry.requestId,
      segmentCount: entry.segmentCount,
      rescueMode: entry.rescueMode,
      rescueBatchSize: entry.rescueBatchSize,
      rescueConcurrency: entry.rescueConcurrency,
      singleAttemptTimeoutMs: entry.rescueSingleTimeoutMs,
      providerQueuedMs: 0,
      fallbackState: entry.fallbackState
    });

    const translationsByIndex = new Map();
    let providerQueuedMs = 0;
    /** @type {Record<string, any> | null} */
    let lastError = null;
    let lastStatusCode = 502;
    let providerId = '';
    let model = '';
    /** @type {Record<string, any> | null} */
    let profileResolution = null;
    const segments = Array.isArray(entry.payload.segments) ? entry.payload.segments : [];
    let nextSegmentIndex = 0;
    let completedSegments = 0;
    const activeRescues = new Set();

    const buildResult = () => ({
      statusCode: lastStatusCode,
      translations: Array.from(translationsByIndex.values()).sort((/** @type {any} */ left, /** @type {any} */ right) => left.index - right.index),
      error: lastError,
      providerQueuedMs,
      providerId,
      model,
      profileResolution
    });

    const runSingleRescue = async (segment, sequence) => {
      const originalIndex = Number.isFinite(Number(segment?.index)) ? Number(segment.index) : sequence;
      const rescuePayload = {
        ...cloneJson(entry.payload),
        requestId: `${entry.requestId}_rescue_${originalIndex}_${sequence + 1}`,
        traceId: entry.traceId,
        bypassAggregation: true,
        aggregation: {
          ...(entry.payload.aggregation || {}),
          fallbackFromAggregate: true,
          fallbackReason: reason,
          groupId: entry.groupId,
          jobRequestId: entry.jobRequestId,
          rescue: true,
          forceSingle: true,
          rescueMode: entry.rescueMode,
          rescueBatchSize: entry.rescueBatchSize,
          rescueConcurrency: entry.rescueConcurrency,
          singleAttemptTimeoutMs: entry.rescueSingleTimeoutMs
        },
        segments: [segment]
      };

      try {
        const rescueResponse = await performTranslation(rescuePayload);
        const body = rescueResponse?.body || {};
        lastStatusCode = Number(rescueResponse?.statusCode || lastStatusCode);
        providerQueuedMs += getFallbackProviderQueuedMs(rescueResponse);
        providerId = providerId || body.providerId || '';
        model = model || body.model || '';
        profileResolution = profileResolution || body.profileResolution || null;
        if (body.error) {
          lastError = body.error;
        }
        for (const translation of (Array.isArray(body.translations) ? body.translations : [])) {
          const translatedIndex = Number(translation.index);
          if (!translationsByIndex.has(translatedIndex)) {
            translationsByIndex.set(translatedIndex, {
              index: translatedIndex,
              text: translation.text
            });
          }
        }
        if (translationsByIndex.size > 0 && !entry.firstRescueSuccessAtMs) {
          entry.firstRescueSuccessAtMs = Date.now();
          entry.fallbackState = 'partial_available';
        }
      } catch (/** @type {any} */ error) {
        const mappedError = mapProviderError(error);
        lastError = {
          code: mappedError.code || ERROR_CODES.translationFailed,
          message: mappedError.message || error.message || 'Aggregate single-segment rescue failed.'
        };
      } finally {
        completedSegments += 1;
      }
    };

    const launchMore = () => {
      while (!entry.settled && activeRescues.size < aggregateRescueConcurrency && nextSegmentIndex < segments.length) {
        const targetTranslations = Math.min(aggregateRescueMinSettleTranslations, entry.segmentCount);
        if (translationsByIndex.size > 0 && translationsByIndex.size + activeRescues.size >= targetTranslations) {
          break;
        }
        const sequence = nextSegmentIndex;
        const segment = segments[nextSegmentIndex];
        nextSegmentIndex += 1;
        const rescuePromise = runSingleRescue(segment, sequence)
          .finally(() => {
            activeRescues.delete(rescuePromise);
          });
        activeRescues.add(rescuePromise);
      }
    };

    try {
      launchMore();
      while (!entry.settled && (activeRescues.size > 0 || nextSegmentIndex < segments.length)) {
        if (translationsByIndex.size > 0) {
          const firstSuccessAgeMs = Date.now() - entry.firstRescueSuccessAtMs;
          if (
            translationsByIndex.size >= Math.min(aggregateRescueMinSettleTranslations, entry.segmentCount)
            || firstSuccessAgeMs >= aggregateRescueCollectWindowMs
            || completedSegments >= segments.length
          ) {
            break;
          }
          const remainingCollectMs = Math.max(0, aggregateRescueCollectWindowMs - firstSuccessAgeMs);
          await Promise.race([
            ...activeRescues,
            sleep(remainingCollectMs)
          ]);
        } else if (activeRescues.size > 0) {
          await Promise.race(activeRescues);
        } else {
          break;
        }
        launchMore();
      }

      if (!translationsByIndex.size) {
        entry.fallbackState = 'fallback_failed';
        entry.fallbackError = lastError || { code: ERROR_CODES.translationFailed, message: 'Aggregate rescue did not return any translations.' };
        runtimeLogger.info('aggregate-fallback-complete', 'Aggregate fallback completed without translations.', {
          groupId: entry.groupId,
          requestId: entry.requestId,
          successCount: 0,
          missingCount: entry.segmentCount,
          fallbackCount: 1,
          settleMode: 'rescue',
          providerQueuedMs,
          fallbackState: entry.fallbackState,
          rescueMode: entry.rescueMode,
          rescueConcurrency: entry.rescueConcurrency,
          singleAttemptTimeoutMs: entry.rescueSingleTimeoutMs
        });
        return false;
      }

      entry.fallbackState = translationsByIndex.size >= entry.segmentCount ? 'fallback_completed' : 'partial_available';
      entry.fallbackCompletedAtMs = Date.now();
      const rescueResult = buildResult();
      const settled = settleAggregateEntry(entry, buildRescueFallbackResult(entry, rescueResult, reason), 'rescue');
      runtimeLogger.info('aggregate-fallback-complete', 'Aggregate fallback completed.', {
        groupId: entry.groupId,
        requestId: entry.requestId,
        successCount: rescueResult.translations.length,
        missingCount: Math.max(0, entry.segmentCount - rescueResult.translations.length),
        fallbackCount: 1,
        settleMode: settled ? 'rescue' : 'late_ignored',
        providerQueuedMs,
        fallbackState: entry.fallbackState,
        rescueMode: entry.rescueMode,
        rescueConcurrency: entry.rescueConcurrency,
        singleAttemptTimeoutMs: entry.rescueSingleTimeoutMs,
        firstSuccessMs: Number(entry.firstRescueSuccessAtMs ? entry.firstRescueSuccessAtMs - entry.fallbackStartedAtMs : 0)
      });
      return settled;
    } catch (/** @type {any} */ error) {
      const mappedError = mapProviderError(error);
      entry.fallbackState = 'fallback_failed';
      entry.fallbackError = {
        code: mappedError.code || ERROR_CODES.translationFailed,
        message: mappedError.message || error.message || 'Aggregate rescue failed.'
      };
      runtimeLogger.info('aggregate-fallback-complete', 'Aggregate fallback failed.', {
        groupId: entry.groupId,
        requestId: entry.requestId,
        successCount: 0,
        missingCount: entry.segmentCount,
        fallbackCount: 1,
        settleMode: 'rescue',
        providerQueuedMs,
        fallbackState: entry.fallbackState,
        rescueMode: entry.rescueMode,
        rescueConcurrency: entry.rescueConcurrency,
        singleAttemptTimeoutMs: entry.rescueSingleTimeoutMs,
        error: entry.fallbackError.message
      });
      return false;
    }
  }

  /**
   * @param {any} entries
   * @param {any} aggregateResponse
   * @param {any} mappings
   * @param {any} flushReason
   */
  function resolveAggregateEntriesFromResponse(entries, aggregateResponse, mappings, flushReason) {
    const body = aggregateResponse?.body || {};
    const translationsByEntry = new Map(entries.map((entry) => [entry.jobRequestId, []]));
    let successCount = 0;
    let missingCountTotal = 0;
    let fallbackCount = 0;
    let lateIgnoredCount = 0;
    for (const translation of body.translations || []) {
      const mapping = mappings.get(Number(translation.index));
      if (!mapping) {
        continue;
      }
      translationsByEntry.get(mapping.entry.jobRequestId).push({
        index: mapping.originalIndex,
        text: translation.text
      });
    }

    for (const entry of entries) {
      if (entry.settled) {
        lateIgnoredCount += 1;
        continue;
      }
      const translations = translationsByEntry.get(entry.jobRequestId) || [];
      const missingCount = Math.max(0, entry.segmentCount - translations.length);
      const hasTranslations = translations.length > 0;
      successCount += translations.length;
      missingCountTotal += missingCount;
      if (missingCount > 0 || body.partial) {
        fallbackCount += 1;
      }
      const responseBody = {
        success: hasTranslations || body.success === true,
        requestId: entry.requestId,
        traceId: entry.traceId,
        jobRequestId: entry.jobRequestId,
        aggregationGroupId: entry.groupId,
        providerId: body.providerId || '',
        model: body.model || '',
        partial: Boolean(body.partial || missingCount > 0),
        error: body.error || (missingCount > 0 ? {
          code: ERROR_CODES.translationFailed,
          message: 'Translation failed for one or more aggregated segments.'
        } : null),
        profileResolution: body.profileResolution || null,
        aggregation: {
          groupId: entry.groupId,
          flushReason,
          settleMode: 'normal',
          requestCount: entries.length,
          segmentCount: entries.reduce((total, item) => total + item.segmentCount, 0),
          queuedMs: Date.now() - entry.enqueuedAtMs
        },
        translations
      };

      if (!hasTranslations && body.success === false) {
        responseBody.success = false;
      }

      entry.result = {
        statusCode: responseBody.success ? 200 : (aggregateResponse?.statusCode || 502),
        body: responseBody
      };
      settleAggregateEntry(entry, entry.result, 'normal');
    }

    return { successCount, missingCount: missingCountTotal, fallbackCount, lateIgnoredCount };
  }

  /**
   * @param {any} groupId
   * @param {any} flushReason
   */
  async function flushAggregationGroup(groupId, flushReason = 'quiet_window') {
    const group = aggregateGroups.get(groupId);
    if (!group || group.flushing) {
      return;
    }

    group.flushing = true;
    clearAggregationTimers(group);
    aggregateGroups.delete(groupId);
    const entries = group.entries.slice();
    if (!entries.length) {
      return;
    }

    const startedAtMs = Date.now();
    const limits = getAggregateBufferLimits(groupId);
    const aggregateJob = {
      groupId,
      entries,
      startedAtMs,
      flushReason,
      segmentCount: entries.reduce((total, entry) => total + entry.segmentCount, 0),
      /** @type {NodeJS.Timeout | null} */
      softTimer: null,
      /** @type {NodeJS.Timeout | null} */
      hardTimer: null,
      closed: false,
      closedBy: ''
    };
    for (const entry of entries) {
      entry.aggregateJob = aggregateJob;
    }
    activeAggregateJobs += 1;
    aggregateJob.softTimer = setTimeout(() => {
      markAggregateGroupCongested(groupId, 'soft_deadline');
      for (const entry of entries) {
        if (!entry.settled) {
          void settleAggregateEntryWithRescue(entry, 'soft_deadline');
        }
      }
    }, aggregateSoftDeadlineMs);
    aggregateJob.softTimer?.unref?.();
    aggregateJob.hardTimer = setTimeout(() => {
      markAggregateGroupCongested(groupId, 'hard_deadline');
      for (const entry of entries) {
        if (!entry.settled) {
          settleAggregateEntry(entry, buildAggregateTimeoutResult(entry, 'hard_deadline'), 'hard_timeout');
        }
      }
    }, aggregateHardDeadlineMs);
    aggregateJob.hardTimer?.unref?.();

    try {
      const { aggregatePayload, mappings } = buildAggregatePayload(entries);
      const segmentCount = getPayloadSegmentCount(aggregatePayload);
      const characterCount = getPayloadCharacterCount(aggregatePayload);
      runtimeLogger.info('aggregate-flush', 'Aggregate request group flushed.', {
        groupId,
        requestCount: entries.length,
        segmentCount,
        characterCount,
        flushReason,
        activeJobs: activeAggregateJobs,
        congestionMode: limits.mode
      });
      const aggregateResponse = await performTranslation(aggregatePayload);
      const summary = resolveAggregateEntriesFromResponse(entries, aggregateResponse, mappings, flushReason);
      if (summary.lateIgnoredCount > 0) {
        runtimeLogger.info('aggregate-complete', 'Aggregate request completed late.', {
          groupId,
          latencyMs: Date.now() - startedAtMs,
          successCount: 0,
          missingCount: 0,
          fallbackCount: 0,
          settleMode: 'late_ignored',
          lateIgnoredCount: summary.lateIgnoredCount
        });
      }
      if (
        summary.lateIgnoredCount === 0
        && summary.missingCount === 0
        && summary.fallbackCount === 0
        && Date.now() - startedAtMs < aggregateSoftDeadlineMs
      ) {
        markAggregateGroupStable(groupId);
      }
      if (summary.lateIgnoredCount < entries.length) {
        runtimeLogger.info('aggregate-complete', 'Aggregate request completed.', {
          groupId,
          latencyMs: Date.now() - startedAtMs,
          successCount: summary.successCount,
          missingCount: summary.missingCount,
          fallbackCount: summary.fallbackCount,
          settleMode: 'normal'
        });
      }
    } catch (/** @type {any} */ error) {
      const mappedError = mapProviderError(error);
      const segmentCount = entries.reduce((total, entry) => total + entry.segmentCount, 0);
      runtimeLogger.info('aggregate-complete', 'Aggregate request failed.', {
        groupId,
        latencyMs: Date.now() - startedAtMs,
        successCount: 0,
        missingCount: segmentCount,
        fallbackCount: entries.length,
        settleMode: 'normal',
        error: mappedError.message || error.message || 'Aggregated translation failed.'
      });
      for (const entry of entries) {
        if (entry.settled) {
          continue;
        }
        const result = {
          statusCode: 502,
          body: {
            success: false,
            requestId: entry.requestId,
            traceId: entry.traceId,
            jobRequestId: entry.jobRequestId,
            aggregationGroupId: entry.groupId,
            error: {
              code: mappedError.code || ERROR_CODES.translationFailed,
              message: mappedError.message || error.message || 'Aggregated translation failed.'
            },
            translations: []
          }
        };
        settleAggregateEntry(entry, result, 'normal');
      }
    }
  }

  /**
   * @param {any} payload
   */
  async function submitAggregateTranslation(payload = {}) {
    const requestId = payload.requestId || createId('req');
    const traceId = payload.traceId || createId('trace');
    if (String(payload.contractVersion || '') !== CONTRACT_VERSION) {
      return {
        statusCode: 409,
        body: {
          success: false,
          requestId,
          traceId,
          error: { code: ERROR_CODES.contractVersionMismatch, message: `Desktop contract version ${CONTRACT_VERSION} is required.` }
        }
      };
    }

    const jobRequestId = requestId || createId('agg_job');
    if (aggregateJobs.has(jobRequestId)) {
      const existing = aggregateJobs.get(jobRequestId);
      return {
        statusCode: 200,
        body: {
          success: true,
          requestId,
          traceId,
          jobRequestId: existing.jobRequestId,
          aggregationGroupId: existing.groupId,
          duplicate: true
        }
      };
    }

    const groupId = createAggregationGroupId(payload);
    const group = ensureAggregationGroup(groupId);
    let resolveResult;
    const resultPromise = new Promise((resolve) => {
      resolveResult = resolve;
    });
    const entry = {
      jobRequestId,
      requestId,
      traceId,
      groupId,
      payload: {
        ...cloneJson(payload),
        requestId,
        traceId
      },
      segmentCount: getPayloadSegmentCount(payload),
      characterCount: getPayloadCharacterCount(payload),
      enqueuedAtMs: Date.now(),
      result: null,
      settled: false,
      settledAtMs: 0,
      settleMode: '',
      fallbackStarted: false,
      fallbackState: 'fallback_not_started',
      fallbackStartedAtMs: 0,
      fallbackCompletedAtMs: 0,
      fallbackError: null,
      rescueMode: '',
      rescueBatchSize: 0,
      pendingPollCount: 0,
      aggregateJob: null,
      resultPromise,
      resolve: resolveResult
    };

    aggregateJobs.set(jobRequestId, entry);
    group.entries.push(entry);
    const limits = getAggregateBufferLimits(groupId);
    scheduleAggregationFlush(group);

    return {
      statusCode: 200,
      body: {
        success: true,
        requestId,
        traceId,
        jobRequestId,
        aggregationGroupId: groupId,
        aggregation: {
          queued: true,
          groupId,
          congestionMode: limits.mode,
          bufferedRequests: group.entries.length,
          bufferedSegments: group.entries.reduce((total, item) => total + item.segmentCount, 0)
        }
      }
    };
  }

  /**
   * @param {any} payload
   */
  async function waitAggregateTranslation(payload = {}) {
    const jobRequestId = String(payload.jobRequestId || payload.requestId || '').trim();
    const requestId = String(payload.requestId || jobRequestId || createId('req'));
    const traceId = String(payload.traceId || createId('trace'));
    const waitTimeoutMs = Number.isFinite(Number(payload.waitTimeoutMs))
      ? Math.min(aggregateResultWaitMaxMs, Math.max(1, Number(payload.waitTimeoutMs)))
      : DEFAULT_AGGREGATE_RESULT_WAIT_MS;
    const entry = aggregateJobs.get(jobRequestId);

    if (!entry) {
      return {
        statusCode: 404,
        body: {
          success: false,
          requestId,
          traceId,
          jobRequestId,
          pending: false,
          error: { code: 'AGGREGATE_JOB_NOT_FOUND', message: 'Aggregated translation job was not found.' }
        }
      };
    }

    if (entry.result) {
      return entry.result;
    }

    let waitTimer = null;
    const timeoutResult = new Promise((resolve) => {
      waitTimer = setTimeout(() => {
        entry.pendingPollCount = Number(entry.pendingPollCount || 0) + 1;
        const jobAgeMs = entry.aggregateJob ? Date.now() - entry.aggregateJob.startedAtMs : Date.now() - entry.enqueuedAtMs;
        if (entry.pendingPollCount >= 1 || jobAgeMs >= aggregateSoftDeadlineMs) {
          markAggregateGroupCongested(entry.groupId, entry.pendingPollCount >= 1 ? 'pending_polls' : 'pending_soft_deadline');
          if (entry.aggregateJob && !entry.fallbackStarted && !entry.settled) {
            void settleAggregateEntryWithRescue(entry, 'pending_poll');
          }
        }
        runtimeLogger.info('aggregate-pending', 'Aggregate request is still pending.', {
          groupId: entry.groupId,
          requestId: entry.requestId,
          jobRequestId: entry.jobRequestId,
          pendingAttempts: entry.pendingPollCount,
          jobAgeMs,
          activeJobs: activeAggregateJobs,
          fallbackState: entry.fallbackState || 'fallback_not_started'
        });
        resolve({
          statusCode: 202,
          body: {
            success: false,
            requestId,
            traceId,
            jobRequestId,
            aggregationGroupId: entry.groupId,
            pending: true,
            aggregation: {
              groupId: entry.groupId,
              jobAgeMs,
              activeJobs: activeAggregateJobs,
              pendingAttempts: entry.pendingPollCount,
              fallbackState: entry.fallbackState || 'fallback_not_started'
            },
            error: { code: 'TRANSLATION_PENDING', message: 'Aggregated translation is still pending.' }
          }
        });
      }, waitTimeoutMs);
      waitTimer.unref?.();
    });

    const result = await Promise.race([entry.resultPromise, timeoutResult]);
    if (waitTimer) {
      clearTimeout(waitTimer);
    }
    return result;
  }

  /**
   */
  function dispose() {
    for (const group of aggregateGroups.values()) clearAggregationTimers(group);
    aggregateGroups.clear();
    for (const entry of aggregateJobs.values()) {
      if (entry.aggregateJob?.softTimer) clearTimeout(entry.aggregateJob.softTimer);
      if (entry.aggregateJob?.hardTimer) clearTimeout(entry.aggregateJob.hardTimer);
    }
    aggregateJobs.clear();
    aggregateGroupHealth.clear();
  }

  return {
    dispose,
    submit: submitAggregateTranslation,
    wait: waitAggregateTranslation
  };
}

module.exports = {
  createRuntimeAggregationService,
  getPayloadCharacterCount,
  getPayloadSegmentCount,
  resolveRuntimeAggregationSettings
};
