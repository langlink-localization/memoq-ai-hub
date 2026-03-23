const crypto = require('crypto');
const { ERROR_CODES } = require('../shared/desktopContract');
const { normalizeMemoQMetadata, normalizeSegmentMetadataItem } = require('../shared/memoqMetadataNormalizer');
const { listTemplatePlaceholders } = require('../shared/promptTemplate');
const { isSharedOnlyPreviewRequest } = require('./runtimePreviewPolicy');
const {
  __internals: {
    resolveProfilePromptTemplate
  }
} = require('./runtimeState');

const STRUCTURED_PROMPT_SCHEMA_VERSION = 'structured-v2';
const DOCUMENT_SUMMARY_SOURCE_VERSION = 'summary-source-v4';
const DOCUMENT_SUMMARY_SOURCE_LIMIT = 18000;

function truncateSummarySourceText(value, maxCharacters = DOCUMENT_SUMMARY_SOURCE_LIMIT) {
  const normalized = String(value || '');
  if (!maxCharacters || normalized.length <= maxCharacters) {
    return normalized;
  }
  return `${normalized.slice(0, maxCharacters)}\n\n[Truncated for preview-context summary generation]`;
}

function collectInteractiveOnlyPlaceholders(profile = {}, mode = 'single', interactiveOnlyTokens = new Set()) {
  const placeholders = [];
  const templatePair = resolveProfilePromptTemplate(profile, mode);

  for (const [fieldName, fieldLabel, template] of [
    ['systemPrompt', 'System prompt', templatePair.systemPrompt],
    ['userPrompt', 'User prompt', templatePair.userPrompt]
  ]) {
    for (const placeholder of listTemplatePlaceholders(template)) {
      if (!interactiveOnlyTokens.has(placeholder.token)) {
        continue;
      }

      placeholders.push({
        fieldName,
        fieldLabel,
        token: placeholder.token,
        required: placeholder.required === true
      });
    }
  }

  return placeholders;
}

function validateRequestEligibility({ payload, profile, incomingSegments, interactiveOnlyTokens }) {
  const useCase = String(payload?.profileResolution?.useCase || '').trim().toLowerCase();
  const sharedOnly = isSharedOnlyPreviewRequest(payload, incomingSegments);
  const interactiveOnlyPlaceholders = collectInteractiveOnlyPlaceholders(
    profile,
    sharedOnly ? 'batch' : 'single',
    interactiveOnlyTokens
  );

  if (sharedOnly && interactiveOnlyPlaceholders.length) {
    const placeholderLabels = Array.from(new Set(interactiveOnlyPlaceholders.map((item) => `{{${item.token}${item.required ? '!' : ''}}}`)));
    const fields = Array.from(new Set(interactiveOnlyPlaceholders.map((item) => item.fieldLabel)));
    return {
      ok: false,
      code: ERROR_CODES.requestNotEligible,
      message: `${fields.join(' and ')} use interactive-only preview placeholders (${placeholderLabels.join(', ')}), but this ${useCase || 'shared-context'} request can only use shared preview context.`
    };
  }

  return { ok: true };
}

function buildProfileReferenceMessage(profileNames, entityLabel) {
  return `${entityLabel} is still referenced by: ${profileNames.join(', ')}. Remove those references first.`;
}

function createTranslationCacheKey({
  providerId,
  modelName,
  sourceLanguage,
  targetLanguage,
  requestType,
  sourceText,
  tmSource,
  tmTarget,
  metadata,
  segmentMetadata,
  profile,
  assetContext,
  tbFingerprint,
  previewContext,
  segmentPreviewContext,
  previewCacheContext,
  segmentPreviewCacheContext
}) {
  const normalizedMetadata = normalizeMemoQMetadata(metadata || {});
  const payload = JSON.stringify({
    promptSchemaVersion: STRUCTURED_PROMPT_SCHEMA_VERSION,
    providerId: String(providerId || ''),
    modelName: String(modelName || ''),
    sourceLanguage: String(sourceLanguage || ''),
    targetLanguage: String(targetLanguage || ''),
    requestType: String(requestType || ''),
    sourceText: String(sourceText || ''),
    tmSource: String(tmSource || ''),
    tmTarget: String(tmTarget || ''),
    metadata: {
      ...normalizedMetadata,
      segmentLevelMetadata: []
    },
    segmentMetadata: normalizeSegmentMetadataItem(segmentMetadata || {}),
    profile: {
      translationStyle: String(profile?.translationStyle || ''),
      useMetadata: profile?.useMetadata !== false,
      useBestFuzzyTm: profile?.useBestFuzzyTm !== false,
      useUploadedGlossary: profile?.useUploadedGlossary !== false,
      useCustomTm: profile?.useCustomTm !== false,
      useBrief: profile?.useBrief !== false,
      usePreviewContext: profile?.usePreviewContext !== false,
      usePreviewFullText: profile?.usePreviewFullText !== false,
      usePreviewSummary: profile?.usePreviewSummary !== false,
      usePreviewAboveBelow: profile?.usePreviewAboveBelow !== false,
      usePreviewTargetText: profile?.usePreviewTargetText !== false,
      assetSelections: profile?.assetSelections || {}
    },
    assetContext: {
      glossaryFingerprint: String(assetContext?.glossaryFingerprint || ''),
      briefFingerprint: String(assetContext?.briefFingerprint || ''),
      tbFingerprint: String(tbFingerprint || '')
    },
    previewContext: previewCacheContext || previewContext || null,
    segmentPreviewContext: segmentPreviewCacheContext || segmentPreviewContext || null
  });

  return crypto.createHash('sha256').update(payload).digest('hex');
}

function createAdaptiveTranslationCacheKey({
  sourceLanguage,
  targetLanguage,
  requestType,
  sourceText
}) {
  return crypto.createHash('sha256').update(JSON.stringify({
    kind: 'adaptive',
    sourceLanguage: String(sourceLanguage || ''),
    targetLanguage: String(targetLanguage || ''),
    requestType: String(requestType || ''),
    sourceText: String(sourceText || '')
  })).digest('hex');
}

function readCacheEntries(entries, key) {
  const entry = (entries || []).find((item) => item.key === key);
  return entry ? String(entry.text || '') : '';
}

function writeCacheEntries(entries, key, text, now, limit) {
  const nextEntry = {
    key,
    text: String(text || ''),
    updatedAt: now()
  };

  return {
    nextEntry,
    entries: [
      nextEntry,
      ...(entries || []).filter((item) => item.key !== key)
    ].slice(0, limit)
  };
}

function readTranslationCache(state, key) {
  return readCacheEntries(state.translationCache, key);
}

function writeTranslationCache(state, key, text, now) {
  const result = writeCacheEntries(state.translationCache, key, text, now, 2000);
  state.translationCache = result.entries;
  return result.nextEntry;
}

function createDocumentSummaryCacheKey({
  providerId,
  modelName,
  documentId,
  sourceLanguage,
  targetLanguage,
  fullText
}) {
  const truncatedFullText = truncateSummarySourceText(fullText);
  return crypto.createHash('sha256').update(JSON.stringify({
    summarySourceVersion: DOCUMENT_SUMMARY_SOURCE_VERSION,
    providerId: String(providerId || ''),
    modelName: String(modelName || ''),
    documentId: String(documentId || ''),
    sourceLanguage: String(sourceLanguage || ''),
    targetLanguage: String(targetLanguage || ''),
    fullText: truncatedFullText
  })).digest('hex');
}

function readDocumentSummaryCache(state, key) {
  return readCacheEntries(state.documentSummaryCache, key);
}

function writeDocumentSummaryCache(state, key, text, now) {
  const result = writeCacheEntries(state.documentSummaryCache, key, text, now, 300);
  state.documentSummaryCache = result.entries;
  return result.nextEntry;
}

function readPromptResponseCache(state, key) {
  return readCacheEntries(state.promptResponseCache, key);
}

function writePromptResponseCache(state, key, text, now) {
  const result = writeCacheEntries(state.promptResponseCache, key, text, now, 500);
  state.promptResponseCache = result.entries;
  return result.nextEntry;
}

module.exports = {
  collectInteractiveOnlyPlaceholders,
  validateRequestEligibility,
  buildProfileReferenceMessage,
  createTranslationCacheKey,
  createAdaptiveTranslationCacheKey,
  readTranslationCache,
  writeTranslationCache,
  truncateSummarySourceText,
  createDocumentSummaryCacheKey,
  readDocumentSummaryCache,
  writeDocumentSummaryCache,
  readPromptResponseCache,
  writePromptResponseCache
};
