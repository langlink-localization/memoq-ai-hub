const { MEMOQ_METADATA_FIELDS } = require('../shared/memoqMetadata');

function toSafeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function matchRegex(value, expression) {
  const pattern = toSafeString(expression);
  if (!pattern) return true;
  try {
    return new RegExp(pattern, 'i').test(toSafeString(value));
  } catch (_error) {
    return false;
  }
}

function includesText(value, expected) {
  const source = toSafeString(value).toLowerCase();
  const needle = toSafeString(expected).toLowerCase();
  if (!needle) return true;
  return source.includes(needle);
}

function equalsText(value, expected) {
  const normalizedExpected = toSafeString(expected);
  if (!normalizedExpected) return true;
  return toSafeString(value).toLowerCase() === normalizedExpected.toLowerCase();
}

function evaluateRule(rule, metadata = {}) {
  if (!rule || rule.enabled === 0 || rule.enabled === false) {
    return { matched: false, reasons: ['disabled'] };
  }

  const reasons = [];
  const checks = MEMOQ_METADATA_FIELDS.map((field) => {
    const metadataValue = metadata[field.metadataKey];
    const ruleValue = rule[field.ruleKey];

    if (field.matcher === 'includes') {
      return [field.ruleKey, includesText(metadataValue, ruleValue)];
    }

    if (field.matcher === 'regex') {
      return [field.ruleKey, matchRegex(metadataValue, ruleValue)];
    }

    return [field.ruleKey, equalsText(metadataValue, ruleValue)];
  });

  for (const [label, passed] of checks) {
    if (!passed) {
      reasons.push(label);
    }
  }

  return {
    matched: reasons.length === 0,
    reasons
  };
}

function resolveRuleMatch(rules = [], metadata = {}) {
  const sorted = [...rules].sort((left, right) => Number(left.priority || 999) - Number(right.priority || 999));
  for (const rule of sorted) {
    const result = evaluateRule(rule, metadata);
    if (result.matched) {
      return {
        rule,
        reasons: result.reasons
      };
    }
  }

  return null;
}

module.exports = {
  evaluateRule,
  resolveRuleMatch
};
