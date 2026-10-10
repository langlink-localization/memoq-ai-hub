const crypto = require('crypto');
const { terminologyLanguageMatches } = require('../asset/assetTerminology');

/** Versioned, immutable facts about one result; never reconstruct old evidence from current assets.
 * @param {Record<string, any>} input
 */
function buildTranslationEvidence({ profile, assetContext, segment, attempts = [], hasResult = false }) {
  const index = Number(segment.index);
  const relevant = attempts.filter((/** @type {any} */ attempt) => (attempt.segmentIndexes || attempt.requestMetadata?.batchIndexes || []).includes(index));
  const finalAttempt = relevant.filter((/** @type {any} */ attempt) => attempt.success).at(-1);
  const isCache = (/** @type {any} */ attempt) => ['exact', 'adaptive'].includes(attempt?.cacheKind) || (attempt?.promptCacheLayer === 'local' && attempt?.promptCacheHit === true);
  const cache = isCache(finalAttempt);
  const modelInvoked = relevant.some((/** @type {any} */ attempt) => !isCache(attempt) && attempt.success && Boolean(attempt.requestMetadata));
  const hits = segment.tbContext?.termHits || [];
  const modelAttempted = relevant.some((/** @type {any} */ attempt) => !isCache(attempt) && Boolean(attempt.requestMetadata));
  const glossaryEnabled = profile.useUploadedGlossary !== false;
  const snapshots = assetContext.assetSnapshots || [];
  const languageApplicable = (/** @type {any} */ asset) => !(asset.languageDirections || asset.languagePairs)?.length || (asset.languageDirections || asset.languagePairs).some((/** @type {string} */ pair) => {
    const [source, target] = pair.split('|');
    const requestedSource = segment.tbContext?.sourceLanguage;
    const requestedTarget = segment.tbContext?.targetLanguage;
    return (terminologyLanguageMatches(source, requestedSource) && terminologyLanguageMatches(target, requestedTarget))
      || (!asset.languageDirections && terminologyLanguageMatches(target, requestedSource) && terminologyLanguageMatches(source, requestedTarget));
  });
  const glossaryBound = snapshots.some((/** @type {any} */ asset) => asset.purpose === 'glossary');
  const unsupported = snapshots.some((/** @type {any} */ asset) => asset.purpose === 'glossary' && languageApplicable(asset) && asset.memoqRules?.unsupportedEntries > 0);
  const terminologyStatus = assetContext.assetError ? 'asset_error' : !glossaryEnabled ? 'disabled' : !glossaryBound ? 'unbound' : snapshots.some((/** @type {any} */ asset) => asset.ruleDirectionRequired) ? 'configuration_required' : !snapshots.some((/** @type {any} */ asset) => asset.purpose === 'glossary' && languageApplicable(asset)) ? 'language_mismatch' : segment.qaSummary?.ok === false ? 'violated' : unsupported ? 'rules_unsupported' : !hits.length ? 'no_match' : !hasResult && !segment.qaSummary ? 'not_checked' : segment.qaSummary?.ok === true ? 'compliant' : 'not_checked';
  return {
    version: 1,
    profile: { id: profile.id, name: profile.name, fingerprint: crypto.createHash('sha256').update(JSON.stringify(profile)).digest('hex'), terminologyMode: profile.terminologyMode || 'advisory', terminologyRepairEnabled: profile.terminologyRepairEnabled === true, useUploadedGlossary: glossaryEnabled, useCustomTm: profile.useCustomTm !== false, useBrief: profile.useBrief !== false },
    resultSource: cache ? 'cache' : hasResult ? 'model' : 'none',
    cacheKind: cache ? (finalAttempt.promptCacheLayer === 'local' && finalAttempt.promptCacheHit ? 'prompt' : finalAttempt.cacheKind) : '',
    originalGeneration: cache ? 'not_recorded' : null,
    provider: cache || !finalAttempt ? null : { id: finalAttempt.providerId, name: finalAttempt.providerName, model: finalAttempt.model },
    modelInvoked,
    modelAttempted,
    attempts: relevant.map((/** @type {any} */ attempt) => ({ providerId: attempt.providerId, providerName: attempt.providerName, model: attempt.model, success: attempt.success === true, cache: isCache(attempt), repair: attempt.terminologyRepair === true })),
    assetError: assetContext.assetError || null,
    terminologyStatus,
    issues: segment.qaSummary?.issues || [],
    assets: snapshots.map((/** @type {any} */ asset) => {
      const matches = asset.purpose === 'glossary'
        ? hits.filter((/** @type {any} */ hit) => hit.assetId === asset.id)
        : asset.purpose === 'custom_tm' ? (segment.customTmMatches || []).filter((/** @type {any} */ hit) => hit.assetId === asset.id) : [];
      const enabled = asset.purpose === 'glossary' ? glossaryEnabled : asset.purpose === 'custom_tm' ? profile.useCustomTm !== false : profile.useBrief !== false;
      return { ...asset, enabled, matches: matches.map((/** @type {any} */ match) => ({ ...match, targetCheck: asset.purpose !== 'glossary' ? undefined : !segment.qaSummary ? 'not_checked' : (segment.qaSummary.issues || []).some((/** @type {any} */ issue) => issue.sourceTerm === match.sourceTerm && issue.targetTerm === match.targetTerm) ? 'violated' : 'compliant' })), matchStatus: asset.error ? 'asset_error' : !enabled ? 'disabled' : asset.purpose === 'brief' ? 'not_applicable' : !languageApplicable(asset) ? 'language_mismatch' : matches.length ? 'matched' : 'no_match', deliveryStatus: !enabled || (!matches.length && asset.purpose !== 'brief') ? 'not_sent' : modelInvoked ? 'sent' : modelAttempted ? 'unknown' : 'not_sent', sentToModel: modelInvoked && enabled && (asset.purpose === 'brief' ? asset.hasContent === true : matches.length > 0) };
    })
  };
}

module.exports = { buildTranslationEvidence };
