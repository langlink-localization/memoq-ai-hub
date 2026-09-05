const {
  buildPrompt,
  buildBatchPrompt
} = require('../provider/providerPromptBuilder');

/**
 * @param {Record<string, any>=} entry
 * @returns {Record<string, any>}
 */
function buildHistorySummary(entry = {}) {
  const segments = Array.isArray(entry.segments) ? entry.segments : [];
  const preview = segments
    .map((/** @type {any} */ segment) => String(segment.targetText || segment.sourceText || '').trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' | ');

  return {
    segmentCount: segments.length || (Number.isFinite(Number(entry.segmentCount)) ? Number(entry.segmentCount) : 0),
    segmentSummary: preview
  };
}

/**
 * @param {Record<string, any>} args
 */
function buildHistoryPromptViewSingle({
  payload,
  profile,
  assetContext,
  previewContext,
  segment,
  translatedText,
  buildTemplatePreflightContext
}) {
  const rendered = buildPrompt({
    sourceLanguage: payload?.sourceLanguage || '',
    targetLanguage: payload?.targetLanguage || '',
    sourceText: segment?.sourceText || '',
    tmSource: segment?.tmSource || '',
    tmTarget: segment?.tmTarget || '',
    metadata: payload?.metadata || {},
    previewContext,
    segmentPreviewContext: segment?.previewContext || null,
    profile,
    requestType: payload?.requestType || 'Plaintext',
    assetContext,
    tbContext: segment?.tbContext || null,
    customTmMatches: segment?.customTmMatches || [],
    segmentMetadata: segment?.segmentMetadata || null,
    neighborContext: segment?.neighborContext || null
  });

  return {
    systemPrompt: rendered.systemPrompt,
    userPrompt: rendered.prompt,
    sourceText: String(segment?.sourceText || ''),
    targetText: String(translatedText || '')
  };
}

/**
 * @param {Record<string, any>} args
 */
function createSingleRequestMetadata({
  payload,
  profile,
  assetContext,
  previewContext,
  segment,
  translatedText,
  buildTemplatePreflightContext
}) {
  const single = buildHistoryPromptViewSingle({
    payload,
    profile,
    assetContext,
    previewContext,
    segment,
    translatedText,
    buildTemplatePreflightContext
  });

  return {
    mode: 'single',
    requestKind: 'single',
    segmentIndexes: [Number(segment?.index)],
    systemPrompt: single.systemPrompt,
    userPrompt: single.userPrompt,
    sourceText: single.sourceText,
    targetText: single.targetText
  };
}

/**
 * @param {Record<string, any>} args
 */
function buildHistoryPromptViewBatch({
  payload,
  profile,
  assetContext,
  previewContext,
  segments,
  translations,
  buildTemplatePreflightContext
}) {
  const rendered = buildBatchPrompt({
    sourceLanguage: payload?.sourceLanguage || '',
    targetLanguage: payload?.targetLanguage || '',
    segments,
    metadata: payload?.metadata || {},
    previewContext,
    profile,
    requestType: payload?.requestType || 'Plaintext',
    assetContext
  });
  const translationByIndex = new Map((translations || []).map((/** @type {any} */ item) => [Number(item.index), String(item.text || '')]));

  return {
    systemPrompt: rendered.systemPrompt,
    userPrompt: rendered.prompt,
    items: (segments || []).map((/** @type {any} */ segment) => {
      const renderedItem = rendered.renderedBatchInstructions.find((item) => Number(item?.index) === Number(segment?.index));

      return {
        index: Number(segment?.index),
        itemKind: 'batch_item',
        userPrompt: renderedItem ? JSON.stringify(renderedItem, null, 2) : '',
        sourceText: String(segment?.sourceText || ''),
        targetText: translationByIndex.get(Number(segment?.index)) || ''
      };
    })
  };
}

/**
 * @param {Record<string, any>} args
 */
function createBatchRequestMetadata({
  payload,
  profile,
  assetContext,
  previewContext,
  segments,
  translations,
  requestMetadata = {},
  buildTemplatePreflightContext
}) {
  const translationByIndex = new Map((translations || []).map((/** @type {any} */ item) => [Number(item.index), String(item.text || '')]));
  const rendered = buildHistoryPromptViewBatch({
    payload,
    profile,
    assetContext,
    previewContext,
    segments,
    translations,
    buildTemplatePreflightContext
  });
  const normalizedItems = Array.isArray(requestMetadata.items) && requestMetadata.items.length
    ? requestMetadata.items.map((/** @type {any} */ item) => ({
      index: Number(item.index),
      itemKind: 'batch_item',
      userPrompt: String(item.promptInstructions || item.userPrompt || ''),
      sourceText: String(item.sourceText || ''),
      targetText: translationByIndex.get(Number(item.index)) || ''
    }))
    : rendered.items;

  return {
    mode: 'batch',
    requestKind: 'batch',
    batchIndexes: Array.isArray(requestMetadata.batchIndexes) && requestMetadata.batchIndexes.length
      ? requestMetadata.batchIndexes.map((/** @type {any} */ value) => Number(value))
      : normalizedItems.map((/** @type {any} */ item) => Number(item.index)),
    segmentCount: Number.isFinite(Number(requestMetadata.segmentCount))
      ? Number(requestMetadata.segmentCount)
      : normalizedItems.length,
    systemPrompt: String(requestMetadata.systemPrompt || rendered.systemPrompt || ''),
    userPrompt: String(requestMetadata.userPrompt || rendered.userPrompt || ''),
    promptPreview: String(requestMetadata.promptPreview || ''),
    items: normalizedItems
  };
}

/**
 * @param {Record<string, any>} args
 */
function summarizeContextSources({
  profile,
  normalizedMetadata,
  assetContext,
  effectiveRequestPreviewContext,
  incomingSegments
}) {
  const projectMetadata = [
    normalizedMetadata?.projectId ? `Project ID: ${normalizedMetadata.projectId}` : '',
    normalizedMetadata?.client ? `Client: ${normalizedMetadata.client}` : '',
    normalizedMetadata?.domain ? `Domain: ${normalizedMetadata.domain}` : '',
    normalizedMetadata?.subject ? `Subject: ${normalizedMetadata.subject}` : '',
    normalizedMetadata?.documentId ? `Document ID: ${normalizedMetadata.documentId}` : ''
  ].filter(Boolean).join('\n');
  const terminology = (incomingSegments || [])
    .flatMap((/** @type {any} */ segment) => segment?.tbContext?.termHits || [])
    .slice(0, 8)
    .map((/** @type {any} */ item) => `${item.sourceTerm || ''} => ${item.targetTerm || ''}`.trim())
    .filter(Boolean)
    .join('\n');
  const tmHints = (incomingSegments || [])
    .map((/** @type {any} */ segment) => {
      const source = String(segment?.tmSource || '').trim();
      const target = String(segment?.tmTarget || '').trim();
      if (!source && !target) {
        return '';
      }
      return `#${Number(segment?.index)}: ${source || '-'} => ${target || '-'}`;
    })
    .filter(Boolean)
    .join('\n');
  const tmDiagnostics = (incomingSegments || [])
    .map((/** @type {any} */ segment) => {
      const diagnostics = segment?.tmDiagnostics && typeof segment.tmDiagnostics === 'object'
        ? segment.tmDiagnostics
        : null;
      if (!diagnostics) {
        return '';
      }

      const lines = [`#${Number(segment?.index)}`];
      if (diagnostics.tmSourcePresent || diagnostics.tmTargetPresent) {
        lines.push('- memoQ provided a best fuzzy TM hit.');
      } else {
        lines.push('- memoQ did not provide a best fuzzy TM hit for this request.');
      }
      lines.push(`- Fuzzy forwarding supported: ${diagnostics.supportFuzzyForwarding === true ? 'yes' : 'no'}`);
      lines.push(`- TM hints requested: ${diagnostics.tmHintsRequested === true ? 'yes' : 'no'}`);
      lines.push(`- TM source present: ${diagnostics.tmSourcePresent === true ? 'yes' : 'no'}`);
      lines.push(`- TM target present: ${diagnostics.tmTargetPresent === true ? 'yes' : 'no'}`);
      return lines.join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
  const customTmMatches = (incomingSegments || [])
    .flatMap((/** @type {any} */ segment) => (segment?.customTmMatches || []).map((/** @type {any} */ match) => ({
      index: Number(segment?.index),
      match
    })))
    .slice(0, 8)
    .map((/** @type {any} */ _ref) => { const { index, match } = _ref; return `#${index}: ${Number(match.score || 0)}% ${match.bucket || ''} ${match.sourceText || '-'} => ${match.targetText || '-'}${match.assetName ? ` (${match.assetName})` : ''}`; })
    .filter(Boolean)
    .join('\n');
  const previewContext = effectiveRequestPreviewContext
    ? [
      effectiveRequestPreviewContext.documentName ? `Document: ${effectiveRequestPreviewContext.documentName}` : '',
      effectiveRequestPreviewContext.documentId ? `Document ID: ${effectiveRequestPreviewContext.documentId}` : '',
      effectiveRequestPreviewContext.activePreviewPartId ? `Active part: ${effectiveRequestPreviewContext.activePreviewPartId}` : ''
    ].filter(Boolean).join('\n')
    : '';

  return {
    translationStyle: String(profile?.translationStyle || '').trim(),
    documentSummary: String(effectiveRequestPreviewContext?.summary || '').trim(),
    terminology,
    tmHints,
    customTmMatches,
    tmDiagnostics,
    projectMetadata,
    previewContext
  };
}

/**
 * @param {any[]=} attempts
 */
function buildHistoryPromptViewFromAttempts(attempts = []) {
  const sourceAttempts = attempts.filter((attempt) => attempt?.requestMetadata && attempt.providerId !== 'cache' && attempt.providerId !== 'adaptive-cache');
  const successfulAttempts = sourceAttempts.filter((attempt) => attempt.success);
  const preferredAttempts = successfulAttempts.length ? successfulAttempts : sourceAttempts;
  const batchRequests = preferredAttempts
    .map((attempt) => attempt.requestMetadata)
    .filter((metadata) => metadata?.mode === 'batch');

  if (batchRequests.length) {
    const activeRequest = batchRequests.at(-1);
    return {
      batch: {
        mode: 'batch',
        requestCount: batchRequests.length,
        requests: batchRequests,
        systemPrompt: activeRequest.systemPrompt,
        userPrompt: String(activeRequest.userPrompt || ''),
        items: activeRequest.items
      }
    };
  }

  const singleRequests = preferredAttempts
    .map((attempt) => attempt.requestMetadata)
    .filter((metadata) => metadata?.mode === 'single');

  if (singleRequests.length) {
    const activeRequest = singleRequests.at(-1);
    return {
      single: {
        ...activeRequest,
        requestCount: singleRequests.length,
        requests: singleRequests
      }
    };
  }

  return {};
}

/**
 * @param {any[]=} attempts
 * @returns {Record<string, any> | null}
 */
function buildHistoryThroughputSummary(attempts = []) {
  const providerAttempts = (Array.isArray(attempts) ? attempts : [])
    .filter((/** @type {any} */ attempt) => attempt && attempt.providerId !== 'cache' && attempt.providerId !== 'adaptive-cache');
  if (!providerAttempts.length) {
    return null;
  }

  const batchAttempts = providerAttempts.filter((attempt) => attempt.batch === true);
  const fallbackStages = Array.from(new Set(providerAttempts
    .map((attempt) => String(attempt.fallbackStage || '').trim())
    .filter(Boolean)));
  const fallbackReasons = Array.from(new Set(providerAttempts
    .filter((attempt) => attempt.success === false)
    .map((attempt) => String(attempt.errorCode || attempt.error?.code || '').trim())
    .filter(Boolean)));

  return {
    mode: String(providerAttempts.at(-1)?.throughputMode || ''),
    status: String(providerAttempts.at(-1)?.throughputStatus || ''),
    effectiveMaxBatchSegments: Number(providerAttempts.at(-1)?.effectiveMaxBatchSegments || 0),
    effectiveMaxBatchCharacters: Number(providerAttempts.at(-1)?.effectiveMaxBatchCharacters || 0),
    effectiveConcurrencyLimit: Number(providerAttempts.at(-1)?.effectiveConcurrencyLimit || 0),
    requestCount: providerAttempts.length,
    batchRequestCount: batchAttempts.length,
    maxObservedBatchSize: Math.max(0, ...providerAttempts.map((attempt) => Number(attempt.batchSize || 0))),
    batchSplitCount: Math.max(0, ...providerAttempts.map((attempt) => Number(attempt.batchSplitCount || 0))),
    queuedMs: providerAttempts.reduce((sum, attempt) => sum + Number(attempt.queuedMs || 0), 0),
    rateLimitedWaitMs: providerAttempts.reduce((sum, attempt) => sum + Number(attempt.rateLimitedWaitMs || 0), 0),
    providerLatencyMs: providerAttempts.reduce((sum, attempt) => sum + Number(attempt.latencyMs || 0), 0),
    providerAttemptTimeoutMs: Math.max(0, ...providerAttempts.map((attempt) => Number(attempt.providerAttemptTimeoutMs || 0))),
    fallbackStages,
    fallbackReasons
  };
}

/**
 * @param {Record<string, any>} args
 * @returns {Record<string, any> | null}
 */
function buildHistoryEntry({
  createId,
  requestId,
  runtimeIdentity,
  normalizedMetadata,
  profile,
  winningRoute,
  attempts,
  requestMode,
  effectiveExecutionMode,
  finalizedByFallbackRoute,
  submittedAt,
  completedAt,
  totalLatencyMs,
  requestPreviewDebug,
  effectiveRequestPreviewContext,
  resolvedPreview,
  terminalError,
  translations,
  payloadSegments,
  segmentMetadataIndex,
  incomingSegments,
  resolved,
  assetContext,
  payload,
  buildTemplatePreflightContext
}) {
  const derivedPromptView = buildHistoryPromptViewFromAttempts(attempts);
  const throughputSummary = buildHistoryThroughputSummary(attempts);
  const promptView = Object.keys(derivedPromptView).length
    ? derivedPromptView
    : (() => {
      if (requestMode === 'batch') {
        const request = createBatchRequestMetadata({
          payload,
          profile,
          assetContext,
          previewContext: effectiveRequestPreviewContext,
          segments: incomingSegments,
          translations,
          requestMetadata: {
            mode: 'batch',
            batchIndexes: incomingSegments.map((/** @type {any} */ segment) => segment.index),
            segmentCount: incomingSegments.length
          },
          buildTemplatePreflightContext
        });
        return {
          batch: {
            mode: 'batch',
            requestCount: 1,
            requests: [request],
            systemPrompt: request.systemPrompt,
            items: request.items
          }
        };
      }

      const request = createSingleRequestMetadata({
        payload,
        profile,
        assetContext,
        previewContext: effectiveRequestPreviewContext,
        segment: incomingSegments[0] || {},
        translatedText: translations[0]?.text || '',
        buildTemplatePreflightContext
      });
      return {
        single: {
          ...request,
          requestCount: 1,
          requests: [request]
        }
      };
    })();

  return {
    id: createId('hist'),
    requestId,
    runtime: {
      ...runtimeIdentity
    },
    projectId: normalizedMetadata.projectId || '',
    client: normalizedMetadata.client || '',
    domain: normalizedMetadata.domain || '',
    subject: normalizedMetadata.subject || '',
    documentId: normalizedMetadata.documentId || '',
    projectGuid: normalizedMetadata.projectGuid || '',
    profileId: profile.id,
    profileName: profile.name,
    providerId: winningRoute?.provider.id || attempts.at(-1)?.providerId || '',
    providerName: winningRoute?.provider.name || attempts.at(-1)?.providerName || '',
    model: winningRoute?.model.modelName || attempts.at(-1)?.model || '',
    sourceLanguage: payload.sourceLanguage || '',
    targetLanguage: payload.targetLanguage || '',
    requestMode,
    effectiveExecutionMode,
    finalizedByFallbackRoute,
    status: terminalError ? 'failed' : 'success',
    submittedAt,
    completedAt,
    latencyMs: totalLatencyMs || null,
    metadata: normalizedMetadata,
    assembly: {
      matchedRuleId: resolved.matchedRule?.id || '',
      matchedRuleName: resolved.matchedRule?.ruleName || '',
      assetBindings: profile.assetBindings || [],
      previewContext: requestPreviewDebug || effectiveRequestPreviewContext,
      previewWarmup: resolvedPreview.previewWarmup || null
    },
    assembledPrompt: {
      systemPrompt: String((/** @type {any} */ (promptView))?.single?.systemPrompt || (/** @type {any} */ (promptView))?.batch?.systemPrompt || ''),
      userPrompt: String(
        (/** @type {any} */ (promptView))?.single?.userPrompt
        || (/** @type {any} */ (promptView))?.batch?.userPrompt
        || ''
      ),
      items: Array.isArray((/** @type {any} */ (promptView))?.batch?.items)
        ? (/** @type {any} */ (promptView)).batch.items.map((/** @type {any} */ item) => ({
          segmentIndex: Number(item.segmentIndex ?? item.index),
          sourceText: String(item.sourceText || ''),
          promptInstructions: String(item.promptInstructions || item.userPrompt || item.content || '')
        }))
        : ((/** @type {any} */ (promptView))?.single?.userPrompt || (/** @type {any} */ (promptView))?.single?.sourceText)
          ? [{
            segmentIndex: Number((/** @type {any} */ (promptView))?.single?.segmentIndexes?.[0] ?? incomingSegments?.[0]?.index ?? 0),
            sourceText: String((/** @type {any} */ (promptView))?.single?.sourceText || incomingSegments?.[0]?.sourceText || ''),
            promptInstructions: String((/** @type {any} */ (promptView))?.single?.userPrompt || '')
          }]
          : []
    },
    contextSources: summarizeContextSources({
      profile,
      normalizedMetadata,
      assetContext,
      effectiveRequestPreviewContext,
      incomingSegments
    }),
    result: terminalError ? { error: terminalError } : { translations },
    qaSummary: {
      terminology: {
        ok: incomingSegments.every((/** @type {any} */ segment) => segment.qaSummary?.ok !== false),
        blocking: false,
        issues: incomingSegments.flatMap((/** @type {any} */ segment) => segment.qaSummary?.issues || [])
      }
    },
    promptView,
    returnStatus: terminalError ? 'desktop_error' : 'returned_to_memoq',
    attempts,
    throughput: throughputSummary,
    context: {
      segments: payloadSegments || []
    },
    segments: (payloadSegments || []).map((/** @type {any} */ segment, /** @type {any} */ idx) => {
      const segmentIndex = Number.isFinite(Number(segment.index)) ? Number(segment.index) : idx;
      const translated = translations.find((/** @type {any} */ item) => Number(item.index) === segmentIndex);
      const segmentMetadata = segmentMetadataIndex.get(segmentIndex) || {};
      const incomingSegment = incomingSegments.find((/** @type {any} */ item) => item.index === segmentIndex);
      return {
        id: createId('histseg'),
        segmentIndex,
        segmentId: String(segmentMetadata.segmentId || ''),
        segmentStatus: segmentMetadata.segmentStatus ?? '',
        sourceText: String(segment.text || ''),
        targetText: translated?.text || '',
        plainText: String(segment.plainText || ''),
        tmSource: String(segment.tmSource || ''),
        tmTarget: String(segment.tmTarget || ''),
        tmDiagnostics: incomingSegment?.tmDiagnostics || null,
        customTmMatches: incomingSegment?.customTmMatches || [],
        qaSummary: incomingSegment?.qaSummary || { ok: true, blocking: false, issues: [] },
        tbContext: incomingSegment?.tbContext || null,
        previewWarmup: incomingSegment?.previewWarmup || null,
        previewContext: incomingSegment?.previewDebugContext || incomingSegment?.previewContext || null
      };
    })
  };
}

module.exports = {
  buildHistorySummary,
  createSingleRequestMetadata,
  createBatchRequestMetadata,
  buildHistoryPromptViewFromAttempts,
  buildHistoryEntry
};
