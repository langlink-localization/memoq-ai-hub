const {
  buildPrompt,
  buildBatchPrompt
} = require('../provider/providerPromptBuilder');

function buildHistorySummary(entry = {}) {
  const segments = Array.isArray(entry.segments) ? entry.segments : [];
  const preview = segments
    .map((segment) => String(segment.targetText || segment.sourceText || '').trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' | ');

  return {
    segmentCount: segments.length,
    segmentSummary: preview
  };
}

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
  const translationByIndex = new Map((translations || []).map((item) => [Number(item.index), String(item.text || '')]));

  return {
    systemPrompt: rendered.systemPrompt,
    userPrompt: rendered.prompt,
    items: (segments || []).map((segment) => {
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
  const translationByIndex = new Map((translations || []).map((item) => [Number(item.index), String(item.text || '')]));
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
    ? requestMetadata.items.map((item) => ({
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
      ? requestMetadata.batchIndexes.map((value) => Number(value))
      : normalizedItems.map((item) => Number(item.index)),
    segmentCount: Number.isFinite(Number(requestMetadata.segmentCount))
      ? Number(requestMetadata.segmentCount)
      : normalizedItems.length,
    systemPrompt: String(requestMetadata.systemPrompt || rendered.systemPrompt || ''),
    userPrompt: String(requestMetadata.userPrompt || rendered.userPrompt || ''),
    promptPreview: String(requestMetadata.promptPreview || ''),
    items: normalizedItems
  };
}

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
    .flatMap((segment) => segment?.tbContext?.termHits || [])
    .slice(0, 8)
    .map((item) => `${item.sourceTerm || ''} => ${item.targetTerm || ''}`.trim())
    .filter(Boolean)
    .join('\n');
  const tmHints = (incomingSegments || [])
    .map((segment) => {
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
    .map((segment) => {
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
    tmDiagnostics,
    projectMetadata,
    previewContext
  };
}

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
            batchIndexes: incomingSegments.map((segment) => segment.index),
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
      systemPrompt: String(promptView?.single?.systemPrompt || promptView?.batch?.systemPrompt || ''),
      userPrompt: String(
        promptView?.single?.userPrompt
        || promptView?.batch?.userPrompt
        || ''
      ),
      items: Array.isArray(promptView?.batch?.items)
        ? promptView.batch.items.map((item) => ({
          segmentIndex: Number(item.segmentIndex ?? item.index),
          sourceText: String(item.sourceText || ''),
          promptInstructions: String(item.promptInstructions || item.userPrompt || item.content || '')
        }))
        : (promptView?.single?.userPrompt || promptView?.single?.sourceText)
          ? [{
            segmentIndex: Number(promptView?.single?.segmentIndexes?.[0] ?? incomingSegments?.[0]?.index ?? 0),
            sourceText: String(promptView?.single?.sourceText || incomingSegments?.[0]?.sourceText || ''),
            promptInstructions: String(promptView?.single?.userPrompt || '')
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
        ok: incomingSegments.every((segment) => segment.qaSummary?.ok !== false),
        blocking: false,
        issues: incomingSegments.flatMap((segment) => segment.qaSummary?.issues || [])
      }
    },
    promptView,
    returnStatus: terminalError ? 'desktop_error' : 'returned_to_memoq',
    attempts,
    context: {
      segments: payloadSegments || []
    },
    segments: (payloadSegments || []).map((segment, idx) => {
      const segmentIndex = Number.isFinite(Number(segment.index)) ? Number(segment.index) : idx;
      const translated = translations.find((item) => Number(item.index) === segmentIndex);
      const segmentMetadata = segmentMetadataIndex.get(segmentIndex) || {};
      const incomingSegment = incomingSegments.find((item) => item.index === segmentIndex);
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
