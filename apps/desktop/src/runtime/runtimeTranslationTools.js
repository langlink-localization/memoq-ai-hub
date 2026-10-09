'use strict';
const { buildAssetContext } = require('../asset/assetContext');
const { buildSegmentTbContext, buildSegmentCustomTmContext } = require('./runtimePromptSupport');
const { buildTranslationEvidence } = require('./translationEvidence');
const { resolveHistoryRequest } = require('../shared/historyNavigation');
const { CONTRACT_VERSION } = require('../shared/desktopContract');

/** @param {Record<string, any>} dependencies */
function createRuntimeTranslationTools({ loadState, loadHistoryEntry, loadHistoryEntries, performTranslation, createId, hasSmartTbParsingCapability }) {
  const pending = new Set();
  /** @param {Record<string, any>} input */
  function testAssets(input = {}) {
    const state = loadState();
    const profile = state.profiles.find((/** @type {any} */ item) => item.id === input.profileId);
    if (!profile) throw new Error('Select an existing profile.');
    const sourceText = String(input.sourceText || '').trim();
    if (!sourceText || sourceText.length > 20000) throw new Error('Enter source text up to 20,000 characters.');
    const payload = { sourceLanguage: String(input.sourceLanguage || '').trim(), targetLanguage: String(input.targetLanguage || '').trim() };
    if (!payload.sourceLanguage || !payload.targetLanguage) throw new Error('Select both languages.');
    const assetContext = buildAssetContext({ assets: state.assets, assetBindings: profile.assetBindings, profile: { ...profile, smartTbParsingAvailable: hasSmartTbParsingCapability(state) } });
    /** @type {Record<string, any>} */
    const segment = { index: 0, sourceText, plainText: sourceText, tbContext: {}, customTmMatches: [] };
    segment.tbContext = buildSegmentTbContext({ assetContext, segment, payload, metadata: input.metadata || {} });
    segment.customTmMatches = buildSegmentCustomTmContext({ assetContext, segment, payload, profile }).matches;
    return { sourceText, ...payload, evidence: buildTranslationEvidence({ profile, assetContext, segment, hasResult: false }) };
  }
  /** @param {Record<string, any>} input */
  async function retranslateHistory(input = {}) {
    const original = loadHistoryEntry(String(input.historyId || ''));
    if (!original) throw new Error('The original translation record is no longer available.');
    const segment = original.segments?.find((/** @type {any} */ item) => Number(item.segmentIndex) === Number(input.segmentIndex));
    if (!segment) throw new Error('Select a recorded segment.');
    const profileId = String(input.profileId || original.profileId || '');
    if (!loadState().profiles.some((/** @type {any} */ item) => item.id === profileId)) throw new Error('The profile is no longer available. Select a current profile.');
    const key = `${original.id}:${segment.segmentIndex}`;
    if (pending.has(key)) throw new Error('This translation is already running.');
    pending.add(key);
    try {
      const requestId = createId('retranslate');
      const result = await performTranslation({
        requestId, traceId: createId('trace'), contractVersion: CONTRACT_VERSION,
        sourceLanguage: original.sourceLanguage, targetLanguage: original.targetLanguage,
        requestType: original.requestType || 'Plaintext', bypassTranslationCache: true, parentHistoryId: original.id, parentSegmentIndex: segment.segmentIndex,
        metadata: { ...(original.metadata || {}), segmentLevelMetadata: [{ segmentId: segment.segmentId, segmentStatus: segment.segmentStatus, segmentIndex: 0 }] }, profileResolution: { profileId, useCase: 'interactive' },
        segments: [{ index: 0, text: segment.sourceText, plainText: segment.plainText || segment.sourceText, tmSource: segment.tmSource || '', tmTarget: segment.tmTarget || '', tmDiagnostics: segment.tmDiagnostics || null }]
      });
      const resolved = resolveHistoryRequest(loadHistoryEntries(), requestId);
      const record = resolved.status === 'found' ? loadHistoryEntry(resolved.historyId) : null;
      return { statusCode: result.statusCode, error: result.body?.error || null, historyId: record?.id || '', sourceText: segment.sourceText, originalText: segment.targetText, translatedText: result.body?.translations?.[0]?.text || '', evidence: record?.segments?.[0]?.evidence || null };
    } finally { pending.delete(key); }
  }
  return { testAssets, retranslateHistory, resolveHistoryEntryByRequestId: (/** @type {string} */ requestId) => resolveHistoryRequest(loadHistoryEntries(), requestId) };
}
module.exports = { createRuntimeTranslationTools };
