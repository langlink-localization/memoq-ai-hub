'use strict';

const SIGNAL_WEIGHTS = Object.freeze({
  structuralValidity: 0.30,
  terminologyCompliance: 0.25,
  tmSupport: 0.25,
  providerScore: 0.20
});

const REPAIR_PENALTY = 0.15;
const FALLBACK_PENALTY = 0.20;
const INFO_LIMIT = 120;

/**
 * @param {any} value
 */
function clampUnit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number));
}

/**
 * @param {any} text
 */
function extractStructuralTokens(text) {
  return String(text || '').match(/<[^>]+>|\{\{[^}]+\}\}|\{\d+\}|%\d*\$?[a-z]/gi) || [];
}

/**
 * @param {any} sourceText
 * @param {any} translatedText
 */
function calculateStructuralValidity(sourceText, translatedText) {
  const sourceTokens = extractStructuralTokens(sourceText).sort();
  const targetTokens = extractStructuralTokens(translatedText).sort();
  return sourceTokens.length === targetTokens.length
    && sourceTokens.every((token, index) => token === targetTokens[index])
    ? 1
    : 0;
}

/**
 * @param {any} qaSummary
 * @param {any} matchCount
 */
function calculateTerminologyCompliance(qaSummary, matchCount = 0) {
  const total = Math.max(0, Number(matchCount) || 0);
  if (total === 0) return null;
  const issues = Array.isArray(qaSummary?.issues) ? qaSummary.issues.length : 0;
  return clampUnit((total - Math.min(total, issues)) / total);
}

/**
 * @param {any} matches
 */
function calculateTmSupport(matches = []) {
  const scores = matches
    .map((match) => Number(match?.score))
    .filter(Number.isFinite)
    .map((score) => Math.max(0, Math.min(100, score)) / 100);
  return scores.length ? Math.max(...scores) : null;
}

/**
 * @param {any} signals
 */
function calculateTranslationConfidence(signals = {}) {
  const normalized = {
    structuralValidity: clampUnit(signals.structuralValidity),
    terminologyCompliance: clampUnit(signals.terminologyCompliance),
    tmSupport: clampUnit(signals.tmSupport),
    providerScore: signals.providerScoreComparable === true ? clampUnit(signals.providerScore) : null,
    repairApplied: signals.repairApplied === true,
    fallbackApplied: signals.fallbackApplied === true
  };
  const independentSignals = ['terminologyCompliance', 'tmSupport', 'providerScore']
    .filter((key) => normalized[key] != null);
  if (normalized.structuralValidity == null || independentSignals.length === 0) {
    return { confidence: 0, signals: normalized };
  }

  const available = ['structuralValidity', ...independentSignals];
  const weight = available.reduce((sum, key) => sum + SIGNAL_WEIGHTS[key], 0);
  const weighted = available.reduce((sum, key) => sum + normalized[key] * SIGNAL_WEIGHTS[key], 0) / weight;
  const penalties = (normalized.repairApplied ? REPAIR_PENALTY : 0)
    + (normalized.fallbackApplied ? FALLBACK_PENALTY : 0);
  return {
    confidence: Number(Math.max(0, Math.min(1, weighted - penalties)).toFixed(4)),
    signals: normalized
  };
}

/**
 * @param {any} _
 */
function createTranslationInfo({ signals = {}, terminologyMatchCount = 0, locale = 'en' } = {}) {
  const zh = /^zh(?:-|$)/i.test(String(locale || ''));
  const parts = [];
  if (Number(terminologyMatchCount) > 0 && signals.terminologyCompliance != null) {
    const matched = Math.round(Number(terminologyMatchCount) * Number(signals.terminologyCompliance));
    parts.push(`${zh ? '术语' : 'Terminology'} ${matched}/${Number(terminologyMatchCount)}`);
  }
  if (signals.structuralValidity === 1) parts.push(zh ? '结构有效' : 'structure valid');
  if (signals.structuralValidity === 0) parts.push(zh ? '结构不一致' : 'structure mismatch');
  if (signals.tmSupport != null) parts.push(`TM ${Math.round(Number(signals.tmSupport) * 100)}%`);
  if (signals.repairApplied) parts.push(zh ? '响应已修复' : 'response repaired');
  if (signals.fallbackApplied) parts.push(zh ? '已使用回退' : 'fallback used');
  return parts.join('; ').slice(0, INFO_LIMIT);
}

/**
 * @param {any} _
 */
function enrichTranslationResult({ segment = {}, translation = {}, providerScoreComparable = false, targetLanguage = '' } = {}) {
  const terminologyMatches = Array.isArray(segment?.tbContext?.matches) ? segment.tbContext.matches : [];
  const qaSummary = segment.qaSummary || null;
  const confidenceResult = calculateTranslationConfidence({
    structuralValidity: calculateStructuralValidity(segment.sourceText, translation.text),
    terminologyCompliance: calculateTerminologyCompliance(qaSummary, terminologyMatches.length),
    tmSupport: calculateTmSupport(segment.customTmMatches),
    providerScore: translation.providerScore,
    providerScoreComparable,
    repairApplied: translation.repairApplied === true,
    fallbackApplied: translation.fallbackApplied === true
  });
  return {
    index: translation.index,
    text: String(translation.text || ''),
    confidence: confidenceResult.confidence,
    info: createTranslationInfo({
      signals: confidenceResult.signals,
      terminologyMatchCount: terminologyMatches.length,
      locale: targetLanguage || segment.targetLanguage || segment.languages?.target || ''
    }),
    confidenceSignals: confidenceResult.signals
  };
}

module.exports = {
  FALLBACK_PENALTY,
  INFO_LIMIT,
  REPAIR_PENALTY,
  SIGNAL_WEIGHTS,
  calculateStructuralValidity,
  calculateTerminologyCompliance,
  calculateTmSupport,
  calculateTranslationConfidence,
  createTranslationInfo,
  enrichTranslationResult
};
