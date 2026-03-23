const {
  getProjectMetadataEntries,
  hasStructuredMetadata,
  normalizeMemoQMetadata,
  normalizeSegmentMetadataItem
} = require('../shared/memoqMetadataNormalizer');
const {
  createTemplateContext,
  renderTemplate,
  SYSTEM_PROMPT_FORBIDDEN_PLACEHOLDERS
} = require('../shared/promptTemplate');

const DEFAULT_PROFILE_SYSTEM_PROMPT = 'You are a professional translator working from {{source-language}} to {{target-language}}. Preserve placeholders, tags, formatting, and protected content. Follow the structured segment payload for terminology, TM hints, and document context.';
const DEFAULT_PROFILE_USER_PROMPT = [
  'Translate the segment below and return only the translation.',
  'Use the segment payload fields for matched terminology, TM hints, and neighboring context whenever they are present.',
  '',
  'Source segment:',
  '{{source-text}}',
  '',
  '[Current target text:',
  ']{{target-text}}[',
  ']',
  '[Above source context:',
  ']{{above-source-text}}[',
  ']',
  '[Below source context:',
  ']{{below-source-text}}[',
  ']'
].join('\n');
const DEFAULT_BATCH_SYSTEM_PROMPT = 'You are translating a batch from {{source-language}} to {{target-language}}. Keep terminology, placeholders, and formatting consistent across every segment. Use each segment payload for matched terminology, TM hints, and document context.';
const DEFAULT_BATCH_USER_PROMPT = [
  'Translate the segment below and return only the translation for that segment.',
  'Use the segment payload fields for matched terminology and TM hints whenever they are present.',
  '',
  'Source segment:',
  '{{source-text}}'
].join('\n');
const STRUCTURED_PROMPT_SCHEMA_VERSION = 'structured-v2';

function createMetadataSection(metadata, segmentMetadata) {
  const normalizedMetadata = normalizeMemoQMetadata(metadata);
  const sections = [];
  const projectEntries = getProjectMetadataEntries(normalizedMetadata);

  if (projectEntries.length) {
    sections.push([
      'Project context:',
      ...projectEntries.map(([label, value]) => `- ${label}: ${value}`)
    ].join('\n'));
  }

  const normalizedSegmentMetadata = segmentMetadata ? normalizeSegmentMetadataItem(segmentMetadata) : null;
  const segmentLines = [];

  if (normalizedMetadata.segmentStatus !== '' && !normalizedSegmentMetadata) {
    segmentLines.push(`- Segment status: ${normalizedMetadata.segmentStatus}`);
  }

  if (normalizedSegmentMetadata) {
    if (normalizedSegmentMetadata.segmentId) {
      segmentLines.push(`- Segment ID: ${normalizedSegmentMetadata.segmentId}`);
    }
    if (normalizedSegmentMetadata.segmentStatus !== '') {
      segmentLines.push(`- Segment status: ${normalizedSegmentMetadata.segmentStatus}`);
    }
    if (normalizedSegmentMetadata.segmentIndex >= 0) {
      segmentLines.push(`- Segment index: ${normalizedSegmentMetadata.segmentIndex}`);
    }
  }

  if (segmentLines.length) {
    sections.push(['Segment metadata:', ...segmentLines].join('\n'));
  }

  return sections;
}

function createInstructionSection(profile, requestType, renderedUserPrompt, helpers = {}) {
  const normalizedRequestType = helpers.normalizeRequestType
    ? helpers.normalizeRequestType(requestType)
    : String(requestType || 'Plaintext');
  const lines = [
    'Translate the source text faithfully.',
    'Return only the translated text without commentary.'
  ];

  if (renderedUserPrompt) {
    lines.push(`Profile instructions:\n${renderedUserPrompt}`);
  }

  if (normalizedRequestType === 'OnlyFormatting') {
    lines.push('Preserve formatting tags and inline structure exactly.');
  } else if (normalizedRequestType === 'BothFormattingAndTags') {
    lines.push('Preserve every formatting tag, inline tag, attribute, and entity exactly.');
  } else {
    lines.push('Return plain text only. Do not add markup, code fences, or hidden tags.');
  }

  return lines.join('\n');
}

function createTmSection(profile, tmSource, tmTarget) {
  if (!profile?.useBestFuzzyTm) {
    return '';
  }

  const lines = [];
  if (tmTarget) {
    lines.push(`- Best fuzzy TM target: ${tmTarget}`);
  }
  if (tmSource) {
    lines.push(`- Best fuzzy TM source: ${tmSource}`);
  }

  return lines.length ? ['Translation memory hints:', ...lines].join('\n') : '';
}

function createPreviewSections(previewContext = {}, segmentPreviewContext = {}, profile = {}) {
  if (profile?.usePreviewContext === false) {
    return [];
  }

  const shared = previewContext && typeof previewContext === 'object' ? previewContext : {};
  const segment = segmentPreviewContext && typeof segmentPreviewContext === 'object' ? segmentPreviewContext : {};
  const sections = [];
  const documentLines = [];
  const documentName = shared.documentName || shared.sourceDocument?.documentName || '';
  const documentGuid = shared.documentId || shared.sourceDocument?.documentGuid || '';
  const activePreviewPartId = shared.activePreviewPartId || '';

  if (documentName) {
    documentLines.push(`- Document name: ${documentName}`);
  }
  if (documentGuid) {
    documentLines.push(`- Document ID: ${documentGuid}`);
  }
  if (activePreviewPartId) {
    documentLines.push(`- Active preview part: ${activePreviewPartId}`);
  }
  if (documentLines.length) {
    sections.push(['Preview document context:', ...documentLines].join('\n'));
  }

  if (profile?.usePreviewSummary !== false && shared.summary) {
    sections.push(`Document summary:\n${shared.summary}`);
  }

  if (profile?.usePreviewFullText !== false && shared.fullText) {
    sections.push(`Preview full text:\n${shared.fullText}`);
  }

  const segmentLines = [];
  if (segment.previewPartId) {
    segmentLines.push(`- Preview part ID: ${segment.previewPartId}`);
  }
  if (profile?.usePreviewTargetText !== false && segment.targetText) {
    segmentLines.push(`- Current target text: ${segment.targetText}`);
  }
  if (segmentLines.length) {
    sections.push(['Focused preview part:', ...segmentLines].join('\n'));
  }

  if (profile?.usePreviewAboveBelow !== false && segment.aboveSourceText) {
    sections.push(`Above source context:\n${segment.aboveSourceText}`);
  }
  if (profile?.usePreviewAboveBelow !== false && segment.aboveTargetText) {
    sections.push(`Above target context:\n${segment.aboveTargetText}`);
  }
  if (profile?.usePreviewAboveBelow !== false && segment.belowSourceText) {
    sections.push(`Below source context:\n${segment.belowSourceText}`);
  }
  if (profile?.usePreviewAboveBelow !== false && segment.belowTargetText) {
    sections.push(`Below target context:\n${segment.belowTargetText}`);
  }

  return sections.filter(Boolean);
}

function buildPromptTemplateContext({
  sourceLanguage,
  targetLanguage,
  sourceText,
  tmSource,
  tmTarget,
  profile,
  assetContext,
  tbContext,
  previewContext,
  segmentPreviewContext
}) {
  const shared = previewContext && typeof previewContext === 'object' ? previewContext : {};
  const segment = segmentPreviewContext && typeof segmentPreviewContext === 'object' ? segmentPreviewContext : {};
  const normalizedAssetContext = assetContext && typeof assetContext === 'object' ? assetContext : {};
  const normalizedTbContext = tbContext && typeof tbContext === 'object' ? tbContext : {};
  const hasSegmentGlossary = Object.prototype.hasOwnProperty.call(normalizedTbContext, 'glossaryText');
  const hasSegmentTbMetadata = Object.prototype.hasOwnProperty.call(normalizedTbContext, 'tbMetadataText');

  return createTemplateContext({
    sourceLanguage,
    targetLanguage,
    sourceText,
    targetText: segment.targetText,
    tmSource,
    tmTarget,
    glossaryText: String(hasSegmentGlossary ? (normalizedTbContext.glossaryText || '') : (normalizedAssetContext.glossaryText || '')),
    tbMetadataText: String(hasSegmentTbMetadata ? (normalizedTbContext.tbMetadataText || '') : (normalizedAssetContext.tbMetadataText || '')),
    briefText: normalizedAssetContext.briefText,
    customTmSourceText: profile?.useCustomTm === false ? '' : tmSource,
    customTmTargetText: profile?.useCustomTm === false ? '' : tmTarget,
    aboveText: segment.above,
    belowText: segment.below,
    aboveSourceText: segment.aboveSourceText,
    aboveTargetText: segment.aboveTargetText,
    belowSourceText: segment.belowSourceText,
    belowTargetText: segment.belowTargetText,
    summaryText: shared.summary,
    fullText: shared.fullText
  });
}

function normalizeProfilePromptTemplateEntry(template = {}, defaults = {}) {
  return {
    systemPrompt: String(template?.systemPrompt || defaults.systemPrompt || DEFAULT_PROFILE_SYSTEM_PROMPT).trim() || DEFAULT_PROFILE_SYSTEM_PROMPT,
    userPrompt: String(template?.userPrompt || defaults.userPrompt || DEFAULT_PROFILE_USER_PROMPT).trim() || DEFAULT_PROFILE_USER_PROMPT
  };
}

function hasExplicitPromptTemplateOverrides(profile = {}) {
  if (String(profile?.systemPrompt || '').trim() || String(profile?.userPrompt || '').trim()) {
    return true;
  }

  const promptTemplates = profile?.promptTemplates && typeof profile.promptTemplates === 'object'
    ? profile.promptTemplates
    : null;
  if (!promptTemplates) {
    return false;
  }

  return ['single', 'batch'].some((mode) => {
    const template = promptTemplates?.[mode];
    return template && (
      String(template.systemPrompt || '').trim()
      || String(template.userPrompt || '').trim()
    );
  });
}

function resolveProfilePromptTemplate(profile = {}, mode = 'single') {
  const legacyTemplate = normalizeProfilePromptTemplateEntry({
    systemPrompt: profile?.systemPrompt,
    userPrompt: profile?.userPrompt
  });
  const promptTemplates = profile?.promptTemplates && typeof profile.promptTemplates === 'object'
    ? profile.promptTemplates
    : {};
  const singleTemplate = normalizeProfilePromptTemplateEntry(promptTemplates.single, legacyTemplate);

  if (mode === 'batch') {
    return promptTemplates.batch && typeof promptTemplates.batch === 'object'
      ? normalizeProfilePromptTemplateEntry(promptTemplates.batch, {
        systemPrompt: DEFAULT_BATCH_SYSTEM_PROMPT,
        userPrompt: DEFAULT_BATCH_USER_PROMPT
      })
      : normalizeProfilePromptTemplateEntry({}, {
        systemPrompt: DEFAULT_BATCH_SYSTEM_PROMPT,
        userPrompt: DEFAULT_BATCH_USER_PROMPT
      });
  }

  return singleTemplate;
}

function buildDocumentContext({ metadata, previewContext, profile, includeSummary = false }) {
  const documentContext = {
    projectMetadata: [],
    documentName: '',
    documentId: ''
  };

  if (profile?.useMetadata !== false && hasStructuredMetadata(metadata)) {
    documentContext.projectMetadata = getProjectMetadataEntries(normalizeMemoQMetadata(metadata))
      .map(([label, value]) => ({ label, value }));
  }

  if (profile?.usePreviewContext !== false) {
    documentContext.documentName = String(previewContext?.documentName || previewContext?.sourceDocument?.documentName || '');
    documentContext.documentId = String(previewContext?.documentId || previewContext?.sourceDocument?.documentGuid || '');
    if (includeSummary) {
      documentContext.summary = profile?.usePreviewSummary === false ? '' : String(previewContext?.summary || '');
    }
  }

  return documentContext;
}

function buildNeighborContext(segment = {}) {
  const previous = segment?.neighborContext?.previousSegment || null;
  const next = segment?.neighborContext?.nextSegment || null;

  return {
    previousSegment: previous ? {
      index: Number(previous.index),
      sourceText: String(previous.sourceText || ''),
      targetText: String(previous.targetText || '')
    } : null,
    nextSegment: next ? {
      index: Number(next.index),
      sourceText: String(next.sourceText || ''),
      targetText: String(next.targetText || '')
    } : null
  };
}

function renderSegmentProfileInstructions({
  segment,
  sourceLanguage,
  targetLanguage,
  previewContext,
  profile,
  assetContext,
  mode = 'single'
}) {
  const template = resolveProfilePromptTemplate(profile, mode);
  if (!template.userPrompt) {
    return '';
  }

  const templateContext = buildPromptTemplateContext({
    sourceLanguage,
    targetLanguage,
    sourceText: segment.sourceText,
    tmSource: segment.tmSource,
    tmTarget: segment.tmTarget,
    profile,
    assetContext,
    tbContext: segment.tbContext || null,
    previewContext,
    segmentPreviewContext: segment.previewContext || null
  });

  return renderTemplate(template.userPrompt, templateContext, {
    fieldLabel: 'User prompt',
    fieldName: 'userPrompt'
  });
}

function buildSegmentPayload({
  segment,
  profile,
  profileInstructions = ''
}) {
  const tmSourceText = String(segment.tmSource || '');
  const tmTargetText = String(segment.tmTarget || '');
  const matchedTerms = Array.isArray(segment?.tbContext?.termHits) ? segment.tbContext.termHits : [];
  const terminologyInstructions = String(segment?.tbContext?.glossaryText || '');
  const tbMetadataText = String(segment?.tbContext?.tbMetadataText || '');

  return {
    index: Number(segment.index),
    sourceText: String(segment.sourceText || ''),
    sourcePlainText: String(segment?.tbContext?.sourcePlainText || segment.plainText || segment.sourceText || ''),
    matchedTerms,
    neighborContext: buildNeighborContext(segment),
    tmHints: {
      sourceText: tmSourceText,
      targetText: tmTargetText,
      available: Boolean(tmSourceText || tmTargetText)
    },
    terminology: {
      instructions: terminologyInstructions,
      tbMetadataText,
      matches: matchedTerms,
      available: Boolean(terminologyInstructions || tbMetadataText || matchedTerms.length)
    },
    segmentMetadata: profile?.useMetadata === false
      ? null
      : normalizeSegmentMetadataItem(segment.segmentMetadata || {}, Number(segment.index)),
    previewContext: profile?.usePreviewContext === false ? null : {
      targetText: String(segment?.previewContext?.targetText || ''),
      previewPartId: String(segment?.previewContext?.previewPartId || '')
    },
    profileInstructions: String(profileInstructions || '')
  };
}

function pushMarkdownSection(lines, title, entries = []) {
  const normalizedEntries = entries.filter(Boolean);
  if (!normalizedEntries.length) {
    return;
  }

  lines.push(`## ${title}`);
  lines.push(...normalizedEntries);
}

function buildStableSystemPrompt({
  sourceLanguage,
  targetLanguage,
  requestType,
  metadata,
  previewContext,
  profile,
  templateContext,
  mode,
  helpers = {}
}) {
  const normalizedRequestType = helpers.normalizeRequestType
    ? helpers.normalizeRequestType(requestType)
    : String(requestType || 'Plaintext');
  const templatePair = resolveProfilePromptTemplate(profile, mode);
  const renderedSystemPrompt = renderTemplate(templatePair.systemPrompt, templateContext, {
    fieldLabel: 'System prompt',
    fieldName: 'systemPrompt',
    disallowedTokens: SYSTEM_PROMPT_FORBIDDEN_PLACEHOLDERS
  });
  const documentContext = buildDocumentContext({ metadata, previewContext, profile, includeSummary: true });
  const lines = ['# Translation Request'];

  pushMarkdownSection(lines, 'Task', [
    `- ${renderedSystemPrompt}`
  ]);
  pushMarkdownSection(lines, 'Output', [
    '- Return only JSON that matches the requested schema.',
    '- Do not explain your reasoning.',
    '- Schema: `{"translations":[{"index":<number>,"text":"<translation>"}]}`'
  ]);
  pushMarkdownSection(lines, 'Languages', [
    `- Source: ${sourceLanguage || ''}`,
    `- Target: ${targetLanguage || ''}`
  ]);

  const constraintLines = [];
  if (normalizedRequestType === 'OnlyFormatting') {
    constraintLines.push('- Preserve formatting tags and inline structure exactly.');
  } else if (normalizedRequestType === 'BothFormattingAndTags') {
    constraintLines.push('- Preserve every formatting tag, inline tag, attribute, and entity exactly.');
  } else {
    constraintLines.push('- Return translated plain text only inside the JSON output.');
  }

  constraintLines.push(
    '- Preserve protected symbols, numbers, codes, and placeholders.',
    '- Follow matched terminology whenever it is present.',
    '- If a term is forbidden, do not use the forbidden target form.'
  );
  pushMarkdownSection(lines, 'Constraints', constraintLines);

  if (String(profile?.translationStyle || '').trim()) {
    pushMarkdownSection(lines, 'Translation Style', [
      `- ${String(profile.translationStyle).trim()}`
    ]);
  }

  if (documentContext.projectMetadata.length) {
    pushMarkdownSection(lines, 'Project Metadata', documentContext.projectMetadata.map((item) => `- ${item.label}: ${item.value}`));
  }

  const documentEntries = [];
  if (documentContext.documentName || documentContext.documentId) {
    if (documentContext.documentName) {
      documentEntries.push(`- Document name: ${documentContext.documentName}`);
    }
    if (documentContext.documentId) {
      documentEntries.push(`- Document ID: ${documentContext.documentId}`);
    }
  }

  if (documentContext.summary) {
    documentEntries.push(`- Summary: ${documentContext.summary}`);
  }
  pushMarkdownSection(lines, 'Document Context', documentEntries);
  return lines.join('\n\n');
}

function buildRequestPayload({
  sourceLanguage,
  targetLanguage,
  requestType,
  metadata,
  previewContext,
  profile,
  segments,
  assetContext
}) {
  const normalizedSegments = Array.isArray(segments) ? segments : [];
  const mode = normalizedSegments.length > 1 ? 'batch' : 'single';
  const shouldRenderProfileInstructions = hasExplicitPromptTemplateOverrides(profile);
  const segmentInstructions = shouldRenderProfileInstructions
    ? normalizedSegments.map((segment) => renderSegmentProfileInstructions({
      segment,
      sourceLanguage,
      targetLanguage,
      previewContext,
      profile,
      assetContext,
      mode
    }))
    : [];
  const nonEmptyInstructions = segmentInstructions.filter((value) => String(value || '').trim());
  const sharedProfileInstructions = nonEmptyInstructions.length
    && nonEmptyInstructions.every((value) => value === nonEmptyInstructions[0])
    ? nonEmptyInstructions[0]
    : (mode === 'single' ? (segmentInstructions[0] || '') : '');

  return {
    schemaVersion: STRUCTURED_PROMPT_SCHEMA_VERSION,
    requestType: String(requestType || 'Plaintext'),
    sourceLanguage: String(sourceLanguage || ''),
    targetLanguage: String(targetLanguage || ''),
    documentContext: buildDocumentContext({ metadata, previewContext, profile }),
    sharedInstructions: {
      profileInstructions: String(sharedProfileInstructions || '')
    },
    segments: normalizedSegments.map((segment, index) => buildSegmentPayload({
      segment,
      profile,
      profileInstructions: sharedProfileInstructions ? '' : segmentInstructions[index]
    }))
  };
}

function buildPrompt(args, helpers = {}) {
  const {
    sourceLanguage,
    targetLanguage,
    sourceText,
    tmSource,
    tmTarget,
    metadata,
    previewContext,
    segmentPreviewContext,
    profile,
    requestType,
    assetContext,
    tbContext,
    segmentMetadata,
    neighborContext
  } = args;
  const templateContext = buildPromptTemplateContext({
    sourceLanguage,
    targetLanguage,
    sourceText,
    tmSource,
    tmTarget,
    profile,
    assetContext,
    tbContext,
    previewContext,
    segmentPreviewContext
  });
  const segment = {
    index: Number(segmentMetadata?.segmentIndex ?? 0),
    sourceText,
    plainText: tbContext?.sourcePlainText || sourceText,
    tmSource,
    tmTarget,
    segmentMetadata,
    previewContext: segmentPreviewContext || null,
    tbContext: tbContext || null,
    neighborContext: neighborContext || null
  };
  const payload = buildRequestPayload({
    sourceLanguage,
    targetLanguage,
    requestType,
    metadata,
    previewContext,
    profile,
    segments: [segment],
    assetContext
  });

  return {
    systemPrompt: buildStableSystemPrompt({
      sourceLanguage,
      targetLanguage,
      requestType,
      metadata,
      previewContext,
      profile,
      templateContext,
      mode: 'single',
      helpers
    }),
    prompt: JSON.stringify(payload, null, 2),
    payload,
    renderedSegment: payload.segments[0] || null
  };
}

function buildBatchPrompt(args, helpers = {}) {
  const {
    sourceLanguage,
    targetLanguage,
    segments,
    metadata,
    previewContext,
    profile,
    requestType,
    assetContext
  } = args;
  const templateContext = buildPromptTemplateContext({
    sourceLanguage,
    targetLanguage,
    profile,
    assetContext,
    previewContext
  });
  const payload = buildRequestPayload({
    sourceLanguage,
    targetLanguage,
    requestType,
    metadata,
    previewContext,
    profile,
    segments,
    assetContext
  });

  return {
    systemPrompt: buildStableSystemPrompt({
      sourceLanguage,
      targetLanguage,
      requestType,
      metadata,
      previewContext,
      profile,
      templateContext,
      mode: 'batch',
      helpers
    }),
    prompt: JSON.stringify(payload, null, 2),
    payload,
    renderedBatchInstructions: payload.segments
  };
}

module.exports = {
  STRUCTURED_PROMPT_SCHEMA_VERSION,
  buildBatchPrompt,
  buildPrompt,
  buildPromptTemplateContext,
  createInstructionSection,
  createMetadataSection,
  createPreviewSections,
  createTmSection,
  resolveProfilePromptTemplate
};
