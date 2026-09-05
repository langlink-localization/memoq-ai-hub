const { normalizeHelperWarmupState } = require('./runtimePreviewPolicy');
const {
  createDocumentSummaryCacheKey,
  truncateSummarySourceText
} = require('./runtimeTranslationSupport');

const ACTIVE_PART_ONLY_FALLBACK_GRACE_MS = 250;

/**
 * @param {any} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRuntimePreviewContextResolver({
  providerRegistry,
  secretStore,
  persistence,
  previewContextClient,
  syncPreviewBridgeStatusFromClient,
  previewContextWaitMs,
  previewContextPollMs,
  nowIso
}) {
  /**
   * @param {any} text
   * @param {any} maxCharacters
   */
  function truncateDocumentText(text, maxCharacters = 18000) {
    return truncateSummarySourceText(text, maxCharacters);
  }

  /**
   * @param {any} text
   * @param {any} maxCharacters
   */
  function normalizeDocumentSummaryText(text, maxCharacters = 320) {
    const normalized = String(text || '').trim();
    if (!normalized) {
      return '';
    }

    const flattened = normalized
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/^\s*[A-Za-z][A-Za-z /&-]{1,40}:\s*/gm, '')
      .replace(/\n{2,}/g, '\n')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!flattened) {
      return '';
    }

    return flattened.length > maxCharacters
      ? `${flattened.slice(0, maxCharacters).trim()}...`
      : flattened;
  }

  /**
   * @param {any} segments
   */
  function attachNeighborContexts(segments = []) {
    for (let index = 0; index < segments.length; index += 1) {
      const previous = segments[index - 1] || null;
      const next = segments[index + 1] || null;
      segments[index].neighborContext = {
        previousSegment: previous ? {
          index: previous.index,
          sourceText: previous.sourceText,
          targetText: previous.previewContext?.targetText || ''
        } : null,
        nextSegment: next ? {
          index: next.index,
          sourceText: next.sourceText,
          targetText: next.previewContext?.targetText || ''
        } : null
      };
    }
  }

  async function generateDocumentSummary({
    route,
    secret,
    documentName,
    documentId,
    sourceLanguage,
    targetLanguage,
    fullText
  }) {
    if (!route || !secret || !fullText || typeof providerRegistry.generateText !== 'function') {
      return '';
    }

    const result = await providerRegistry.generateText({
      provider: route.provider,
      apiKey: secret,
      modelName: route.model.modelName,
      systemPrompt: 'You generate concise, single-paragraph document summaries for translation context.',
      prompt: [
        'Summarize this source document for machine-translation context in 1-2 short sentences.',
        `Document name: ${documentName || 'Unknown document'}`,
        `Document ID: ${documentId || 'Unknown document ID'}`,
        `Source language: ${sourceLanguage || 'Unknown'}`,
        `Target language: ${targetLanguage || 'Unknown'}`,
        'Focus on the document domain, audience, required terminology, and any important formatting or structural constraints.',
        'Do not use headings, labels, bullet lists, markdown tables, or code fences.',
        'Do not exceed 320 characters.',
        'Return plain text only.',
        `Source document text:\n${truncateDocumentText(fullText)}`
      ].join('\n\n'),
      maxOutputTokens: 120,
      temperature: 0.1,
      timeoutMs: 120000
    });

    return normalizeDocumentSummaryText(result.text);
  }

  /**
   * @param {any} payload
   * @param {any} incomingSegments
   */
  function isSharedOnlyPreviewMode(payload, incomingSegments = []) {
    const useCase = String(payload?.profileResolution?.useCase || '').trim().toLowerCase();
    const requestType = String(payload?.requestType || '').trim().toLowerCase();
    return incomingSegments.length > 1
      || useCase === 'pretranslate'
      || requestType.includes('pretranslate')
      || requestType.includes('batch');
  }

  /**
   * @param {any} profile
   * @param {any} payload
   * @param {any} incomingSegments
   */
  function buildPreviewFeaturePolicy(profile, payload, incomingSegments = []) {
    const sharedOnly = isSharedOnlyPreviewMode(payload, incomingSegments);
    const includeFullText = profile?.usePreviewFullText === true;
    const includeSummary = profile?.usePreviewSummary === true;
    const wantsLocalContext = profile?.usePreviewAboveBelow === true || profile?.usePreviewTargetText === true;

    return {
      sharedOnly,
      includeFullText,
      includeSummary,
      includeTargetText: !sharedOnly && profile?.usePreviewTargetText === true,
      includeAboveContext: !sharedOnly && profile?.usePreviewAboveBelow === true,
      includeBelowContext: !sharedOnly && profile?.usePreviewAboveBelow === true,
      includeSharedContext: includeFullText || includeSummary,
      wantsLocalContext,
      wantsLocalContextInPrompt: !sharedOnly && wantsLocalContext,
      previewAvailableFeatures: [
        includeFullText ? 'fullText' : '',
        includeSummary ? 'summary' : '',
        !sharedOnly && profile?.usePreviewTargetText === true ? 'targetText' : '',
        !sharedOnly && profile?.usePreviewAboveBelow === true ? 'above' : '',
        !sharedOnly && profile?.usePreviewAboveBelow === true ? 'below' : ''
      ].filter(Boolean),
      reason: sharedOnly && wantsLocalContext ? 'batch_shared_only_mode' : ''
    };
  }

  /**
   * @param {any} previewContext
   * @param {any} lookup
   * @param {any} policy
   * @param {any} summaryDebug
   */
  function buildRequestPreviewDebugContext(previewContext, lookup, policy, summaryDebug = null) {
    if (previewContext) {
      return {
        available: true,
        ...previewContext,
        previewAvailableFeatures: policy.previewAvailableFeatures,
        activePreviewPartIds: Array.isArray(lookup?.activePreviewPartIds) ? lookup.activePreviewPartIds : [],
        previewPartId: String(lookup?.previewPartId || ''),
        previewMatchMode: String(lookup?.previewMatchMode || ''),
        sourceFocusedRange: lookup?.sourceFocusedRange || null,
        targetFocusedRange: lookup?.targetFocusedRange || null,
        neighborSource: String(lookup?.neighborSource || ''),
        targetTextSource: String(lookup?.targetTextSource || ''),
        reason: policy.reason || '',
        summary: summaryDebug
      };
    }

    if (lookup) {
      return {
        available: false,
        documentId: String(lookup.documentId || ''),
        documentName: String(lookup.documentName || ''),
        importPath: String(lookup.importPath || ''),
        previewAvailableFeatures: policy.previewAvailableFeatures,
        activePreviewPartIds: Array.isArray(lookup.activePreviewPartIds) ? lookup.activePreviewPartIds : [],
        previewPartId: String(lookup.previewPartId || ''),
        previewMatchMode: String(lookup.previewMatchMode || ''),
        sourceFocusedRange: lookup.sourceFocusedRange || null,
        targetFocusedRange: lookup.targetFocusedRange || null,
        neighborSource: String(lookup.neighborSource || ''),
        targetTextSource: String(lookup.targetTextSource || ''),
        reason: String(lookup.reason || policy.reason || ''),
        summary: summaryDebug
      };
    }

    if (!policy.previewAvailableFeatures.length && !policy.reason) {
      return null;
    }

    return {
      available: false,
      previewAvailableFeatures: policy.previewAvailableFeatures,
      reason: policy.reason || 'document_not_cached',
      summary: summaryDebug
    };
  }

  /**
   * @param {any} policy
   */
  function createSummaryDebugContext(policy) {
    return {
      requested: policy?.includeSummary === true,
      cacheKey: '',
      cacheHit: false,
      generated: false,
      available: false,
      routeProviderId: '',
      routeProviderName: '',
      routeModel: '',
      skipReason: '',
      error: ''
    };
  }

  /**
   */
  function createPreviewWarmupDebug() {
    return {
      attempted: false,
      timedOut: false,
      waitedMs: 0,
      pollCount: 0,
      coldStart: false,
      helperStateAtStart: '',
      helperStateAtEnd: '',
      documentCacheSeen: false,
      documentCacheUpdatedAt: '',
      resolvedOnPoll: 0,
      activePreviewPartSeen: false,
      focusedRangeSeen: false
    };
  }

  /**
   * @param {any} warmup
   * @param {any} timedOut
   */
  function finalizePreviewWarmupDebug(warmup, timedOut = false) {
    if (!warmup) {
      return null;
    }

    return {
      attempted: Boolean(warmup.attempted),
      timedOut: Boolean(timedOut),
      waitedMs: Math.max(0, Date.now() - Number(warmup.startedAtMs || Date.now())),
      pollCount: Number(warmup.pollCount || 0),
      coldStart: Boolean(warmup.coldStart),
      helperStateAtStart: String(warmup.helperStateAtStart || ''),
      helperStateAtEnd: String(warmup.helperStateAtEnd || warmup.helperStateAtStart || ''),
      documentCacheSeen: Boolean(warmup.documentCacheSeen),
      documentCacheUpdatedAt: String(warmup.documentCacheUpdatedAt || ''),
      resolvedOnPoll: Number(warmup.resolvedOnPoll || 0),
      activePreviewPartSeen: Boolean(warmup.activePreviewPartSeen),
      focusedRangeSeen: Boolean(warmup.focusedRangeSeen)
    };
  }

  function reconcilePreviewWarmupDebug(warmup, {
    requestPreviewContext = null,
    segmentPreviewContexts = new Map()
  } = {}) {
    if (!warmup || warmup.timedOut !== true) {
      return warmup;
    }

    const hasResolvedSharedContext = Boolean(requestPreviewContext);
    const hasResolvedLocalContext = segmentPreviewContexts instanceof Map
      ? segmentPreviewContexts.size > 0
      : Array.isArray(segmentPreviewContexts) && segmentPreviewContexts.length > 0;

    if (!hasResolvedSharedContext && !hasResolvedLocalContext) {
      return warmup;
    }

    return {
      ...warmup,
      timedOut: false,
      resolvedOnPoll: Number(warmup.resolvedOnPoll || warmup.pollCount || 1),
      documentCacheSeen: true
    };
  }

  /**
   * @param {any} _
   */
  function resolvePreviewMissReason({ lookup, policy, warmup, wantsLocalContext = false }) {
    if (lookup?.available) {
      return String(policy?.reason || lookup.reason || '');
    }

    if (warmup?.attempted && warmup.timedOut) {
      if (!warmup.documentCacheSeen) {
        return warmup.helperStateAtEnd === 'connected' || warmup.helperStateAtStart === 'connected'
          ? 'document_cache_not_ready_in_time'
          : 'helper_not_connected_in_time';
      }

      if (wantsLocalContext) {
        if (!warmup.activePreviewPartSeen) {
          return 'active_part_not_ready_in_time';
        }
        if (lookup?.reason === 'segment_not_aligned_with_active_part') {
          return 'segment_not_aligned_with_active_part';
        }
        if (lookup?.reason === 'active_part_without_range' || !warmup.focusedRangeSeen) {
          return 'active_part_without_range';
        }
      }

      return 'preview_warmup_timeout';
    }

    return String(lookup?.reason || policy?.reason || 'document_not_cached');
  }

  /**
   * @param {any} segmentLookup
   * @param {any} policy
   */
  function buildSegmentPreviewDebugContext(segmentLookup, policy) {
    if (segmentLookup) {
      return {
        available: Boolean(segmentLookup.available),
        documentId: String(segmentLookup.documentId || ''),
        documentName: String(segmentLookup.documentName || ''),
        previewPartId: String(segmentLookup.previewPartId || ''),
        activePreviewPartIds: Array.isArray(segmentLookup.activePreviewPartIds) ? segmentLookup.activePreviewPartIds : [],
        previewMatchMode: String(segmentLookup.previewMatchMode || ''),
        sourceFocusedRange: segmentLookup.sourceFocusedRange || null,
        targetFocusedRange: segmentLookup.targetFocusedRange || null,
        neighborSource: String(segmentLookup.neighborSource || ''),
        targetTextSource: String(segmentLookup.targetTextSource || ''),
        targetText: String(segmentLookup.targetText || ''),
        above: String(segmentLookup.aboveText || ''),
        below: String(segmentLookup.belowText || ''),
        resolvedRange: segmentLookup.resolvedRange || null,
        previewAvailableFeatures: policy.previewAvailableFeatures,
        reason: String(segmentLookup.reason || policy.reason || '')
      };
    }

    if (!policy.previewAvailableFeatures.length && !policy.reason) {
      return null;
    }

    return {
      available: false,
      previewAvailableFeatures: policy.previewAvailableFeatures,
      reason: policy.reason || 'segment_not_aligned_with_active_part'
    };
  }

  async function resolvePreviewContexts({
    state,
    routes,
    profile,
    payload,
    normalizedMetadata,
    incomingSegments
  }) {
    syncPreviewBridgeStatusFromClient();
    const previewPolicy = buildPreviewFeaturePolicy(profile, payload, incomingSegments);

    if (
      profile?.usePreviewContext !== true
      || !normalizedMetadata.documentId
      || !payload.sourceLanguage
      || !payload.targetLanguage
      || !previewContextClient
    ) {
      return {
        requestPreviewContext: null,
        requestPreviewDebug: null,
        segmentPreviewContexts: new Map(),
        segmentPreviewDebugContexts: new Map(),
        previewWarmup: null,
        previewPolicy
      };
    }

    /**
     */
    async function waitForPreviewContextCacheReady() {
      const warmup = {
        ...createPreviewWarmupDebug(),
        attempted: true,
        startedAtMs: Date.now()
      };

      if (previewContextWaitMs <= 0 || !previewContextClient) {
        return finalizePreviewWarmupDebug(warmup, false);
      }

      if (!previewPolicy.includeSharedContext && !previewPolicy.wantsLocalContextInPrompt) {
        warmup.attempted = false;
        return finalizePreviewWarmupDebug(warmup, false);
      }

      const helperStatus = previewContextClient?.getStatus?.() || {};
      warmup.helperStateAtStart = normalizeHelperWarmupState(helperStatus);
      warmup.helperStateAtEnd = warmup.helperStateAtStart;
      if (warmup.helperStateAtStart === 'missing') {
        return finalizePreviewWarmupDebug(warmup, false);
      }

      const initialRawDocument = typeof previewContextClient.readDocument === 'function'
        ? previewContextClient.readDocument(
          normalizedMetadata.documentId,
          payload.sourceLanguage,
          payload.targetLanguage
        )
        : null;
      const initialDocumentUpdatedAt = String(initialRawDocument?.updatedAt || '');
      const initialActivePreviewPartIds = Array.isArray(initialRawDocument?.activePreviewPartIds) ? initialRawDocument.activePreviewPartIds : [];
      const initialActiveParts = Array.isArray(initialRawDocument?.parts)
        ? initialRawDocument.parts.filter((part) => initialActivePreviewPartIds.includes(part.previewPartId))
        : [];

      warmup.coldStart = warmup.helperStateAtStart !== 'connected' || !initialRawDocument;
      warmup.documentCacheSeen = Boolean(initialRawDocument);
      warmup.documentCacheUpdatedAt = initialDocumentUpdatedAt;
      warmup.activePreviewPartSeen = initialActiveParts.length > 0;
      warmup.focusedRangeSeen = initialActiveParts.some((part) => part?.sourceFocusedRange || part?.targetFocusedRange);

      const warmupStartedAt = Date.now();
      const deadline = Date.now() + previewContextWaitMs;
      while (Date.now() <= deadline) {
        warmup.pollCount += 1;
        warmup.helperStateAtEnd = normalizeHelperWarmupState(previewContextClient?.getStatus?.() || {});

        const rawDocument = typeof previewContextClient.readDocument === 'function'
          ? previewContextClient.readDocument(
            normalizedMetadata.documentId,
            payload.sourceLanguage,
            payload.targetLanguage
          )
          : null;
        const activePreviewPartIds = Array.isArray(rawDocument?.activePreviewPartIds) ? rawDocument.activePreviewPartIds : [];
        const activeParts = Array.isArray(rawDocument?.parts)
          ? rawDocument.parts.filter((part) => activePreviewPartIds.includes(part.previewPartId))
          : [];
        const hasDocumentCache = Boolean(rawDocument);
        const hasActivePart = activeParts.length > 0;
        const hasActiveFocusedRange = activeParts.some((part) => part?.sourceFocusedRange || part?.targetFocusedRange);
        const documentUpdatedAt = String(rawDocument?.updatedAt || '');
        const hasFreshDocumentCache = hasDocumentCache && (
          !warmup.coldStart
          || !initialRawDocument
          || !initialDocumentUpdatedAt
          || documentUpdatedAt !== initialDocumentUpdatedAt
        );

        warmup.documentCacheSeen = warmup.documentCacheSeen || hasDocumentCache;
        warmup.activePreviewPartSeen = warmup.activePreviewPartSeen || hasActivePart;
        warmup.focusedRangeSeen = warmup.focusedRangeSeen || hasActiveFocusedRange;
        if (documentUpdatedAt) {
          warmup.documentCacheUpdatedAt = documentUpdatedAt;
        }

        const sharedProbe = previewContextClient.getContext({
          documentId: normalizedMetadata.documentId,
          sourceLanguage: payload.sourceLanguage,
          targetLanguage: payload.targetLanguage,
          includeFullText: previewPolicy.includeSharedContext,
          includeSummary: previewPolicy.includeSummary
        });
        if (sharedProbe?.available) {
          warmup.documentCacheSeen = true;
        }

        const sharedReady = previewPolicy.includeSharedContext
          ? (sharedProbe.available || (hasDocumentCache && hasFreshDocumentCache))
          : true;

        if (previewPolicy.wantsLocalContextInPrompt) {
          const allowActivePartOnlyFallback = (Date.now() - warmupStartedAt) >= Math.min(ACTIVE_PART_ONLY_FALLBACK_GRACE_MS, previewContextWaitMs);
          let localReady = false;

          for (const segment of incomingSegments) {
            const previewSegmentIndex = Number.isFinite(Number(segment.segmentMetadata?.segmentIndex))
              ? Number(segment.segmentMetadata.segmentIndex)
              : Number(segment.index);

            const segmentProbe = previewContextClient.getContext({
              documentId: normalizedMetadata.documentId,
              sourceLanguage: payload.sourceLanguage,
              targetLanguage: payload.targetLanguage,
              segmentIndex: previewSegmentIndex,
              sourceText: segment.plainText || segment.sourceText || segment.text || '',
              includeTargetText: previewPolicy.includeTargetText,
              includeAboveContext: previewPolicy.includeAboveContext,
              includeBelowContext: previewPolicy.includeBelowContext,
              aboveOptions: {
                maxSegments: profile.previewAboveSegments,
                maxChars: profile.previewAboveCharacters,
                includeSource: profile.previewAboveIncludeSource === true,
                includeTarget: profile.previewAboveIncludeTarget === true
              },
              belowOptions: {
                maxSegments: profile.previewBelowSegments,
                maxChars: profile.previewBelowCharacters,
                includeSource: profile.previewBelowIncludeSource === true,
                includeTarget: profile.previewBelowIncludeTarget === true
              }
            });

            warmup.documentCacheSeen = warmup.documentCacheSeen || Boolean(segmentProbe?.available);
            warmup.activePreviewPartSeen = warmup.activePreviewPartSeen
              || (Array.isArray(segmentProbe?.activePreviewPartIds) && segmentProbe.activePreviewPartIds.length > 0);
            warmup.focusedRangeSeen = warmup.focusedRangeSeen
              || Boolean(segmentProbe?.hasFocusedRange || segmentProbe?.sourceFocusedRange || segmentProbe?.targetFocusedRange);

            if (
              segmentProbe.available
              && (
                segmentProbe.hasFocusedRange
                || typeof previewContextClient.readDocument !== 'function'
              )
            ) {
              localReady = true;
              break;
            }

            if (
              allowActivePartOnlyFallback
              && (
                segmentProbe.available
                || (
                  hasDocumentCache
                  && hasFreshDocumentCache
                  && hasActivePart
                )
                || segmentProbe.reason === 'active_part_without_range'
                || segmentProbe.reason === 'segment_not_aligned_with_active_part'
              )
            ) {
              localReady = true;
              break;
            }
          }

          if (!localReady && incomingSegments.length === 0 && hasDocumentCache && hasFreshDocumentCache && (hasActiveFocusedRange || allowActivePartOnlyFallback)) {
            localReady = true;
          }

          if (localReady) {
            warmup.resolvedOnPoll = warmup.pollCount;
            return finalizePreviewWarmupDebug(warmup, false);
          }
        } else if (sharedReady) {
          warmup.resolvedOnPoll = warmup.pollCount;
          return finalizePreviewWarmupDebug(warmup, false);
        }

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          warmup.helperStateAtEnd = normalizeHelperWarmupState(previewContextClient?.getStatus?.() || {});
          return finalizePreviewWarmupDebug(warmup, true);
        }

        await sleep(Math.min(previewContextPollMs, remainingMs));
      }

      warmup.helperStateAtEnd = normalizeHelperWarmupState(previewContextClient?.getStatus?.() || {});
      return finalizePreviewWarmupDebug(warmup, true);
    }

    let previewWarmup = await waitForPreviewContextCacheReady();

    let requestPreviewContext = null;
    let requestPreviewDebug = null;
    const segmentPreviewContexts = new Map();
    const segmentPreviewDebugContexts = new Map();

    const sharedLookup = previewContextClient.getContext({
      documentId: normalizedMetadata.documentId,
      sourceLanguage: payload.sourceLanguage,
      targetLanguage: payload.targetLanguage,
      includeFullText: previewPolicy.includeSharedContext,
      includeSummary: previewPolicy.includeSummary
    });

    if (sharedLookup.available) {
      requestPreviewContext = {
        documentId: sharedLookup.documentId || normalizedMetadata.documentId,
        documentName: sharedLookup.documentName || '',
        importPath: sharedLookup.importPath || '',
        fullText: previewPolicy.includeFullText === true ? String(sharedLookup.fullText || '') : '',
        summary: ''
      };
    }

    const summaryDebug = createSummaryDebugContext(previewPolicy);

    if (!summaryDebug.requested) {
      summaryDebug.skipReason = 'summary_disabled';
    } else if (!sharedLookup.available) {
      summaryDebug.skipReason = 'preview_unavailable';
    } else if (!sharedLookup.fullText) {
      summaryDebug.skipReason = 'full_text_unavailable';
    }

    if (previewPolicy.includeSummary === true && sharedLookup.available && sharedLookup.fullText) {
      const summarizationRoute = routes.find((candidate) => secretStore.has(candidate.provider.secretRef));
      if (summarizationRoute) {
        const secret = await secretStore.get(summarizationRoute.provider.secretRef);
        const summaryCacheKey = createDocumentSummaryCacheKey({
          providerId: summarizationRoute.provider.id,
          modelName: summarizationRoute.model.modelName,
          documentId: normalizedMetadata.documentId,
          sourceLanguage: payload.sourceLanguage,
          targetLanguage: payload.targetLanguage,
          fullText: sharedLookup.fullText
        });
        summaryDebug.cacheKey = summaryCacheKey;
        summaryDebug.routeProviderId = String(summarizationRoute.provider.id || '');
        summaryDebug.routeProviderName = String(summarizationRoute.provider.name || '');
        summaryDebug.routeModel = String(summarizationRoute.model.modelName || '');

        let summary = normalizeDocumentSummaryText(persistence.readDocumentSummaryCache(summaryCacheKey));
        summaryDebug.cacheHit = Boolean(summary);
        if (!summary) {
          try {
            summary = await generateDocumentSummary({
              route: summarizationRoute,
              secret,
              documentName: sharedLookup.documentName,
              documentId: normalizedMetadata.documentId,
              sourceLanguage: payload.sourceLanguage,
              targetLanguage: payload.targetLanguage,
              fullText: sharedLookup.fullText
            });
            summaryDebug.generated = Boolean(summary);
          } catch {
            summary = '';
            summaryDebug.error = 'summary_generation_failed';
          }

          if (summary) {
            persistence.writeDocumentSummaryCache(summaryCacheKey, summary, nowIso());
          }
        }

        if (requestPreviewContext) {
          requestPreviewContext.summary = summary;
        }
        summaryDebug.available = Boolean(summary);
        if (!summaryDebug.cacheHit && !summaryDebug.generated && !summaryDebug.error && !summary) {
          summaryDebug.skipReason = 'summary_empty';
        }
      } else {
        summaryDebug.skipReason = 'no_summary_route';
      }
    }

    requestPreviewDebug = buildRequestPreviewDebugContext(requestPreviewContext, sharedLookup, previewPolicy, summaryDebug);
    if (requestPreviewDebug && !requestPreviewDebug.available) {
      requestPreviewDebug.reason = resolvePreviewMissReason({
        lookup: requestPreviewDebug,
        policy: previewPolicy,
        warmup: previewWarmup,
        wantsLocalContext: previewPolicy.wantsLocalContextInPrompt
      });
    }

    for (const segment of incomingSegments) {
      if (!previewPolicy.wantsLocalContextInPrompt) {
        segmentPreviewDebugContexts.set(segment.index, buildSegmentPreviewDebugContext(null, previewPolicy));
        continue;
      }

      const previewSegmentIndex = Number.isFinite(Number(segment.segmentMetadata?.segmentIndex))
        ? Number(segment.segmentMetadata.segmentIndex)
        : Number(segment.index);

      const segmentLookup = previewContextClient.getContext({
        documentId: normalizedMetadata.documentId,
        sourceLanguage: payload.sourceLanguage,
        targetLanguage: payload.targetLanguage,
        segmentIndex: previewSegmentIndex,
        sourceText: segment.plainText || segment.sourceText || segment.text || '',
        includeTargetText: previewPolicy.includeTargetText,
        includeAboveContext: previewPolicy.includeAboveContext,
        includeBelowContext: previewPolicy.includeBelowContext,
        aboveOptions: {
          maxSegments: profile.previewAboveSegments,
          maxChars: profile.previewAboveCharacters,
          includeSource: profile.previewAboveIncludeSource === true,
          includeTarget: profile.previewAboveIncludeTarget === true
        },
        belowOptions: {
          maxSegments: profile.previewBelowSegments,
          maxChars: profile.previewBelowCharacters,
          includeSource: profile.previewBelowIncludeSource === true,
          includeTarget: profile.previewBelowIncludeTarget === true
        }
      });

      const segmentPreviewDebug = buildSegmentPreviewDebugContext(segmentLookup, previewPolicy);
      if (segmentPreviewDebug && !segmentPreviewDebug.available) {
        segmentPreviewDebug.reason = resolvePreviewMissReason({
          lookup: segmentPreviewDebug,
          policy: previewPolicy,
          warmup: previewWarmup,
          wantsLocalContext: previewPolicy.wantsLocalContextInPrompt
        });
      }
      segmentPreviewDebugContexts.set(segment.index, segmentPreviewDebug);
      if (segmentLookup.available) {
        segmentPreviewContexts.set(segment.index, {
          documentId: normalizedMetadata.documentId,
          documentName: segmentLookup.documentName || '',
          previewPartId: String(segmentLookup.previewPartId || ''),
          targetText: String(segmentLookup.targetText || ''),
          targetTextSource: String(segmentLookup.targetTextSource || ''),
          neighborSource: String(segmentLookup.neighborSource || ''),
          above: String(segmentLookup.aboveText || ''),
          below: String(segmentLookup.belowText || ''),
          resolvedRange: segmentLookup.resolvedRange || null
        });
      }
    }

    previewWarmup = reconcilePreviewWarmupDebug(previewWarmup, {
      requestPreviewContext,
      segmentPreviewContexts
    });

    return {
      requestPreviewContext,
      requestPreviewDebug,
      segmentPreviewContexts,
      segmentPreviewDebugContexts,
      previewWarmup,
      previewPolicy
    };
  }

  return Object.freeze({
    attachNeighborContexts,
    resolve: resolvePreviewContexts
  });
}

module.exports = {
  createRuntimePreviewContextResolver
};
