const PLACEHOLDER_DEFINITIONS = [
  {
    token: 'source-language',
    label: 'Source language',
    description: 'The source language for the current translation request.',
    scope: 'request',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'target-language',
    label: 'Target language',
    description: 'The target language for the current translation request.',
    scope: 'request',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'source-text',
    label: 'Source text',
    description: 'The source text for the current segment.',
    scope: 'segment',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'target-text',
    label: 'Current target text',
    description: 'The current memoQ target text from preview context when available.',
    scope: 'preview-derived',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'tm-source-text',
    label: 'TM source text',
    description: 'The best fuzzy TM source text for the current segment when available.',
    scope: 'segment',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'tm-target-text',
    label: 'TM target text',
    description: 'The best fuzzy TM target text for the current segment when available.',
    scope: 'segment',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'glossary-text',
    label: 'Glossary text',
    description: 'Matched terminology instructions for the current segment when available.',
    scope: 'segment',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'tb-metadata-text',
    label: 'TB metadata text',
    description: 'Matched TB metadata for the current segment, including language pair and relevant entry details.',
    scope: 'segment',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'brief-text',
    label: 'Brief text',
    description: 'The bound brief content for the active profile when available.',
    scope: 'request',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'custom-tm-source-text',
    label: 'Custom TM source text',
    description: 'The custom TM source text for the current segment when available.',
    scope: 'segment',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'custom-tm-target-text',
    label: 'Custom TM target text',
    description: 'The custom TM target text for the current segment when available.',
    scope: 'segment',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'above-text',
    label: 'Above context',
    description: 'The preview-derived context above the current segment when available.',
    scope: 'preview-derived',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'below-text',
    label: 'Below context',
    description: 'The preview-derived context below the current segment when available.',
    scope: 'preview-derived',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'above-source-text',
    label: 'Above source context',
    description: 'The preview-derived source context above the current segment when available.',
    scope: 'preview-derived',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'above-target-text',
    label: 'Above target context',
    description: 'The preview-derived target context above the current segment when available.',
    scope: 'preview-derived',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'below-source-text',
    label: 'Below source context',
    description: 'The preview-derived source context below the current segment when available.',
    scope: 'preview-derived',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'below-target-text',
    label: 'Below target context',
    description: 'The preview-derived target context below the current segment when available.',
    scope: 'preview-derived',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'summary-text',
    label: 'Document summary',
    description: 'The generated preview summary for the current document when available.',
    scope: 'preview-derived',
    allowsRequired: true,
    allowsWrapper: true
  },
  {
    token: 'full-text',
    label: 'Full document text',
    description: 'The preview-derived full document text when available.',
    scope: 'preview-derived',
    allowsRequired: true,
    allowsWrapper: true
  }
];

const PLACEHOLDER_MAP = new Map(PLACEHOLDER_DEFINITIONS.map((item) => [item.token, item]));
const TEMPLATE_PATTERN = /(\[(?<before>[^\]]*)\])?{{\s*(?<token>[a-z-]+)(?<required>!)?\s*}}(\[(?<after>[^\]]*)\])?/g;
const SYSTEM_PROMPT_FORBIDDEN_PLACEHOLDERS = new Set([
  'glossary-text',
  'tb-metadata-text',
  'tm-source-text',
  'tm-target-text',
  'custom-tm-source-text',
  'custom-tm-target-text'
]);

class PromptTemplateError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'PromptTemplateError';
    this.code = code;
    this.details = details;
  }
}

function getSupportedPlaceholders() {
  return PLACEHOLDER_DEFINITIONS.map((item) => ({ ...item }));
}

function normalizeTemplate(value) {
  return String(value || '');
}

function createTemplateContext(values = {}) {
  return {
    'source-language': String(values.sourceLanguage || ''),
    'target-language': String(values.targetLanguage || ''),
    'source-text': String(values.sourceText || ''),
    'target-text': String(values.targetText || ''),
    'tm-source-text': String(values.tmSource || ''),
    'tm-target-text': String(values.tmTarget || ''),
    'glossary-text': String(values.glossaryText || ''),
    'tb-metadata-text': String(values.tbMetadataText || ''),
    'brief-text': String(values.briefText || ''),
    'custom-tm-source-text': String(values.customTmSourceText || ''),
    'custom-tm-target-text': String(values.customTmTargetText || ''),
    'above-text': String(values.aboveText || ''),
    'below-text': String(values.belowText || ''),
    'above-source-text': String(values.aboveSourceText || ''),
    'above-target-text': String(values.aboveTargetText || ''),
    'below-source-text': String(values.belowSourceText || ''),
    'below-target-text': String(values.belowTargetText || ''),
    'summary-text': String(values.summaryText || ''),
    'full-text': String(values.fullText || '')
  };
}

function listTemplatePlaceholders(template) {
  const normalizedTemplate = normalizeTemplate(template);
  const matches = [];

  normalizedTemplate.replace(TEMPLATE_PATTERN, (...args) => {
    const groups = args.at(-1) || {};
    matches.push({
      token: groups.token,
      required: groups.required === '!',
      before: groups.before || '',
      after: groups.after || ''
    });
    return args[0];
  });

  return matches;
}

function validateTemplate(template, options = {}) {
  const normalizedTemplate = normalizeTemplate(template);
  const fieldLabel = String(options.fieldLabel || 'Prompt template');
  const disallowedTokens = new Set(options.disallowedTokens || []);

  if (!normalizedTemplate) {
    return [];
  }

  const matches = listTemplatePlaceholders(normalizedTemplate);
  const stripped = normalizedTemplate.replace(TEMPLATE_PATTERN, '');

  if (stripped.includes('{{') || stripped.includes('}}')) {
    throw new PromptTemplateError(`${fieldLabel} contains malformed placeholder syntax.`, 'PROMPT_TEMPLATE_MALFORMED', {
      field: options.fieldName || ''
    });
  }

  for (const match of matches) {
    const definition = PLACEHOLDER_MAP.get(match.token);
    if (!definition) {
      throw new PromptTemplateError(`${fieldLabel} uses an unsupported placeholder: {{${match.token}}}.`, 'PROMPT_TEMPLATE_UNKNOWN_PLACEHOLDER', {
        field: options.fieldName || '',
        token: match.token
      });
    }
    if (disallowedTokens.has(match.token)) {
      throw new PromptTemplateError(`${fieldLabel} cannot use {{${match.token}}}. Put TM hints and terminology in the user prompt or segment payload instead.`, 'PROMPT_TEMPLATE_DISALLOWED_PLACEHOLDER', {
        field: options.fieldName || '',
        token: match.token
      });
    }
  }

  return matches;
}

function renderTemplate(template, context = {}, options = {}) {
  const normalizedTemplate = normalizeTemplate(template);
  const fieldLabel = String(options.fieldLabel || 'Prompt template');

  validateTemplate(normalizedTemplate, options);

  return normalizedTemplate.replace(TEMPLATE_PATTERN, (fullMatch, _before, _after, ...args) => {
    const groups = args.at(-1) || {};
    const definition = PLACEHOLDER_MAP.get(groups.token);

    if (!definition) {
      throw new PromptTemplateError(`${fieldLabel} uses an unsupported placeholder: {{${groups.token}}}.`, 'PROMPT_TEMPLATE_UNKNOWN_PLACEHOLDER', {
        field: options.fieldName || '',
        token: groups.token
      });
    }

    const value = String(context[groups.token] || '');
    const hasValue = value.trim() !== '';

    if (!hasValue && groups.required === '!') {
      throw new PromptTemplateError(`${fieldLabel} requires a value for {{${groups.token}!}}, but no value is available for this request.`, 'PROMPT_TEMPLATE_REQUIRED_VALUE_MISSING', {
        field: options.fieldName || '',
        token: groups.token
      });
    }

    if (!hasValue) {
      return '';
    }

    return `${groups.before || ''}${value}${groups.after || ''}`;
  });
}

function validateProfileTemplates(profile = {}) {
  validateTemplate(profile.systemPrompt, {
    fieldLabel: 'System prompt',
    fieldName: 'systemPrompt',
    disallowedTokens: SYSTEM_PROMPT_FORBIDDEN_PLACEHOLDERS
  });
  validateTemplate(profile.userPrompt, { fieldLabel: 'User prompt', fieldName: 'userPrompt' });

  const promptTemplates = profile?.promptTemplates || {};
  if (promptTemplates?.single) {
    validateTemplate(promptTemplates.single.systemPrompt, {
      fieldLabel: 'Single processing system prompt',
      fieldName: 'promptTemplates.single.systemPrompt',
      disallowedTokens: SYSTEM_PROMPT_FORBIDDEN_PLACEHOLDERS
    });
    validateTemplate(promptTemplates.single.userPrompt, { fieldLabel: 'Single processing user prompt', fieldName: 'promptTemplates.single.userPrompt' });
  }

  if (promptTemplates?.batch) {
    validateTemplate(promptTemplates.batch.systemPrompt, {
      fieldLabel: 'Batch processing system prompt',
      fieldName: 'promptTemplates.batch.systemPrompt',
      disallowedTokens: SYSTEM_PROMPT_FORBIDDEN_PLACEHOLDERS
    });
    validateTemplate(promptTemplates.batch.userPrompt, { fieldLabel: 'Batch processing user prompt', fieldName: 'promptTemplates.batch.userPrompt' });
  }
}

module.exports = {
  PromptTemplateError,
  createTemplateContext,
  getSupportedPlaceholders,
  listTemplatePlaceholders,
  renderTemplate,
  validateProfileTemplates,
  validateTemplate,
  SYSTEM_PROMPT_FORBIDDEN_PLACEHOLDERS
};
