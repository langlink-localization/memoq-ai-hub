'use strict';

const { normalizeFinding } = require('./qaContracts');

function collect(pattern, value) {
  return (String(value || '').match(pattern) || []).map((item) => String(item)).sort();
}

function sameMultiset(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function addMismatch(findings, { ruleId, title, message, sourceEvidence, severity = 'major' }) {
  findings.push({
    category: 'formatting',
    severity,
    title,
    message,
    sourceEvidence,
    ruleId,
    confidence: 1,
    origin: 'deterministic'
  });
}

function runCustomRules(snapshot, rules, findings) {
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (rule?.enabled === false) continue;
    const scopeText = rule.scope === 'source' ? snapshot.segment.source : snapshot.segment.target;
    let matched = false;
    try {
      if (rule.type === 'regex') matched = new RegExp(String(rule.pattern || ''), String(rule.flags || '')).test(scopeText);
      if (rule.type === 'contains') matched = scopeText.includes(String(rule.value || ''));
      if (rule.type === 'not-contains') matched = !scopeText.includes(String(rule.value || ''));
    } catch {
      continue;
    }
    if (matched) {
      findings.push({
        category: rule.category || 'style',
        severity: rule.severity || 'minor',
        title: String(rule.name || 'Project rule'),
        message: String(rule.message || `Rule ${rule.name || rule.id || ''} matched.`),
        sourceEvidence: String(rule.pattern || rule.value || ''),
        suggestedTranslation: String(rule.suggestedTranslation || ''),
        ruleId: String(rule.id || 'custom-rule'),
        confidence: 1,
        origin: 'deterministic'
      });
    }
  }
}

function runDeterministicChecks(snapshot, options = {}) {
  const source = snapshot.segment.source;
  const target = snapshot.segment.target;
  const findings = [];

  if (!target.trim()) {
    findings.push({ category: 'completeness', severity: 'critical', title: 'Empty translation', message: 'The target segment is empty.', ruleId: 'empty-target', confidence: 1 });
  } else if (source.trim() === target.trim()) {
    findings.push({ category: 'accuracy', severity: 'major', title: 'Source and target are identical', message: 'The target is identical to the source.', sourceEvidence: source.slice(0, 500), ruleId: 'source-equals-target', confidence: 1 });
  }

  const structures = [
    ['numbers', /[-+]?\d+(?:[.,]\d+)*(?:%|‰)?/g, 'Numbers changed', 'Numbers in source and target do not match.'],
    ['dates', /\b(?:\d{1,4}[/.\-]\d{1,2}(?:[/.\-]\d{1,4})?|\d{1,2}:\d{2}(?::\d{2})?)\b/g, 'Dates or times changed', 'Dates or times in source and target do not match.'],
    ['currencies', /(?:[$€£¥₹₩]|\b(?:USD|EUR|GBP|CNY|JPY|RMB|CAD|AUD|CHF)\b)/gi, 'Currency markers changed', 'Currency markers in source and target do not match.'],
    ['units', /\b\d+(?:[.,]\d+)?\s?(?:mm|cm|km|kg|mg|ml|l|°[CF]|kWh|MHz|GHz|GB|MB)\b/gi, 'Units changed', 'Measurements in source and target do not match.'],
    ['tags', /<\/?[a-z][^>]*>/gi, 'Inline tags changed', 'Inline tags in source and target do not match.'],
    ['placeholders', /\{\{[^}]+\}\}|\{\d+\}|%\d*\$?[a-z]/gi, 'Placeholders changed', 'Placeholders in source and target do not match.'],
    ['urls', /https?:\/\/[^\s)\]}]+/gi, 'URLs changed', 'URLs in source and target do not match.'],
    ['emails', /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, 'Email addresses changed', 'Email addresses in source and target do not match.']
  ];
  for (const [ruleId, pattern, title, message] of structures) {
    const sourceItems = collect(pattern, source);
    const targetItems = collect(pattern, target);
    if (!sameMultiset(sourceItems, targetItems)) {
      addMismatch(findings, { ruleId, title, message, sourceEvidence: sourceItems.join(', ') });
    }
  }

  if (/^\s|\s$/.test(target)) {
    findings.push({ category: 'formatting', severity: 'minor', title: 'Outer whitespace', message: 'The target contains leading or trailing whitespace.', ruleId: 'outer-whitespace', confidence: 1 });
  }
  if (/ {2,}/.test(target)) {
    findings.push({ category: 'formatting', severity: 'minor', title: 'Repeated spaces', message: 'The target contains repeated spaces.', ruleId: 'repeated-space', confidence: 1 });
  }
  const sourceTerminal = source.trim().match(/[.!?。！？…]+$/)?.[0] || '';
  const targetTerminal = target.trim().match(/[.!?。！？…]+$/)?.[0] || '';
  if (sourceTerminal && !targetTerminal) {
    findings.push({ category: 'formatting', severity: 'minor', title: 'Terminal punctuation missing', message: 'The target is missing terminal punctuation.', sourceEvidence: sourceTerminal, ruleId: 'terminal-punctuation', confidence: 1 });
  }
  if (source.length >= 20 && target.trim()) {
    const ratio = target.length / source.length;
    if (ratio < 0.25 || ratio > 3) {
      findings.push({ category: 'completeness', severity: 'minor', title: 'Unusual length ratio', message: `Target/source length ratio is ${ratio.toFixed(2)}.`, ruleId: 'length-ratio', confidence: 0.9 });
    }
  }

  for (const match of Array.isArray(options.terminologyMatches) ? options.terminologyMatches : []) {
    const entry = match.entry || match;
    const variants = [entry.targetTerm, ...(entry.allowedVariants || [])].filter(Boolean);
    const normalizedTarget = target.toLocaleLowerCase();
    const present = variants.some((variant) => normalizedTarget.includes(String(variant).toLocaleLowerCase()));
    if ((!entry.forbidden && !present) || (entry.forbidden && present)) {
      findings.push({
        category: 'terminology',
        severity: 'major',
        title: entry.forbidden ? 'Forbidden terminology' : 'Required terminology missing',
        message: entry.forbidden
          ? `Do not use “${entry.targetTerm}” for “${entry.sourceTerm}”.`
          : `Use “${entry.targetTerm}” for “${entry.sourceTerm}”.`,
        sourceEvidence: String(entry.sourceTerm || ''),
        suggestedTranslation: '',
        ruleId: entry.forbidden ? 'forbidden-term' : 'required-term',
        termId: String(entry.id || ''),
        confidence: 1
      });
    }
  }

  runCustomRules(snapshot, options.rules, findings);
  return findings.map((finding) => normalizeFinding(finding, snapshot.revision.contentHash));
}

module.exports = { runDeterministicChecks };
