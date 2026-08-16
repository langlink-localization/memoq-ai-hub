'use strict';

const crypto = require('crypto');
const { validateTemplate, SYSTEM_PROMPT_FORBIDDEN_PLACEHOLDERS } = require('./promptTemplate');
const { DEFAULT_QA_SYSTEM_PROMPT, DEFAULT_QA_USER_PROMPT } = require('../qa/qaPrompt');

const TRANSLATE_SYSTEM = 'You are a professional translator working from {{source-language}} to {{target-language}}. Preserve placeholders, tags, formatting, and protected content.';
const TRANSLATE_USER = 'Translate the source segment faithfully and return only the translation.\n\nSource segment:\n{{source-text}}';
const POLISH_SYSTEM = 'You are a professional target-language editor working from {{source-language}} to {{target-language}}. Preserve meaning, terminology, placeholders, tags, and formatting.';
const POLISH_USER = 'Improve the current target for grammar, fluency, clarity, and locale conventions. Return only the revised target.\n\nSource:\n{{source-text}}\n\nCurrent target:\n{{target-text}}';

const BUILTIN_PROMPT_PRESETS = Object.freeze([
  { id: 'builtin-qa-default', name: 'Default QA', scope: 'qa', style: '', systemPrompt: DEFAULT_QA_SYSTEM_PROMPT, userPrompt: DEFAULT_QA_USER_PROMPT, rules: [] },
  { id: 'builtin-qa-strict', name: 'Strict review', scope: 'qa', style: '', systemPrompt: DEFAULT_QA_SYSTEM_PROMPT, userPrompt: DEFAULT_QA_USER_PROMPT, rules: [{ instruction: 'Flag subtle omissions, mistranslations, inconsistent terminology, unnatural target-language grammar, and locale-convention problems when there is explicit evidence.' }] },
  { id: 'builtin-translate-literal', name: 'Literal translation', scope: 'translate', style: 'Faithful and close to the source structure while remaining grammatical in the target language.', systemPrompt: TRANSLATE_SYSTEM, userPrompt: TRANSLATE_USER, rules: [] },
  { id: 'builtin-translate-natural', name: 'Natural translation', scope: 'translate', style: 'Natural, fluent target-language wording with faithful meaning.', systemPrompt: TRANSLATE_SYSTEM, userPrompt: TRANSLATE_USER, rules: [] },
  { id: 'builtin-translate-localized', name: 'Localized translation', scope: 'translate', style: 'Adapt idiom, tone, punctuation, and locale conventions for the target audience without changing meaning.', systemPrompt: TRANSLATE_SYSTEM, userPrompt: TRANSLATE_USER, rules: [] },
  { id: 'builtin-polish-style', name: 'Polish and preserve style', scope: 'polish', style: 'Improve fluency and grammar while preserving the established voice, intent, and terminology.', systemPrompt: POLISH_SYSTEM, userPrompt: POLISH_USER, rules: [] }
].map((preset) => Object.freeze({ ...preset, builtin: true, updatedAt: '' })));

function createPresetId() {
  return `prompt_${crypto.randomUUID().replace(/-/g, '')}`;
}

function validatePromptPreset(preset = {}) {
  const scope = ['qa', 'translate', 'polish'].includes(preset.scope) ? preset.scope : '';
  if (!scope) throw new Error('Prompt preset scope must be qa, translate, or polish.');
  if (!String(preset.name || '').trim()) throw new Error('Prompt preset name is required.');
  validateTemplate(preset.systemPrompt, { fieldLabel: `${scope} preset system prompt`, fieldName: 'systemPrompt', disallowedTokens: SYSTEM_PROMPT_FORBIDDEN_PLACEHOLDERS });
  validateTemplate(preset.userPrompt, { fieldLabel: `${scope} preset user prompt`, fieldName: 'userPrompt' });
  return true;
}

function normalizePromptPreset(preset = {}, fallback = {}) {
  const normalized = {
    id: String(preset.id || fallback.id || createPresetId()).trim(),
    name: String(preset.name || fallback.name || 'Prompt preset').trim(),
    scope: ['qa', 'translate', 'polish'].includes(preset.scope) ? preset.scope : fallback.scope,
    style: String(preset.style ?? fallback.style ?? '').trim(),
    systemPrompt: String(preset.systemPrompt || fallback.systemPrompt || '').trim(),
    userPrompt: String(preset.userPrompt || fallback.userPrompt || '').trim(),
    rules: (Array.isArray(preset.rules) ? preset.rules : fallback.rules || []).map((rule) => ({ instruction: String(rule?.instruction || rule || '').trim() })).filter((rule) => rule.instruction),
    builtin: fallback.builtin === true || preset.builtin === true,
    updatedAt: String(preset.updatedAt || fallback.updatedAt || new Date().toISOString())
  };
  validatePromptPreset(normalized);
  return normalized;
}

function normalizePromptPresets(value) {
  const input = Array.isArray(value) ? value : [];
  const existing = new Map(input.filter((item) => item?.id).map((item) => [String(item.id), item]));
  const result = BUILTIN_PROMPT_PRESETS.map((builtin) => normalizePromptPreset(existing.get(builtin.id) || builtin, builtin));
  const builtinIds = new Set(BUILTIN_PROMPT_PRESETS.map((item) => item.id));
  input.forEach((item) => {
    if (item?.id && !builtinIds.has(String(item.id))) result.push(normalizePromptPreset(item));
  });
  return result;
}

function restoreBuiltinPromptPreset(id) {
  const preset = BUILTIN_PROMPT_PRESETS.find((item) => item.id === String(id || ''));
  if (!preset) throw new Error(`Built-in prompt preset ${id || 'unknown'} was not found.`);
  return normalizePromptPreset(preset, preset);
}

module.exports = { BUILTIN_PROMPT_PRESETS, createPresetId, normalizePromptPreset, normalizePromptPresets, restoreBuiltinPromptPreset, validatePromptPreset };
