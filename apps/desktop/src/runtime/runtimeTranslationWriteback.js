'use strict';

const { CONTRACT_VERSION, ERROR_CODES } = require('../shared/desktopContract');
const { createAdaptiveTranslationCacheKey } = require('./runtimeTranslationSupport');

// Gateway store-translations is a cache write, not a translation. It rejects
// a contract mismatch before any row is written.
/**
 * @param {{
 *   persistence: import('../types/runtimeDomain').RuntimePersistence,
 *   nowIso: () => string,
 *   createId: (prefix: string) => string,
 *   runtimeLogger: { info: (event: string, message: string, details?: Record<string, unknown>) => unknown }
 * }} dependencies
 */
function createRuntimeTranslationWriteback({
  persistence,
  nowIso,
  createId,
  runtimeLogger
}) {
  /**
   * @param {any} payload
   */
  async function storeTranslations(payload) {
    const requestId = payload.requestId || createId('store');
    const traceId = payload.traceId || createId('trace');

    if (payload.contractVersion !== undefined && String(payload.contractVersion) !== CONTRACT_VERSION) {
      return {
        statusCode: 409,
        body: {
          success: false,
          requestId,
          traceId,
          error: {
            code: ERROR_CODES.contractVersionMismatch,
            message: `Desktop contract version ${CONTRACT_VERSION} is required.`
          }
        }
      };
    }

    const sourceLanguage = String(payload.sourceLanguage || '').trim();
    const targetLanguage = String(payload.targetLanguage || '').trim();
    const requestType = String(payload.requestType || 'Plaintext').trim() || 'Plaintext';
    const entries = Array.isArray(payload.translations) ? payload.translations : [];

    if (!sourceLanguage || !targetLanguage) {
      return {
        statusCode: 400,
        body: {
          success: false,
          requestId,
          traceId,
          error: {
            code: ERROR_CODES.requestNotEligible,
            message: 'Translation writeback requires both sourceLanguage and targetLanguage.'
          }
        }
      };
    }

    let storedCount = 0;
    for (const entry of entries) {
      const sourceText = String(entry?.sourceText || '').trim();
      const targetText = String(entry?.targetText || '').trim();
      if (!sourceText || !targetText) {
        continue;
      }

      const adaptiveCacheKey = createAdaptiveTranslationCacheKey({
        sourceLanguage,
        targetLanguage,
        requestType,
        sourceText
      });
      persistence.writeTranslationCache(adaptiveCacheKey, targetText, nowIso());
      storedCount += 1;
    }

    runtimeLogger.info('store-translations-complete', 'Stored translations in cache.', {
      requestId,
      traceId,
      storedCount
    });
    return {
      statusCode: 200,
      body: {
        success: true,
        requestId,
        traceId,
        storedCount
      }
    };
  }

  return { storeTranslations };
}

module.exports = {
  createRuntimeTranslationWriteback
};
