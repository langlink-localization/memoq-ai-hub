'use strict';

const {
  createTemplateContext,
  renderTemplate,
  SYSTEM_PROMPT_FORBIDDEN_PLACEHOLDERS
} = require('../shared/promptTemplate');

const DEFAULT_QA_SYSTEM_PROMPT = [
  'You are a professional translation quality reviewer working from {{source-language}} to {{target-language}}.',
  'Review accuracy, completeness, terminology, fluency, style, locale conventions, and formatting.'
].join(' ');

const DEFAULT_QA_USER_PROMPT = [
  'Inspect the current source and target segment for material translation issues.',
  'Use explicit source and target evidence, and follow matched terminology when available.',
  '',
  'Source segment:',
  '{{source-text}}',
  '',
  'Target segment:',
  '{{target-text}}',
  '',
  '[Matched terminology:',
  ']{{glossary-text}}[',
  ']'
].join('\n');

function normalizeQaPromptTemplate(template = {}) {
  return {
    systemPrompt: String(template?.systemPrompt || DEFAULT_QA_SYSTEM_PROMPT).trim() || DEFAULT_QA_SYSTEM_PROMPT,
    userPrompt: String(template?.userPrompt || DEFAULT_QA_USER_PROMPT).trim() || DEFAULT_QA_USER_PROMPT
  };
}

function renderTerminology(terminology = []) {
  return (Array.isArray(terminology) ? terminology : [])
    .map((match) => match?.entry || match)
    .filter((entry) => entry?.sourceTerm && entry?.targetTerm)
    .slice(0, 30)
    .map((entry) => `${entry.sourceTerm} => ${entry.targetTerm}${entry.forbidden ? ' (forbidden)' : ''}`)
    .join('\n');
}

function renderQaPromptTemplate({ template, snapshot, terminology = [] } = {}) {
  const normalized = normalizeQaPromptTemplate(template);
  const context = createTemplateContext({
    sourceLanguage: snapshot?.languages?.source,
    targetLanguage: snapshot?.languages?.target,
    sourceText: snapshot?.segment?.source,
    targetText: snapshot?.segment?.target,
    glossaryText: renderTerminology(terminology),
    aboveText: snapshot?.context?.above,
    belowText: snapshot?.context?.below,
    summaryText: snapshot?.context?.summary,
    fullText: snapshot?.context?.fullText
  });
  return {
    systemPrompt: renderTemplate(normalized.systemPrompt, context, {
      fieldLabel: 'QA system prompt',
      fieldName: 'promptTemplates.qa.systemPrompt',
      disallowedTokens: SYSTEM_PROMPT_FORBIDDEN_PLACEHOLDERS
    }),
    userPrompt: renderTemplate(normalized.userPrompt, context, {
      fieldLabel: 'QA user prompt',
      fieldName: 'promptTemplates.qa.userPrompt'
    })
  };
}

module.exports = {
  DEFAULT_QA_SYSTEM_PROMPT,
  DEFAULT_QA_USER_PROMPT,
  normalizeQaPromptTemplate,
  renderQaPromptTemplate
};
