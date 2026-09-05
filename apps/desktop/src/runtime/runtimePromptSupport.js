const crypto = require('crypto');

const {
  createTbFingerprint,
  matchTbEntries,
  renderMatchedTbMetadataBlock,
  renderMatchedTerminologyBlock
} = require('../asset/assetTerminology');
const {
  createCustomTmMatcher,
  matchCustomTmEntries,
  normalizeCustomTmMatchBuckets
} = require('../asset/assetTmMatcher');
const {
  createTemplateContext,
  renderTemplate,
  SYSTEM_PROMPT_FORBIDDEN_PLACEHOLDERS
} = require('../shared/promptTemplate');
const {
  isSharedOnlyPreviewRequest
} = require('./runtimePreviewPolicy');
const {
  __internals: {
    resolveProfilePromptTemplate
  }
} = require('./runtimeState');

/**
 * @param {any[]} assets
 * @param {any[]=} assetBindings
 * @returns {string[]}
 */
function summarizeAssets(assets, assetBindings = []) {
  const boundIds = new Set(assetBindings.map((binding) => binding.assetId));
  return assets.filter((asset) => boundIds.has(asset.id)).map((asset) => `${asset.type}:${asset.name}`);
}

/**
 * @returns {Record<string, any>}
 */
function createEmptyAssetContext() {
  return {
    glossaryText: '',
    tbMetadataText: '',
    glossaryFingerprint: crypto.createHash('sha256').update('').digest('hex'),
    briefText: '',
    briefFingerprint: crypto.createHash('sha256').update('').digest('hex'),
    customTmFingerprint: crypto.createHash('sha256').update('').digest('hex'),
    assetHints: [],
    tb: {
      entries: [],
      fingerprint: crypto.createHash('sha256').update('[]').digest('hex'),
      matcher: null,
      renderedText: '',
      languagePair: { source: '', target: '' }
    },
    customTm: {
      entries: [],
      fingerprint: crypto.createHash('sha256').update('[]').digest('hex'),
      matcher: createCustomTmMatcher([])
    }
  };
}

/**
 * @param {Record<string, any>} args
 */
function buildSegmentTbContext({
  assetContext,
  segment,
  payload,
  metadata
}) {
  const sourcePlainText = String(segment?.plainText || segment?.sourceText || '');
  const matches = matchTbEntries({
    matcher: assetContext?.tb?.matcher || null,
    text: sourcePlainText,
    srcLang: payload?.sourceLanguage || '',
    tgtLang: payload?.targetLanguage || '',
    metadata: {
      project: metadata?.projectId || '',
      client: metadata?.client || '',
      domain: metadata?.domain || ''
    }
  });
  const termHits = matches.map((match) => ({
    entryId: String(match.entryId || match?.entry?.id || ''),
    sourceTerm: String(match.sourceTerm || match?.entry?.sourceTerm || ''),
    targetTerm: String(match.targetTerm || match?.entry?.targetTerm || ''),
    forbidden: Boolean(match.forbidden ?? match?.entry?.forbidden),
    note: String(match.note || match?.entry?.note || ''),
    priority: Number(match.priority ?? match?.entry?.priority ?? 0),
    matchText: String(match.matchedText || ''),
    normalizedMatchText: String(match.normalizedMatchText || ''),
    start: Number(match.start),
    end: Number(match.end)
  }));

  return {
    sourcePlainText,
    matches,
    termHits,
    glossaryText: renderMatchedTerminologyBlock(matches),
    tbMetadataText: renderMatchedTbMetadataBlock(matches, assetContext?.tb || {}),
    fingerprint: createTbFingerprint(matches.map((match) => match.entry || match))
  };
}

/**
 * @param {Record<string, any>} args
 */
function buildSegmentCustomTmContext({
  assetContext,
  segment,
  payload,
  profile
}) {
  if (profile?.useCustomTm === false) {
    return {
      matches: [],
      fingerprint: ''
    };
  }

  const matches = matchCustomTmEntries({
    matcher: assetContext?.customTm?.matcher || null,
    segment,
    sourceLanguage: payload?.sourceLanguage || '',
    targetLanguage: payload?.targetLanguage || '',
    allowedBuckets: profile?.customTmMatchBuckets
  });
  const selectedBuckets = normalizeCustomTmMatchBuckets(profile?.customTmMatchBuckets);

  return {
    matches,
    fingerprint: [
      `buckets:${selectedBuckets.join(',')}`,
      ...matches.map((match) => [
        match.assetId,
        match.sourceText,
        match.targetText,
        match.score,
        match.bucket
      ].join('|'))
    ].join('\n')
  };
}

/**
 * @param {Record<string, any>} args
 */
function buildTemplatePreflightContext({
  payload,
  profile,
  assetContext,
  previewContext,
  segment
}) {
  const sharedPreview = previewContext && typeof previewContext === 'object' ? previewContext : {};
  const segmentPreview = segment?.previewContext && typeof segment.previewContext === 'object'
    ? segment.previewContext
    : {};
  const hasSegmentGlossary = segment?.tbContext && Object.prototype.hasOwnProperty.call(segment.tbContext, 'glossaryText');
  const hasSegmentTbMetadata = segment?.tbContext && Object.prototype.hasOwnProperty.call(segment.tbContext, 'tbMetadataText');

  return createTemplateContext({
    sourceLanguage: payload.sourceLanguage,
    targetLanguage: payload.targetLanguage,
    sourceText: segment?.sourceText || '',
    targetText: segmentPreview.targetText || '',
    tmSource: profile?.useBestFuzzyTm === false ? '' : (segment?.tmSource || ''),
    tmTarget: profile?.useBestFuzzyTm === false ? '' : (segment?.tmTarget || ''),
    glossaryText: hasSegmentGlossary ? (segment?.tbContext?.glossaryText || '') : (assetContext?.glossaryText || ''),
    tbMetadataText: hasSegmentTbMetadata ? (segment?.tbContext?.tbMetadataText || '') : (assetContext?.tbMetadataText || ''),
    briefText: assetContext?.briefText || '',
    customTmSourceText: profile?.useCustomTm === false ? '' : (segment?.customTmMatches?.[0]?.sourceText || ''),
    customTmTargetText: profile?.useCustomTm === false ? '' : (segment?.customTmMatches?.[0]?.targetText || ''),
    aboveText: profile?.usePreviewContext === false || profile?.usePreviewAboveBelow === false ? '' : (segmentPreview.above || ''),
    belowText: profile?.usePreviewContext === false || profile?.usePreviewAboveBelow === false ? '' : (segmentPreview.below || ''),
    aboveSourceText: profile?.usePreviewContext === false || profile?.usePreviewAboveBelow === false ? '' : (segmentPreview.aboveSourceText || ''),
    aboveTargetText: profile?.usePreviewContext === false || profile?.usePreviewAboveBelow === false ? '' : (segmentPreview.aboveTargetText || ''),
    belowSourceText: profile?.usePreviewContext === false || profile?.usePreviewAboveBelow === false ? '' : (segmentPreview.belowSourceText || ''),
    belowTargetText: profile?.usePreviewContext === false || profile?.usePreviewAboveBelow === false ? '' : (segmentPreview.belowTargetText || ''),
    summaryText: profile?.usePreviewContext === false || profile?.usePreviewSummary === false ? '' : (sharedPreview.summary || ''),
    fullText: profile?.usePreviewContext === false || profile?.usePreviewFullText === false ? '' : (sharedPreview.fullText || '')
  });
}

/**
 * @param {Record<string, any>} args
 */
function validateRuntimePromptTemplates({
  payload,
  profile,
  assetContext,
  previewContext,
  segments
}) {
  const normalizedSegments = Array.isArray(segments) ? segments : [];
  if (!normalizedSegments.length) {
    return;
  }
  const templatePair = resolveProfilePromptTemplate(
    profile,
    isSharedOnlyPreviewRequest(payload, normalizedSegments) ? 'batch' : 'single'
  );

  for (const segment of normalizedSegments) {
    const templateContext = buildTemplatePreflightContext({
      payload,
      profile,
      assetContext,
      previewContext,
      segment
    });

    renderTemplate(
      templatePair.systemPrompt,
      templateContext,
      {
        fieldLabel: 'System prompt',
        fieldName: 'systemPrompt',
        disallowedTokens: SYSTEM_PROMPT_FORBIDDEN_PLACEHOLDERS
      }
    );
    renderTemplate(
      templatePair.userPrompt,
      templateContext,
      { fieldLabel: 'User prompt', fieldName: 'userPrompt' }
    );
  }
}

module.exports = {
  buildSegmentTbContext,
  buildSegmentCustomTmContext,
  buildTemplatePreflightContext,
  createEmptyAssetContext,
  summarizeAssets,
  validateRuntimePromptTemplates
};
