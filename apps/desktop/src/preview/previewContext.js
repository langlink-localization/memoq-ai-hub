function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePreviewContent(content = {}) {
  return {
    complexity: normalizeText(content.Complexity || content.complexity),
    content: String(content.Content ?? content.content ?? '')
  };
}

function normalizeFocusedRange(range = {}) {
  const startIndex = Number(range.StartIndex ?? range.startIndex);
  const length = Number(range.Length ?? range.length);

  return {
    startIndex: Number.isFinite(startIndex) ? startIndex : -1,
    length: Number.isFinite(length) ? length : 0
  };
}

function normalizeSourceDocument(document = {}) {
  return {
    documentGuid: normalizeText(document.DocumentGuid || document.documentGuid),
    documentName: normalizeText(document.DocumentName || document.documentName),
    importPath: normalizeText(document.ImportPath || document.importPath)
  };
}

function normalizePreviewProperty(property = {}) {
  return {
    name: normalizeText(property.Name || property.name),
    value: normalizeText(property.Value || property.value)
  };
}

function normalizePreviewPart(part = {}) {
  return {
    previewPartId: normalizeText(part.PreviewPartId || part.previewPartId),
    previewProperties: (Array.isArray(part.PreviewProperties || part.previewProperties) ? (part.PreviewProperties || part.previewProperties) : [])
      .map((item) => normalizePreviewProperty(item))
      .filter((item) => item.name),
    sourceDocument: normalizeSourceDocument(part.SourceDocument || part.sourceDocument),
    sourceLangCode: normalizeText(part.SourceLangCode || part.sourceLangCode),
    targetLangCode: normalizeText(part.TargetLangCode || part.targetLangCode),
    sourceContent: normalizePreviewContent(part.SourceContent || part.sourceContent),
    targetContent: normalizePreviewContent(part.TargetContent || part.targetContent),
    sourceFocusedRange: normalizeFocusedRange(part.SourceFocusedRange || part.sourceFocusedRange),
    targetFocusedRange: normalizeFocusedRange(part.TargetFocusedRange || part.targetFocusedRange)
  };
}

function mergePreviewPart(existing = {}, incoming = {}) {
  const next = normalizePreviewPart(incoming);
  return {
    previewPartId: next.previewPartId || existing.previewPartId || '',
    previewProperties: next.previewProperties.length ? next.previewProperties : (existing.previewProperties || []),
    sourceDocument: next.sourceDocument.documentGuid || next.sourceDocument.documentName || next.sourceDocument.importPath
      ? next.sourceDocument
      : (existing.sourceDocument || normalizeSourceDocument()),
    sourceLangCode: next.sourceLangCode || existing.sourceLangCode || '',
    targetLangCode: next.targetLangCode || existing.targetLangCode || '',
    sourceContent: next.sourceContent.content !== '' || next.sourceContent.complexity
      ? next.sourceContent
      : (existing.sourceContent || normalizePreviewContent()),
    targetContent: next.targetContent.content !== '' || next.targetContent.complexity
      ? next.targetContent
      : (existing.targetContent || normalizePreviewContent()),
    sourceFocusedRange: next.sourceFocusedRange.startIndex >= 0
      ? next.sourceFocusedRange
      : (existing.sourceFocusedRange || normalizeFocusedRange()),
    targetFocusedRange: next.targetFocusedRange.startIndex >= 0
      ? next.targetFocusedRange
      : (existing.targetFocusedRange || normalizeFocusedRange())
  };
}

function stripFormattingMarkup(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, maxLength = 240) {
  const normalized = String(text || '').trim();
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildPreviewStatusSnapshot(previewState = {}) {
  const previewPartsById = previewState.previewPartsById instanceof Map ? previewState.previewPartsById : new Map();

  return {
    status: normalizeText(previewState.status) || 'disconnected',
    statusMessage: normalizeText(previewState.statusMessage),
    serviceBaseUrl: normalizeText(previewState.serviceBaseUrl),
    sessionId: normalizeText(previewState.sessionId),
    callbackAddress: normalizeText(previewState.callbackAddress),
    connectedAt: normalizeText(previewState.connectedAt),
    lastUpdatedAt: normalizeText(previewState.lastUpdatedAt),
    lastError: normalizeText(previewState.lastError),
    activePreviewPartId: normalizeText(previewState.activePreviewPartId),
    activePreviewPartCount: Array.isArray(previewState.activePreviewPartIds) ? previewState.activePreviewPartIds.length : 0,
    cachedPreviewPartCount: previewPartsById.size,
    sourceDocumentName: normalizeText(previewState.activeSourceDocument?.documentName),
    sourceDocumentGuid: normalizeText(previewState.activeSourceDocument?.documentGuid)
  };
}

function getOrderedPreviewParts(previewState = {}, sourceLanguage = '', targetLanguage = '') {
  const previewPartsById = previewState.previewPartsById instanceof Map ? previewState.previewPartsById : new Map();
  const preferredOrder = Array.isArray(previewState.previewPartOrder) && previewState.previewPartOrder.length
    ? previewState.previewPartOrder
    : Array.from(previewPartsById.keys());
  const normalizedSourceLanguage = normalizeText(sourceLanguage).toLowerCase();
  const normalizedTargetLanguage = normalizeText(targetLanguage).toLowerCase();

  return preferredOrder
    .map((previewPartId) => previewPartsById.get(previewPartId))
    .filter(Boolean)
    .filter((part) => {
      const sourceMatch = !normalizedSourceLanguage || normalizeText(part.sourceLangCode).toLowerCase() === normalizedSourceLanguage;
      const targetMatch = !normalizedTargetLanguage || normalizeText(part.targetLangCode).toLowerCase() === normalizedTargetLanguage;
      return sourceMatch && targetMatch;
    });
}

function getScopedPreviewParts(previewState = {}, activePart = null, sourceLanguage = '', targetLanguage = '') {
  const orderedParts = getOrderedPreviewParts(previewState, sourceLanguage, targetLanguage);
  if (!activePart?.sourceDocument?.documentGuid && !activePart?.sourceDocument?.documentName) {
    return orderedParts;
  }

  const activeGuid = normalizeText(activePart.sourceDocument.documentGuid);
  const activeName = normalizeText(activePart.sourceDocument.documentName);
  const scoped = orderedParts.filter((part) => (
    (activeGuid && normalizeText(part.sourceDocument?.documentGuid) === activeGuid)
    || (activeName && normalizeText(part.sourceDocument?.documentName) === activeName)
  ));

  return scoped.length ? scoped : orderedParts;
}

function findActivePreviewPart(previewState = {}, sourceLanguage = '', targetLanguage = '') {
  const previewPartsById = previewState.previewPartsById instanceof Map ? previewState.previewPartsById : new Map();
  const activeIds = Array.isArray(previewState.activePreviewPartIds) ? previewState.activePreviewPartIds : [];
  const normalizedSourceLanguage = normalizeText(sourceLanguage).toLowerCase();
  const normalizedTargetLanguage = normalizeText(targetLanguage).toLowerCase();

  for (const previewPartId of activeIds) {
    const part = previewPartsById.get(previewPartId);
    if (!part) {
      continue;
    }

    const sourceMatch = !normalizedSourceLanguage || normalizeText(part.sourceLangCode).toLowerCase() === normalizedSourceLanguage;
    const targetMatch = !normalizedTargetLanguage || normalizeText(part.targetLangCode).toLowerCase() === normalizedTargetLanguage;
    if (sourceMatch && targetMatch) {
      return part;
    }
  }

  return getOrderedPreviewParts(previewState, sourceLanguage, targetLanguage)[0] || null;
}

function findPreviewPartForSegment(scopedParts = [], activePart = null, segment = {}, totalSegments = 1) {
  const segmentSourceText = stripFormattingMarkup(segment.plainText || segment.sourceText || segment.text);
  if (!segmentSourceText) {
    return totalSegments === 1 ? activePart : null;
  }

  const normalizedSegment = segmentSourceText.toLowerCase();
  const exactMatches = scopedParts.filter((part) => stripFormattingMarkup(part.sourceContent?.content).toLowerCase() === normalizedSegment);
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  if (activePart && stripFormattingMarkup(activePart.sourceContent?.content).toLowerCase() === normalizedSegment) {
    return activePart;
  }

  return totalSegments === 1 ? activePart : null;
}

function buildNeighborText(scopedParts = [], activeIndex = -1, direction = 'above', windowSize = 2) {
  if (activeIndex < 0) {
    return '';
  }

  const items = direction === 'above'
    ? scopedParts.slice(Math.max(0, activeIndex - windowSize), activeIndex)
    : scopedParts.slice(activeIndex + 1, activeIndex + 1 + windowSize);

  return items
    .map((part) => stripFormattingMarkup(part.sourceContent?.content))
    .filter(Boolean)
    .join('\n');
}

function buildPreviewSummary({ activePart = null, above = '', below = '' } = {}) {
  const lines = [];
  const documentName = normalizeText(activePart?.sourceDocument?.documentName);
  const sourceText = stripFormattingMarkup(activePart?.sourceContent?.content);
  const targetText = stripFormattingMarkup(activePart?.targetContent?.content);

  if (documentName) {
    lines.push(`Document: ${documentName}`);
  }
  if (above) {
    lines.push(`Above: ${truncate(above, 200)}`);
  }
  if (sourceText) {
    lines.push(`Current source: ${truncate(sourceText, 200)}`);
  }
  if (targetText) {
    lines.push(`Current target: ${truncate(targetText, 200)}`);
  }
  if (below) {
    lines.push(`Below: ${truncate(below, 200)}`);
  }

  return lines.join('\n');
}

function buildPreviewContextBundle(previewState = {}, segments = [], options = {}) {
  const sourceLanguage = normalizeText(options.sourceLanguage);
  const targetLanguage = normalizeText(options.targetLanguage);
  const activePart = findActivePreviewPart(previewState, sourceLanguage, targetLanguage);
  if (!activePart) {
    return {
      available: false,
      shared: null,
      segments: new Map()
    };
  }

  const scopedParts = getScopedPreviewParts(previewState, activePart, sourceLanguage, targetLanguage);
  const activeIndex = scopedParts.findIndex((part) => part.previewPartId === activePart.previewPartId);
  const activeAbove = buildNeighborText(scopedParts, activeIndex, 'above');
  const activeBelow = buildNeighborText(scopedParts, activeIndex, 'below');
  const shared = {
    activePreviewPartId: activePart.previewPartId,
    sourceDocument: activePart.sourceDocument,
    previewProperties: activePart.previewProperties,
    fullText: scopedParts.map((part) => stripFormattingMarkup(part.sourceContent?.content)).filter(Boolean).join('\n'),
    fullTargetText: scopedParts.map((part) => stripFormattingMarkup(part.targetContent?.content)).filter(Boolean).join('\n'),
    summary: buildPreviewSummary({ activePart, above: activeAbove, below: activeBelow }),
    sourceText: stripFormattingMarkup(activePart.sourceContent?.content),
    targetText: stripFormattingMarkup(activePart.targetContent?.content)
  };

  const segmentContexts = new Map();
  const totalSegments = Array.isArray(segments) ? segments.length : 0;

  for (const segment of Array.isArray(segments) ? segments : []) {
    const matchedPart = findPreviewPartForSegment(scopedParts, activePart, segment, totalSegments);
    if (!matchedPart) {
      continue;
    }

    const matchedIndex = scopedParts.findIndex((part) => part.previewPartId === matchedPart.previewPartId);
    const above = buildNeighborText(scopedParts, matchedIndex, 'above');
    const below = buildNeighborText(scopedParts, matchedIndex, 'below');

    segmentContexts.set(Number(segment.index), {
      previewPartId: matchedPart.previewPartId,
      sourceDocument: matchedPart.sourceDocument,
      previewProperties: matchedPart.previewProperties,
      sourceText: stripFormattingMarkup(matchedPart.sourceContent?.content),
      targetText: stripFormattingMarkup(matchedPart.targetContent?.content),
      above,
      below,
      sourceFocusedRange: matchedPart.sourceFocusedRange,
      targetFocusedRange: matchedPart.targetFocusedRange
    });
  }

  return {
    available: true,
    shared,
    segments: segmentContexts
  };
}

module.exports = {
  buildPreviewContextBundle,
  buildPreviewStatusSnapshot,
  mergePreviewPart,
  normalizePreviewPart,
  normalizeSourceDocument,
  stripFormattingMarkup,
  truncate
};
