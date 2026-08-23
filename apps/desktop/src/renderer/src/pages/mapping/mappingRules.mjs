import { MEMOQ_METADATA_FIELDS, createDefaultMetadataMatchInput } from '../../memoqMetadata.js';

const RULE_VALUE_KEYS = MEMOQ_METADATA_FIELDS.map((field) => field.ruleKey);

export function sortMappingRules(rules = []) {
  return [...(Array.isArray(rules) ? rules : [])]
    .sort((left, right) => Number(left?.priority ?? 999) - Number(right?.priority ?? 999));
}

export function findNextRulePriority(rules = []) {
  const used = new Set((Array.isArray(rules) ? rules : [])
    .map((rule) => Number(rule?.priority))
    .filter((value) => Number.isFinite(value) && value > 0));
  const highest = Math.max(0, ...used);
  const appended = (Math.floor(highest / 10) + 1) * 10;
  if (appended <= 9999) return appended || 10;
  for (let candidate = 1; candidate <= 9999; candidate += 1) {
    if (!used.has(candidate)) return candidate;
  }
  return 9999;
}

export function createMappingRuleDraft(rule = {}, options = {}) {
  const source = rule && typeof rule === 'object' ? rule : {};
  const draft = {
    id: options.copy === true ? '' : String(source.id || ''),
    ruleName: String(source.ruleName || options.defaultName || '').trim(),
    enabled: source.enabled !== false,
    priority: Number.isFinite(Number(source.priority))
      ? Number(source.priority)
      : Number(options.priority || 10),
    profileId: String(source.profileId || options.profileId || ''),
    hitCount: options.copy === true ? 0 : Math.max(0, Number(source.hitCount || 0))
  };
  for (const key of RULE_VALUE_KEYS) draft[key] = String(source[key] ?? '').trim();
  return draft;
}

export function hasMappingRuleConditions(rule = {}) {
  return RULE_VALUE_KEYS.some((key) => String(rule?.[key] ?? '').trim() !== '');
}

export function getMappingRuleConditions(rule = []) {
  return MEMOQ_METADATA_FIELDS.flatMap((field) => {
    const value = String(rule?.[field.ruleKey] ?? '').trim();
    return value ? [{ ...field, value }] : [];
  });
}

export function buildMappingRuleConditionSummary(rule = {}, t = (key) => key) {
  const conditions = getMappingRuleConditions(rule);
  if (!conditions.length) return t('mapping.matchAll');
  return conditions.map((condition) => t('mapping.conditionSummary', {
    field: t(condition.inputLabelKey),
    matcher: t(`mapping.matcher.${condition.matcher}`),
    value: condition.value
  })).join(' · ');
}

export function validateDocumentIdRegex(value) {
  const pattern = String(value || '').trim();
  if (!pattern) return true;
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}

export function hasDuplicateRulePriority(rules = [], rule = {}) {
  const priority = Number(rule?.priority);
  if (!Number.isFinite(priority)) return false;
  const id = String(rule?.id || '');
  return (Array.isArray(rules) ? rules : []).some((candidate) => (
    String(candidate?.id || '') !== id && Number(candidate?.priority) === priority
  ));
}

export function createMappingTestInput(value = {}) {
  const defaults = createDefaultMetadataMatchInput();
  return Object.fromEntries(Object.keys(defaults).map((key) => [
    key,
    String(value?.[key] ?? defaults[key]).trim()
  ]));
}

export function getMappingTestResultKind(result = {}) {
  if (result?.rule && result?.profile) return 'rule';
  if (result?.rule) return 'missing';
  if (result?.profile) return 'default';
  return 'none';
}

export function buildMappingRulePayload(value = {}) {
  const draft = createMappingRuleDraft(value);
  return {
    ...(draft.id ? { id: draft.id } : {}),
    ruleName: draft.ruleName,
    enabled: draft.enabled,
    priority: draft.priority,
    profileId: draft.profileId,
    ...Object.fromEntries(RULE_VALUE_KEYS.map((key) => [key, draft[key]]))
  };
}

export { MEMOQ_METADATA_FIELDS };
