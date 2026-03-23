const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ensureDir } = require('../shared/paths');

function safeReadJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    let raw = fs.readFileSync(filePath, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) {
      raw = raw.slice(1);
    }
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function sanitizeToken(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-z0-9._-]/gi, '_')
    .toLowerCase();
}

function createDocumentCacheFileName(documentId, sourceLanguage, targetLanguage) {
  return `${sanitizeToken(documentId)}__${sanitizeToken(sourceLanguage)}__${sanitizeToken(targetLanguage)}.json`;
}

function parseSegmentIndex(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : -1;
}

function normalizeRange(range = null) {
  if (!range || typeof range !== 'object') {
    return null;
  }

  const start = parseSegmentIndex(range.start ?? range.indexStart ?? range.startIndex ?? range.StartIndex);
  const explicitEnd = parseSegmentIndex(range.end ?? range.indexEnd ?? range.endIndex ?? range.EndIndex);
  const length = Number(range.length ?? range.Length);
  if (start < 0) {
    return null;
  }

  let end = explicitEnd;
  if (end < 0 && Number.isFinite(length)) {
    end = start + Math.max(0, length - 1);
  }
  if (end < 0) {
    end = start;
  }

  return {
    start: Math.min(start, end),
    end: Math.max(start, end)
  };
}

function normalizeFocusedRange(range = null) {
  const normalizedRange = normalizeRange(range);
  if (!normalizedRange) {
    return null;
  }

  return {
    startIndex: normalizedRange.start,
    length: Math.max(0, normalizedRange.end - normalizedRange.start + 1),
    endIndex: normalizedRange.end
  };
}

function cloneSegments(segments = []) {
  return Array.isArray(segments)
    ? segments.map((segment) => ({
      index: parseSegmentIndex(segment.index),
      previewPartId: String(segment.previewPartId || ''),
      sourceText: String(segment.sourceText || segment.source || ''),
      targetText: String(segment.targetText || segment.target || ''),
      sourceFocusedRange: normalizeFocusedRange(segment.sourceFocusedRange || segment.SourceFocusedRange),
      targetFocusedRange: normalizeFocusedRange(segment.targetFocusedRange || segment.TargetFocusedRange)
    })).filter((segment) => segment.index >= 0)
    : [];
}

function cloneParts(parts = []) {
  return Array.isArray(parts)
    ? parts.map((part, index) => ({
      previewPartId: String(part.previewPartId || part.id || ''),
      sourceText: String(part.sourceText || part.source || ''),
      targetText: String(part.targetText || part.target || ''),
      order: Number.isFinite(Number(part.order)) ? Number(part.order) : index,
      sourceFocusedRange: normalizeFocusedRange(part.sourceFocusedRange || part.SourceFocusedRange),
      targetFocusedRange: normalizeFocusedRange(part.targetFocusedRange || part.TargetFocusedRange)
    })).filter((part) => part.previewPartId)
    : [];
}

function normalizeComparableText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasComparableText(value) {
  return Boolean(normalizeComparableText(value));
}

function areTextsCompatible(left, right) {
  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return normalizedLeft === normalizedRight
    || normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft);
}

function sliceTextByFocusedRange(text, range) {
  const normalizedRange = normalizeFocusedRange(range);
  const normalizedText = String(text || '');
  if (!normalizedRange) {
    return '';
  }

  const start = Math.max(0, Number(normalizedRange.startIndex || 0));
  if (start >= normalizedText.length) {
    return '';
  }

  if (normalizedRange.length <= 0) {
    return normalizedText.slice(start);
  }

  return normalizedText.slice(start, start + normalizedRange.length);
}

function hasPartFocusedRange(part) {
  return Boolean(part?.sourceFocusedRange || part?.targetFocusedRange);
}

function getPartTextVariants(part) {
  return [part?.sourceText];
}

function partMatchesSourceText(part, sourceText) {
  if (!hasComparableText(sourceText)) {
    return true;
  }

  return getPartTextVariants(part).some((text) => areTextsCompatible(text, sourceText));
}

function partMatchesSubstringRange(part, sourceText) {
  const normalizedSourceText = normalizeComparableText(sourceText);
  if (!normalizedSourceText) {
    return false;
  }

  const focusedSourceText = normalizeComparableText(sliceTextByFocusedRange(part.sourceText, part.sourceFocusedRange));
  const wholeSourceText = normalizeComparableText(part.sourceText);

  return [focusedSourceText, wholeSourceText].some((candidateText) => (
    Boolean(candidateText)
    && candidateText !== normalizedSourceText
    && (candidateText.includes(normalizedSourceText) || normalizedSourceText.includes(candidateText))
  ));
}

function buildPreviewAvailableFeatures(document, request = {}) {
  const features = [];

  if (request.includeFullText && document) {
    features.push('fullText');
  }
  if (request.includeSummary && document) {
    features.push('summary');
  }
  if (request.includeTargetText) {
    features.push('targetText');
  }
  if (request.includeAboveContext) {
    features.push('above');
  }
  if (request.includeBelowContext) {
    features.push('below');
  }

  return features;
}

function createPartMatch(part, orderIndex, previewMatchMode, reason) {
  if (!part) {
    return null;
  }

  return {
    part,
    orderIndex,
    previewMatchMode,
    reason
  };
}

function findActivePreviewPartMatch(parts, activePreviewPartIds, sourceText) {
  const activeIds = Array.isArray(activePreviewPartIds) ? activePreviewPartIds : [];
  if (!activeIds.length || !parts.length) {
    return null;
  }

  const activeCandidates = activeIds
    .map((previewPartId) => {
      const orderIndex = parts.findIndex((part) => part.previewPartId === previewPartId);
      if (orderIndex < 0) {
        return null;
      }

      return {
        part: parts[orderIndex],
        orderIndex,
        previewPartId
      };
    })
    .filter(Boolean);

  if (!activeCandidates.length) {
    return null;
  }

  if (!hasComparableText(sourceText)) {
    return createPartMatch(activeCandidates[0].part, activeCandidates[0].orderIndex, 'activePreviewPartIds', '');
  }

  return null;
}

function findFocusedRangeMatch(parts, sourceText, options = {}) {
  const candidateParts = Array.isArray(options.parts) && options.parts.length ? options.parts : parts;
  const previewMatchMode = String(options.previewMatchMode || 'focusedRange');
  const focusedCandidates = candidateParts
    .map((part, orderIndex) => ({
      part,
      orderIndex,
      sourceFocusedRange: normalizeFocusedRange(part.sourceFocusedRange),
      targetFocusedRange: normalizeFocusedRange(part.targetFocusedRange)
    }))
    .filter((candidate) => candidate.sourceFocusedRange || candidate.targetFocusedRange);

  if (!focusedCandidates.length) {
    return null;
  }

  if (!hasComparableText(sourceText)) {
    return createPartMatch(focusedCandidates[0].part, focusedCandidates[0].orderIndex, previewMatchMode, '');
  }

  const normalizedSourceText = normalizeComparableText(sourceText);
  const compatibleCandidate = focusedCandidates.find((candidate) => {
    const focusedSourceText = normalizeComparableText(sliceTextByFocusedRange(candidate.part.sourceText, candidate.sourceFocusedRange));
    const wholeSourceText = normalizeComparableText(candidate.part.sourceText);
    return (
      Boolean(focusedSourceText)
      && (
        focusedSourceText === normalizedSourceText
        || focusedSourceText.includes(normalizedSourceText)
        || normalizedSourceText.includes(focusedSourceText)
      )
    ) || wholeSourceText.includes(normalizedSourceText);
  });

  if (!compatibleCandidate) {
    return null;
  }

  return createPartMatch(
    compatibleCandidate.part,
    compatibleCandidate.orderIndex,
    previewMatchMode,
    ''
  );
}

function findSubstringRangeMatch(parts, sourceText, options = {}) {
  if (!hasComparableText(sourceText)) {
    return null;
  }

  const candidateParts = Array.isArray(options.parts) && options.parts.length ? options.parts : parts;
  const previewMatchMode = String(options.previewMatchMode || 'substringRange');

  for (let index = 0; index < candidateParts.length; index++) {
    const part = candidateParts[index];
    if (partMatchesSubstringRange(part, sourceText)) {
      return createPartMatch(part, index, previewMatchMode, '');
    }
  }

  return null;
}

function findExactTextMatch(parts, sourceText) {
  const normalizedSourceText = normalizeComparableText(sourceText);
  if (!normalizedSourceText) {
    return null;
  }

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (normalizeComparableText(part.sourceText) === normalizedSourceText) {
      return createPartMatch(part, index, 'exactTextFallback', '');
    }
  }

  return null;
}

function findLegacySegmentMatch(document, segmentIndex) {
  const normalizedSegmentIndex = parseSegmentIndex(segmentIndex);
  if (normalizedSegmentIndex < 0) {
    return null;
  }

  const segments = Array.isArray(document?.segments) ? document.segments : [];
  const exact = segments.find((segment) => segment.index === normalizedSegmentIndex && segment.previewPartId);
  const plusOne = exact ? null : segments.find((segment) => segment.index === normalizedSegmentIndex + 1 && segment.previewPartId);
  const minusOne = exact || plusOne ? null : segments.find((segment) => segment.index === normalizedSegmentIndex - 1 && segment.previewPartId);
  const matchedSegment = exact || plusOne || minusOne;

  if (!matchedSegment) {
    return null;
  }

  const parts = Array.isArray(document?.parts) ? document.parts : [];
  const orderIndex = parts.findIndex((part) => part.previewPartId === matchedSegment.previewPartId);
  const resolvedOrderIndex = orderIndex >= 0 ? orderIndex : matchedSegment.index;
  return createPartMatch(
    orderIndex >= 0 ? parts[orderIndex] : {
      previewPartId: String(matchedSegment.previewPartId || ''),
      sourceText: String(matchedSegment.sourceText || ''),
      targetText: String(matchedSegment.targetText || '')
    },
    resolvedOrderIndex,
    'legacySegmentIndex',
    ''
  );
}

function findRangeForSegment(segments, requestedIndex, fallbackRange) {
  const direct = segments.find((segment) => segment.index === requestedIndex);
  if (direct) {
    return { start: direct.index, end: direct.index, matchedIndex: direct.index };
  }

  if (requestedIndex >= 0) {
    const plusOne = segments.find((segment) => segment.index === requestedIndex + 1);
    if (plusOne) {
      return { start: plusOne.index, end: plusOne.index, matchedIndex: plusOne.index };
    }

    const minusOne = segments.find((segment) => segment.index === requestedIndex - 1);
    if (minusOne) {
      return { start: minusOne.index, end: minusOne.index, matchedIndex: minusOne.index };
    }
  }

  return normalizeRange(fallbackRange);
}

function joinSegmentTexts(segmentList, includeSource, includeTarget, reverse = false) {
  const ordered = reverse ? [...segmentList].reverse() : segmentList;
  const parts = [];

  for (const segment of ordered) {
    if (includeSource && segment.sourceText.trim()) {
      parts.push(segment.sourceText);
    }
    if (includeTarget && segment.targetText.trim()) {
      parts.push(segment.targetText);
    }
  }

  return parts.join('\n');
}

function joinPartTexts(partList, includeSource, includeTarget, reverse = false) {
  const ordered = reverse ? [...partList].reverse() : partList;
  const parts = [];

  for (const part of ordered) {
    if (includeSource && part.sourceText.trim()) {
      parts.push(part.sourceText);
    }
    if (includeTarget && part.targetText.trim()) {
      parts.push(part.targetText);
    }
  }

  return parts.join('\n');
}

function getOrderedParts(parts = []) {
  return (Array.isArray(parts) ? parts : [])
    .map((part, index) => ({
      ...part,
      _originalIndex: index
    }))
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      return left._originalIndex - right._originalIndex;
    });
}

function resolveOrderedPartPosition(orderedParts, previewPartId) {
  return (Array.isArray(orderedParts) ? orderedParts : []).findIndex((part) => part.previewPartId === previewPartId);
}

function collectDirectionalContext({
  segments,
  anchorIndex,
  direction,
  maxSegments,
  maxChars,
  includeSource,
  includeTarget
}) {
  if (!includeSource && !includeTarget) {
    return '';
  }

  const ordered = [...segments].sort((left, right) => left.index - right.index);
  const results = [];
  let characterCount = 0;
  let remaining = Number.isFinite(Number(maxSegments)) ? Number(maxSegments) : 0;
  let cursor = anchorIndex + direction;

  while ((remaining > 0 || maxSegments <= 0) && ordered.length) {
    const segment = ordered.find((item) => item.index === cursor);
    if (!segment) {
      break;
    }

    const sourceText = includeSource ? segment.sourceText : '';
    const targetText = includeTarget ? segment.targetText : '';
    const nextChars = sourceText.length + targetText.length;
    if (maxChars > 0 && characterCount + nextChars > maxChars) {
      break;
    }

    if (sourceText.trim() || targetText.trim()) {
      results.push(segment);
      characterCount += nextChars;
      if (remaining > 0) {
        remaining -= 1;
      }
    }

    cursor += direction;
  }

  return joinSegmentTexts(results, includeSource, includeTarget, direction < 0);
}

function collectDirectionalPartContext({
  parts,
  anchorPosition,
  direction,
  maxSegments,
  maxChars,
  includeSource,
  includeTarget
}) {
  if (!includeSource && !includeTarget) {
    return '';
  }

  const ordered = Array.isArray(parts) ? parts : [];
  const results = [];
  let characterCount = 0;
  let remaining = Number.isFinite(Number(maxSegments)) ? Number(maxSegments) : 0;
  let cursor = anchorPosition + direction;

  while ((remaining > 0 || maxSegments <= 0) && cursor >= 0 && cursor < ordered.length) {
    const part = ordered[cursor];
    if (!part) {
      break;
    }

    const sourceText = includeSource ? part.sourceText : '';
    const targetText = includeTarget ? part.targetText : '';
    const nextChars = sourceText.length + targetText.length;
    if (maxChars > 0 && characterCount + nextChars > maxChars) {
      break;
    }

    if (sourceText.trim() || targetText.trim()) {
      results.push(part);
      characterCount += nextChars;
      if (remaining > 0) {
        remaining -= 1;
      }
    }

    cursor += direction;
  }

  return joinPartTexts(results, includeSource, includeTarget, direction < 0);
}

function findDocumentCacheCandidates(documentsDir, documentId, sourceLanguage, targetLanguage) {
  if (!fs.existsSync(documentsDir)) {
    return [];
  }

  const exact = createDocumentCacheFileName(documentId, sourceLanguage, targetLanguage);
  const exactPath = path.join(documentsDir, exact);
  if (fs.existsSync(exactPath)) {
    return [exactPath];
  }

  const documentToken = sanitizeToken(documentId);
  const sourceToken = sanitizeToken(sourceLanguage);
  const targetToken = sanitizeToken(targetLanguage);

  return fs.readdirSync(documentsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .filter((fileName) => fileName.startsWith(`${documentToken}__`))
    .sort((left, right) => {
      const leftScore = Number(left.includes(`__${sourceToken}__${targetToken}.json`)) * 4
        + Number(left.includes(`__${sourceToken}__`)) * 2
        + Number(left.endsWith(`__${targetToken}.json`));
      const rightScore = Number(right.includes(`__${sourceToken}__${targetToken}.json`)) * 4
        + Number(right.includes(`__${sourceToken}__`)) * 2
        + Number(right.endsWith(`__${targetToken}.json`));
      return rightScore - leftScore;
    })
    .map((fileName) => path.join(documentsDir, fileName));
}

function resolvePartMatch(document, { sourceText, segmentIndex }) {
  const parts = Array.isArray(document.parts) ? document.parts : [];
  if (!parts.length) {
    return null;
  }

  const activePreviewPartIds = Array.isArray(document.activePreviewPartIds) ? document.activePreviewPartIds : [];
  const activeParts = activePreviewPartIds
    .map((previewPartId) => parts.find((part) => part.previewPartId === previewPartId))
    .filter(Boolean);

  return findFocusedRangeMatch(parts, sourceText, { parts: activeParts, previewMatchMode: 'activeFocusedRange' })
    || findSubstringRangeMatch(parts, sourceText, { parts: activeParts, previewMatchMode: 'activePartSubstring' })
    || findActivePreviewPartMatch(parts, activePreviewPartIds, sourceText)
    || findFocusedRangeMatch(parts, sourceText)
    || findSubstringRangeMatch(parts, sourceText)
    || findExactTextMatch(parts, sourceText)
    || findLegacySegmentMatch(document, segmentIndex);
}

function createPreviewContextClient(options = {}) {
  const appDataRoot = String(options.appDataRoot || '').trim();
  const helperRoot = path.join(appDataRoot, 'preview-helper');
  const documentsDir = path.join(helperRoot, 'documents');
  const logsDir = path.join(helperRoot, 'logs');
  const statusFilePath = path.join(helperRoot, 'status.json');
  let child = null;

  function getHelperExecutablePath() {
    if (options.helperExecutablePath) {
      return String(options.helperExecutablePath);
    }

    const packagedRelativePath = path.resolve(__dirname, '..', '..', '..', 'helper', 'MemoQ.AI.Preview.Helper.exe');
    if (fs.existsSync(packagedRelativePath)) {
      return packagedRelativePath;
    }

    const bundledPath = path.join(process.resourcesPath || '', 'helper', 'MemoQ.AI.Preview.Helper.exe');
    if (process.resourcesPath && fs.existsSync(bundledPath)) {
      return bundledPath;
    }

    const forgeBuildPath = path.join(
      options.repoRoot || path.resolve(__dirname, '..', '..'),
      'preview-helper',
      'MemoQ.AI.Preview.Helper',
      'bin',
      'forge',
      'Release',
      'net48',
      'MemoQ.AI.Preview.Helper.exe'
    );
    if (fs.existsSync(forgeBuildPath)) {
      return forgeBuildPath;
    }

    return path.join(
      options.repoRoot || path.resolve(__dirname, '..', '..'),
      'preview-helper',
      'MemoQ.AI.Preview.Helper',
      'bin',
      'Release',
      'net48',
      'MemoQ.AI.Preview.Helper.exe'
    );
  }

  function start() {
    ensureDir(helperRoot);
    ensureDir(documentsDir);
    ensureDir(logsDir);

    if (child && !child.killed) {
      return;
    }

    const executablePath = getHelperExecutablePath();
    if (!fs.existsSync(executablePath)) {
      return;
    }

    child = spawn(executablePath, ['--data-dir', helperRoot], {
      cwd: path.dirname(executablePath),
      windowsHide: true,
      stdio: 'ignore'
    });
    child.unref();

    child.once('exit', () => {
      child = null;
    });
  }

  function getStatus() {
    const payload = safeReadJson(statusFilePath, {});
    return {
      available: fs.existsSync(getHelperExecutablePath()),
      running: Boolean(child && !child.killed),
      connected: payload.connected === true,
      state: String(payload.state || (fs.existsSync(getHelperExecutablePath()) ? 'idle' : 'missing')),
      lastConnectedAt: String(payload.lastConnectedAt || ''),
      lastUpdatedAt: String(payload.lastUpdatedAt || ''),
      lastError: String(payload.lastError || ''),
      previewToolId: String(payload.previewToolId || '')
    };
  }

  function readDocument(documentId, sourceLanguage, targetLanguage) {
    const candidates = findDocumentCacheCandidates(documentsDir, documentId, sourceLanguage, targetLanguage);
    for (const filePath of candidates) {
      const payload = safeReadJson(filePath, null);
      if (!payload) {
        continue;
      }

      return {
        ...payload,
        activePreviewPartIds: Array.isArray(payload.activePreviewPartIds)
          ? payload.activePreviewPartIds.map((item) => String(item || '').trim()).filter(Boolean)
          : [],
        currentRange: normalizeRange(payload.currentRange),
        parts: cloneParts(payload.parts || []),
        segments: cloneSegments(payload.segments || [])
      };
    }

    return null;
  }

  function getContext({
    documentId,
    sourceLanguage,
    targetLanguage,
    segmentIndex,
    segmentRange,
    includeTargetText = false,
    includeAboveContext = false,
    includeBelowContext = false,
    includeFullText = false,
    includeSummary = false,
    sourceText = '',
    aboveOptions = {},
    belowOptions = {}
  }) {
    const document = readDocument(documentId, sourceLanguage, targetLanguage);
    const previewAvailableFeatures = buildPreviewAvailableFeatures(document, {
      segmentIndex,
      segmentRange,
      includeTargetText,
      includeAboveContext,
      includeBelowContext,
      includeFullText,
      includeSummary,
      sourceText
    });

    if (!document) {
      return {
        available: false,
        reason: 'document_not_cached',
        previewMatchMode: 'unmatched',
        previewPartId: '',
        activePreviewPartIds: [],
        sourceFocusedRange: null,
        targetFocusedRange: null,
        previewAvailableFeatures,
        hasDocument: false,
        hasActivePreviewPart: false,
        hasFocusedRange: false
      };
    }

    const fallbackRange = normalizeRange(segmentRange) || normalizeRange(document.currentRange);
    const resolvedRange = findRangeForSegment(document.segments, parseSegmentIndex(segmentIndex), fallbackRange);
    const partMatch = resolvePartMatch(document, { sourceText, segmentIndex });
    const resolvedPart = partMatch?.part || null;
    const orderedParts = getOrderedParts(document.parts);
    const resolvedPartPosition = resolvedPart ? resolveOrderedPartPosition(orderedParts, resolvedPart.previewPartId) : -1;
    const sourceFocusedRange = normalizeFocusedRange(resolvedPart?.sourceFocusedRange);
    const targetFocusedRange = normalizeFocusedRange(resolvedPart?.targetFocusedRange);
    const activePreviewPartIds = document.activePreviewPartIds || [];
    const activeParts = document.parts.filter((part) => activePreviewPartIds.includes(part.previewPartId));
    const activePart = activeParts[0] || null;
    const activePartHasRange = activeParts.some((part) => hasPartFocusedRange(part));
    const hasFocusedRange = Boolean(sourceFocusedRange || targetFocusedRange || activePartHasRange);

    let targetText = '';
    let aboveText = '';
    let belowText = '';
    let aboveSourceText = '';
    let aboveTargetText = '';
    let belowSourceText = '';
    let belowTargetText = '';
    let targetTextSource = 'none';
    let neighborSource = 'none';

    if (resolvedPart) {
      if (includeTargetText && resolvedPart.targetText.trim()) {
        targetText = resolvedPart.targetText;
        targetTextSource = 'partTarget';
      }

      if (includeAboveContext && resolvedPartPosition >= 0) {
        aboveText = collectDirectionalPartContext({
          parts: orderedParts,
          anchorPosition: resolvedPartPosition,
          direction: -1,
          maxSegments: Number(aboveOptions.maxSegments || 0),
          maxChars: Number(aboveOptions.maxChars || 0),
          includeSource: aboveOptions.includeSource !== false,
          includeTarget: aboveOptions.includeTarget === true
        });
        aboveSourceText = collectDirectionalPartContext({
          parts: orderedParts,
          anchorPosition: resolvedPartPosition,
          direction: -1,
          maxSegments: Number(aboveOptions.maxSegments || 0),
          maxChars: Number(aboveOptions.maxChars || 0),
          includeSource: true,
          includeTarget: false
        });
        aboveTargetText = collectDirectionalPartContext({
          parts: orderedParts,
          anchorPosition: resolvedPartPosition,
          direction: -1,
          maxSegments: Number(aboveOptions.maxSegments || 0),
          maxChars: Number(aboveOptions.maxChars || 0),
          includeSource: false,
          includeTarget: true
        });
        neighborSource = 'partOrder';
      }

      if (includeBelowContext && resolvedPartPosition >= 0) {
        belowText = collectDirectionalPartContext({
          parts: orderedParts,
          anchorPosition: resolvedPartPosition,
          direction: 1,
          maxSegments: Number(belowOptions.maxSegments || 0),
          maxChars: Number(belowOptions.maxChars || 0),
          includeSource: belowOptions.includeSource !== false,
          includeTarget: belowOptions.includeTarget === true
        });
        belowSourceText = collectDirectionalPartContext({
          parts: orderedParts,
          anchorPosition: resolvedPartPosition,
          direction: 1,
          maxSegments: Number(belowOptions.maxSegments || 0),
          maxChars: Number(belowOptions.maxChars || 0),
          includeSource: true,
          includeTarget: false
        });
        belowTargetText = collectDirectionalPartContext({
          parts: orderedParts,
          anchorPosition: resolvedPartPosition,
          direction: 1,
          maxSegments: Number(belowOptions.maxSegments || 0),
          maxChars: Number(belowOptions.maxChars || 0),
          includeSource: false,
          includeTarget: true
        });
        neighborSource = 'partOrder';
      }
    }

    if (includeTargetText && !targetText && !resolvedPart && resolvedRange) {
      const rangeSegments = document.segments
        .filter((segment) => segment.index >= resolvedRange.start && segment.index <= resolvedRange.end)
        .sort((left, right) => left.index - right.index);
      targetText = rangeSegments.map((segment) => segment.targetText).join('');
      targetTextSource = targetText ? 'legacySegments' : targetTextSource;
    }

    if (includeAboveContext && !aboveText && !resolvedPart && resolvedRange) {
      aboveText = collectDirectionalContext({
        segments: document.segments,
        anchorIndex: resolvedRange.start,
        direction: -1,
        maxSegments: Number(aboveOptions.maxSegments || 0),
        maxChars: Number(aboveOptions.maxChars || 0),
        includeSource: aboveOptions.includeSource !== false,
        includeTarget: aboveOptions.includeTarget === true
      });
      aboveSourceText = collectDirectionalContext({
        segments: document.segments,
        anchorIndex: resolvedRange.start,
        direction: -1,
        maxSegments: Number(aboveOptions.maxSegments || 0),
        maxChars: Number(aboveOptions.maxChars || 0),
        includeSource: true,
        includeTarget: false
      });
      aboveTargetText = collectDirectionalContext({
        segments: document.segments,
        anchorIndex: resolvedRange.start,
        direction: -1,
        maxSegments: Number(aboveOptions.maxSegments || 0),
        maxChars: Number(aboveOptions.maxChars || 0),
        includeSource: false,
        includeTarget: true
      });
      neighborSource = aboveText ? 'legacySegments' : neighborSource;
    }

    if (includeBelowContext && !belowText && !resolvedPart && resolvedRange) {
      belowText = collectDirectionalContext({
        segments: document.segments,
        anchorIndex: resolvedRange.end,
        direction: 1,
        maxSegments: Number(belowOptions.maxSegments || 0),
        maxChars: Number(belowOptions.maxChars || 0),
        includeSource: belowOptions.includeSource !== false,
        includeTarget: belowOptions.includeTarget === true
      });
      belowSourceText = collectDirectionalContext({
        segments: document.segments,
        anchorIndex: resolvedRange.end,
        direction: 1,
        maxSegments: Number(belowOptions.maxSegments || 0),
        maxChars: Number(belowOptions.maxChars || 0),
        includeSource: true,
        includeTarget: false
      });
      belowTargetText = collectDirectionalContext({
        segments: document.segments,
        anchorIndex: resolvedRange.end,
        direction: 1,
        maxSegments: Number(belowOptions.maxSegments || 0),
        maxChars: Number(belowOptions.maxChars || 0),
        includeSource: false,
        includeTarget: true
      });
      neighborSource = belowText ? 'legacySegments' : neighborSource;
    }

    const hasSegmentSpecificContext = Boolean(targetText || aboveText || belowText || resolvedRange || resolvedPart);
    if (!hasSegmentSpecificContext && !includeFullText) {
      let reason = 'segment_not_aligned_with_active_part';
      if (!activePreviewPartIds.length) {
        reason = 'helper_connected_but_no_active_part';
      } else if (!activePartHasRange) {
        reason = 'active_part_without_range';
      }

      return {
        available: false,
        reason,
        previewMatchMode: partMatch?.previewMatchMode || 'unmatched',
        previewPartId: resolvedPart?.previewPartId || '',
        activePreviewPartIds,
        sourceFocusedRange,
        targetFocusedRange,
        previewAvailableFeatures,
        hasDocument: true,
        hasActivePreviewPart: activePreviewPartIds.length > 0,
        hasFocusedRange,
        neighborSource,
        targetTextSource
      };
    }

    return {
      available: true,
      documentId: String(document.documentId || documentId || ''),
      documentName: String(document.documentName || ''),
      importPath: String(document.importPath || ''),
      updatedAt: String(document.updatedAt || ''),
      currentRange: normalizeRange(document.currentRange),
      resolvedRange: resolvedRange || null,
      previewPartId: resolvedPart?.previewPartId || '',
      activePreviewPartIds,
      previewMatchMode: partMatch?.previewMatchMode || (resolvedPart ? 'legacySegmentIndex' : 'unmatched'),
      reason: partMatch?.reason || '',
      sourceFocusedRange,
      targetFocusedRange,
      previewAvailableFeatures,
      hasDocument: true,
      hasActivePreviewPart: activePreviewPartIds.length > 0,
      hasFocusedRange,
      neighborSource,
      targetTextSource,
      fullText: includeFullText
        ? (document.parts.length
          ? orderedParts
            .map((part) => part.sourceText)
            .join('\n')
          : document.segments
            .sort((left, right) => left.index - right.index)
            .map((segment) => segment.sourceText)
            .join(''))
        : '',
      targetText,
      aboveText,
      belowText,
      aboveSourceText,
      aboveTargetText,
      belowSourceText,
      belowTargetText
    };
  }

  function recordTranslation({
    documentId,
    sourceLanguage,
    targetLanguage,
    segmentIndex,
    translatedText
  }) {
    const document = readDocument(documentId, sourceLanguage, targetLanguage);
    if (!document) {
      return;
    }

    const targetIndex = parseSegmentIndex(segmentIndex);
    const segment = document.segments.find((item) => item.index === targetIndex)
      || document.segments.find((item) => item.index === targetIndex + 1)
      || document.segments.find((item) => item.index === targetIndex - 1);

    if (segment) {
      segment.targetText = String(translatedText || '');
    }

    if (segment?.previewPartId) {
      const part = (document.parts || []).find((item) => item.previewPartId === segment.previewPartId);
      if (part) {
        part.targetText = String(translatedText || '');
      }
    }
    document.updatedAt = new Date().toISOString();

    const fileName = createDocumentCacheFileName(documentId, sourceLanguage, targetLanguage);
    const filePath = path.join(documentsDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(document, null, 2));
  }

  function dispose() {
    if (child && !child.killed) {
      child.kill();
    }
    child = null;
  }

  return {
    start,
    dispose,
    getStatus,
    getContext,
    recordTranslation,
    readDocument,
    paths: {
      helperRoot,
      documentsDir,
      statusFilePath
    }
  };
}

module.exports = {
  createPreviewContextClient,
  createDocumentCacheFileName
};
