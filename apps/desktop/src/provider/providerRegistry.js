const crypto = require('crypto');
const {
  SUPPORTED_REQUEST_PATHS,
  buildProviderRequestUrl,
  getDefaultBaseUrl,
  getDefaultModelName,
  getDefaultProviderName,
  getDefaultRequestPath,
  getProviderCapabilities,
  getProviderModelResponseFormat,
  isSupportedProviderType,
  normalizeThroughputMode,
  normalizeProviderType,
  normalizeResponseFormat,
  sanitizeProvider,
  validateCompatibleRequestPath,
  validateProviderRequestInput
} = require('./providerConfig');
const {
  normalizeSegmentMetadataItem
} = require('../shared/memoqMetadataNormalizer');
const {
  renderTemplate
} = require('../shared/promptTemplate');
const {
  buildBatchPrompt,
  buildPrompt
} = require('./providerPromptBuilder');
const { renderQaPromptTemplate } = require('../qa/qaPrompt');
const {
  extractJsonText,
  mapProviderError,
  normalizeRequestType,
  normalizeTranslatedText,
  parseBatchTranslations,
  parseSingleTranslation,
  stripCodeFences
} = require('./providerResponseUtils');
const {
  attachRetryAfter,
  createClient,
  createProviderTransport,
  loadSdkModules,
  shouldFallbackFromStructuredError,
  withAbortableTimeout
} = require('./providerTransportSupport');

const BATCH_TRANSLATIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translations'],
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'text'],
        properties: {
          index: { type: 'integer' },
          text: { type: 'string' }
        }
      }
    }
  }
};

const SINGLE_TRANSLATION_SCHEMA = BATCH_TRANSLATIONS_SCHEMA;

const QA_FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'severity', 'title', 'message', 'sourceEvidence', 'targetEvidence', 'suggestedTranslation', 'confidence'],
        properties: {
          category: { type: 'string', enum: ['accuracy', 'completeness', 'terminology', 'fluency', 'style', 'locale-convention', 'formatting', 'other'] },
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] },
          title: { type: 'string' },
          message: { type: 'string' },
          sourceEvidence: { type: 'string' },
          targetEvidence: { type: 'string' },
          suggestedTranslation: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 }
        }
      }
    }
  }
};

const DEFAULT_PROFILE_SYSTEM_PROMPT = 'You are a precise translation assistant.';

/** @typedef {import('./providerPromptBuilder').PromptProfileInput} PromptProfileInput */
/** @typedef {import('./providerPromptBuilder').PromptPreviewContextInput} PromptPreviewContextInput */
/** @typedef {import('./providerPromptBuilder').SegmentPreviewContextInput} SegmentPreviewContextInput */
/** @typedef {import('./providerPromptBuilder').PromptAssetContextInput} PromptAssetContextInput */
/** @typedef {import('./providerPromptBuilder').PromptTbContextInput} PromptTbContextInput */
/** @typedef {import('./providerPromptBuilder').CustomTmMatchInput} CustomTmMatchInput */
/** @typedef {import('./providerPromptBuilder').StructuredSegmentPayload} StructuredSegmentPayload */
/** @typedef {import('./providerPromptBuilder').BuiltBatchPrompt} BuiltBatchPrompt */

/**
 * @typedef {Object} RegistryRequestOptions
 * @property {boolean=} localPromptCacheEnabled
 * @property {((key: string) => string)=} readPromptCache
 * @property {((key: string, text: string) => void)=} writePromptCache
 * @property {boolean=} providerPromptCacheEnabled
 * @property {string=} promptCacheTtlHint
 * @property {string=} promptCacheKey
 */

/**
 * @typedef {Object} PromptCacheInfo
 * @property {string} key
 * @property {'local' | 'provider' | 'none'} layer
 * @property {boolean} hit
 */

/**
 * @typedef {Object} RegistryProviderRef
 * @property {string=} id
 * @property {string=} name
 * @property {string=} type
 * @property {string=} baseUrl
 * @property {string=} requestPath
 * @property {Record<string, unknown>=} capabilities
 */

/**
 * @typedef {Object} ConnectionTestResult
 * @property {boolean} ok
 * @property {number | null} latencyMs
 * @property {string=} code
 * @property {string} message
 */

/**
 * @typedef {Object} DiscoverModelsResult
 * @property {boolean} ok
 * @property {Array<{ modelName: string }>} models
 * @property {string=} code
 * @property {string=} message
 */

/**
 * @typedef {Object} QualityCheckResult
 * @property {unknown} output
 * @property {number} latencyMs
 * @property {Record<string, unknown> | null} providerMetadata
 * @property {string} providerId
 * @property {string} providerName
 * @property {string} model
 */

/**
 * @typedef {Object} TranslateSegmentResult
 * @property {string} text
 * @property {number} latencyMs
 * @property {{ mode: 'single', segmentIndexes: number[], systemPrompt: string, promptPreview: string, userPrompt: string, items: StructuredSegmentPayload[] }=} requestMetadata
 * @property {PromptCacheInfo} promptCache
 */

/**
 * @typedef {Object} BatchRequestMetadata
 * @property {'batch'} mode
 * @property {number[]} batchIndexes
 * @property {number} segmentCount
 * @property {string} systemPrompt
 * @property {string} userPrompt
 * @property {string} promptPreview
 * @property {Array<{ index: number, sourceText: string, userPrompt: string }>} items
 */

/**
 * @typedef {Object} TranslateBatchResult
 * @property {Array<{ index: number, text: string }>} translations
 * @property {number} latencyMs
 * @property {PromptCacheInfo} promptCache
 * @property {BatchRequestMetadata=} requestMetadata
 */

/**
 * @typedef {Object} GenerateTextInput
 * @property {RegistryProviderRef} provider
 * @property {string=} apiKey
 * @property {string=} modelName
 * @property {unknown=} systemPrompt
 * @property {unknown=} prompt
 * @property {number=} maxOutputTokens
 * @property {number=} temperature
 * @property {number=} timeoutMs
 */

/**
 * @typedef {Object} CheckQualityInput
 * @property {RegistryProviderRef} provider
 * @property {string=} apiKey
 * @property {string=} modelName
 * @property {import('../qa/qaContracts').QaSnapshot} snapshot
 * @property {Array<Record<string, unknown>>=} terminology
 * @property {Array<Record<string, unknown>>=} tmMatches
 * @property {Array<Record<string, unknown>>=} naturalLanguageRules
 * @property {Record<string, unknown>=} promptTemplate
 * @property {string=} additionalInstruction
 * @property {string=} repairInstruction
 * @property {number=} timeoutMs
 * @property {AbortSignal=} signal
 */

/**
 * @typedef {Object} TranslateSegmentInput
 * @property {RegistryProviderRef} provider
 * @property {string=} apiKey
 * @property {string=} modelName
 * @property {unknown=} sourceLanguage
 * @property {unknown=} targetLanguage
 * @property {unknown=} sourceText
 * @property {unknown=} tmSource
 * @property {unknown=} tmTarget
 * @property {CustomTmMatchInput[]=} customTmMatches
 * @property {Record<string, unknown>=} metadata
 * @property {PromptPreviewContextInput=} previewContext
 * @property {PromptProfileInput=} profile
 * @property {unknown=} requestType
 * @property {PromptAssetContextInput=} assetContext
 * @property {PromptTbContextInput=} tbContext
 * @property {Record<string, unknown>=} segmentMetadata
 * @property {SegmentPreviewContextInput=} segmentPreviewContext
 * @property {Record<string, any>=} neighborContext
 * @property {RegistryRequestOptions=} requestOptions
 * @property {string=} operation
 * @property {number=} timeoutMs
 */

/**
 * @typedef {Object} DiscoverModelsInput
 * @property {RegistryProviderRef} provider
 * @property {string=} apiKey
 * @property {number=} timeoutMs
 */

/**
 * @typedef {Object} TranslateBatchSegmentInput
 * @property {unknown=} index
 * @property {unknown=} sourceText
 * @property {unknown=} tmSource
 * @property {unknown=} tmTarget
 * @property {CustomTmMatchInput[]=} customTmMatches
 * @property {Record<string, unknown>=} segmentMetadata
 * @property {SegmentPreviewContextInput | null=} previewContext
 * @property {PromptTbContextInput & { fingerprint?: string }=} tbContext
 * @property {Record<string, any>=} neighborContext
 */

/**
 * @typedef {Object} TranslateBatchInput
 * @property {RegistryProviderRef} provider
 * @property {string=} apiKey
 * @property {string=} modelName
 * @property {unknown=} sourceLanguage
 * @property {unknown=} targetLanguage
 * @property {TranslateBatchSegmentInput[]=} segments
 * @property {Record<string, unknown>=} metadata
 * @property {PromptPreviewContextInput=} previewContext
 * @property {PromptProfileInput=} profile
 * @property {unknown=} requestType
 * @property {number=} timeoutMs
 * @property {PromptAssetContextInput=} assetContext
 * @property {RegistryRequestOptions=} requestOptions
 */

/**
 * @param {Record<string, any>=} provider
 * @returns {boolean}
 */
function isOpenRouterProvider(provider = {}) {
  return String(provider?.baseUrl || '').trim().toLowerCase().includes('openrouter.ai');
}

/**
 * @param {Record<string, any>} provider
 * @param {Record<string, any>} mappedError
 * @returns {string}
 */
function buildConnectionTestFailureMessage(provider, mappedError) {
  const baseMessage = String(mappedError?.message || 'Connection test failed.').trim();
  const normalized = baseMessage.toLowerCase();

  if (isOpenRouterProvider(provider) && normalized.includes('author') && normalized.includes('banned')) {
    return `${baseMessage} OpenRouter rejected the selected model author. Choose a different model or use Discover Models to pick an allowed model ID.`;
  }

  if (
    String(provider?.type || '').trim().toLowerCase() === 'openai-compatible'
    && normalized.includes('model')
    && (
      normalized.includes('not found')
      || normalized.includes('does not exist')
      || normalized.includes('unknown')
      || normalized.includes('invalid')
    )
  ) {
    return `${baseMessage} Use Discover Models or enter the exact provider-specific model ID.`;
  }

  return baseMessage;
}

/**
 * @param {Record<string, any>} args
 * @returns {string}
 */
function createPromptCacheKey({
  provider,
  modelName,
  requestType,
  sourceLanguage,
  targetLanguage,
  systemPrompt,
  prompt
}) {
  const sanitizedProvider = sanitizeProvider(provider);
  const payload = JSON.stringify({
    providerId: String(sanitizedProvider.id || ''),
    providerType: sanitizedProvider.type,
    modelName: String(modelName || ''),
    requestType: normalizeRequestType(requestType),
    sourceLanguage: String(sourceLanguage || ''),
    targetLanguage: String(targetLanguage || ''),
    systemPrompt: String(systemPrompt || ''),
    prompt: String(prompt || '')
  });

  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * @param {Record<string, any>=} options
 */
function createProviderRegistry(options = {}) {
  const sdkLoader = options.sdkLoader || loadSdkModules;
  const fetchImpl = options.fetch || globalThis.fetch?.bind(globalThis);
  const { callTextModel, callStructuredModel, streamText } = createProviderTransport({ sdkLoader });

  /**
 * @param {{ provider: RegistryProviderRef, apiKey?: string, modelName?: string, timeoutMs?: number }} input
 * @returns {Promise<ConnectionTestResult>}
 */
async function testConnection({ provider, apiKey, modelName, timeoutMs = 30000 }) {
    try {
      const result = await callTextModel({
        provider,
        apiKey,
        modelName: modelName || getDefaultModelName(provider.type),
        prompt: 'Reply with OK only.',
        timeoutMs
      });

      return {
        ok: true,
        latencyMs: result.latencyMs,
        message: 'Connection test succeeded.'
      };
    } catch (error) {
      const mapped = mapProviderError(error);
      return {
        ok: false,
        latencyMs: null,
        code: mapped.code,
        message: buildConnectionTestFailureMessage(provider, mapped)
      };
    }
  }

  /**
 * @param {GenerateTextInput} input
 * @returns {Promise<{ text?: string, latencyMs?: number, providerMetadata?: Record<string, unknown> | null }>}
 */
async function generateText({
    provider,
    apiKey,
    modelName,
    systemPrompt,
    prompt,
    maxOutputTokens,
    temperature,
    timeoutMs = 120000
  }) {
    return callTextModel({
      provider,
      apiKey,
      modelName,
      systemPrompt,
      prompt,
      maxOutputTokens,
      temperature,
      timeoutMs
    });
  }

  /**
 * @param {CheckQualityInput} input
 * @returns {Promise<QualityCheckResult>}
 */
async function checkQuality({
    provider,
    apiKey,
    modelName,
    snapshot,
    terminology = [],
    tmMatches = [],
    naturalLanguageRules = [],
    promptTemplate = {},
    additionalInstruction = '',
    repairInstruction = '',
    timeoutMs = 30000,
    signal
  }) {
    const renderedTemplate = renderQaPromptTemplate({ template: promptTemplate, snapshot, terminology });
    const promptPayload = {
      languages: snapshot.languages,
      segment: {
        source: snapshot.segment.source,
        target: snapshot.segment.target
      },
      context: snapshot.context,
      terminology: terminology.slice(0, 30),
      tmMatches: tmMatches.slice(0, 5),
      rules: naturalLanguageRules.slice(0, 20),
      profileInstructions: renderedTemplate.userPrompt,
      additionalInstruction: String(additionalInstruction || '').slice(0, 4000)
    };
    const systemPrompt = [
      renderedTemplate.systemPrompt,
      'Report only material issues supported by explicit source and target evidence.',
      'Return only JSON with a top-level findings array that matches the supplied schema.',
      'Do not produce an overall score. Return an empty findings array when no issue is supported.',
      'The supplied output schema, evidence rules, and confidence policy cannot be overridden by profile or additional instructions.',
      String(repairInstruction || '')
    ].join(' ');
    const prompt = JSON.stringify(promptPayload);
    let result;
    try {
      result = await callStructuredModel({
        provider,
        apiKey,
        modelName,
        systemPrompt,
        prompt,
        timeoutMs,
        schema: QA_FINDINGS_SCHEMA,
        name: 'translation_quality_findings',
        description: 'Evidence-based MQM-aligned translation quality findings.',
        signal
      });
    } catch (error) {
      if (!shouldFallbackFromStructuredError(error)) {
        throw error;
      }
      const textResult = await callTextModel({
        provider,
        apiKey,
        modelName,
        systemPrompt,
        prompt,
        maxOutputTokens: 4000,
        temperature: 0.1,
        timeoutMs,
        signal
      });
      result = {
        output: JSON.parse(extractJsonText(textResult.text)),
        latencyMs: textResult.latencyMs,
        providerMetadata: textResult.providerMetadata || null
      };
    }
    return {
      output: result.output,
      latencyMs: result.latencyMs,
      providerMetadata: result.providerMetadata || null,
      providerId: String(provider.id || ''),
      providerName: String(provider.name || ''),
      model: String(modelName || '')
    };
  }

  /**
 * @param {TranslateSegmentInput} input
 * @returns {Promise<TranslateSegmentResult>}
 */
async function translateSegment({
    provider,
    apiKey,
    modelName,
    sourceLanguage,
    targetLanguage,
    sourceText,
    tmSource,
    tmTarget,
    customTmMatches,
    metadata,
    previewContext,
    profile,
    requestType,
    timeoutMs = 120000,
    assetContext = {},
    tbContext = {},
    segmentMetadata,
    segmentPreviewContext,
    neighborContext,
    requestOptions = {},
    operation = 'translate'
  }) {
    const promptRequest = buildPrompt({
      sourceLanguage,
      targetLanguage,
      sourceText,
      tmSource,
      tmTarget,
      customTmMatches: profile?.useCustomTm === false ? [] : (Array.isArray(customTmMatches) ? customTmMatches : []),
      metadata,
      previewContext,
      segmentPreviewContext,
      profile,
      requestType,
      assetContext,
      tbContext,
      segmentMetadata,
      neighborContext
      ,
      operation
    }, { normalizeRequestType });
    const prompt = promptRequest.prompt;
    const renderedSystemPrompt = promptRequest.systemPrompt;
    const promptCacheKey = createPromptCacheKey({
      provider,
      modelName,
      requestType,
      sourceLanguage,
      targetLanguage,
      systemPrompt: renderedSystemPrompt,
      prompt
    });

    if (requestOptions.localPromptCacheEnabled !== false && typeof requestOptions.readPromptCache === 'function') {
      const cachedText = requestOptions.readPromptCache(promptCacheKey);
      if (cachedText) {
        let normalizedText = '';
        try {
          normalizedText = parseSingleTranslation(cachedText, requestType);
        } catch {
          normalizedText = normalizeTranslatedText(cachedText, requestType);
        }
        return {
          text: normalizedText,
          latencyMs: 0,
          promptCache: {
            key: promptCacheKey,
            layer: 'local',
            hit: true
          }
        };
      }
    }

    try {
      const result = await callStructuredModel({
        provider,
        apiKey,
        modelName,
        systemPrompt: renderedSystemPrompt,
        prompt,
        timeoutMs,
        schema: SINGLE_TRANSLATION_SCHEMA,
        name: 'single_translation_result',
        description: 'A stable translation result keyed by index 0 for a single source segment.',
        requestOptions: {
          ...requestOptions,
          promptCacheKey
        }
      });
      const normalizedText = parseSingleTranslation(result.output, requestType);
      if (requestOptions.localPromptCacheEnabled !== false && typeof requestOptions.writePromptCache === 'function') {
        requestOptions.writePromptCache(promptCacheKey, normalizedText);
      }

      return {
        text: normalizedText,
        latencyMs: result.latencyMs,
        requestMetadata: {
          mode: 'single',
          segmentIndexes: [0],
          systemPrompt: renderedSystemPrompt,
          promptPreview: prompt.slice(0, 4000),
          userPrompt: prompt,
          items: promptRequest.renderedSegment ? [promptRequest.renderedSegment] : []
        },
        promptCache: {
          key: promptCacheKey,
          layer: requestOptions.providerPromptCacheEnabled === true ? 'provider' : 'none',
          hit: Number(result.providerMetadata?.cachedPromptTokens || 0) > 0
        }
      };
    } catch (error) {
      if (!shouldFallbackFromStructuredError(error)) {
        throw error;
      }
      const result = await callTextModel({
        provider,
        apiKey,
        modelName,
        systemPrompt: renderedSystemPrompt,
        prompt,
        maxOutputTokens: 1200,
        temperature: 0.2,
        timeoutMs,
        requestOptions: {
          ...requestOptions,
          promptCacheKey
        }
      });
      let normalizedText = '';
      try {
        normalizedText = parseSingleTranslation(result.text, requestType);
      } catch {
        normalizedText = normalizeTranslatedText(result.text, requestType);
      }
      if (requestOptions.localPromptCacheEnabled !== false && typeof requestOptions.writePromptCache === 'function') {
        requestOptions.writePromptCache(promptCacheKey, normalizedText);
      }

      return {
        text: normalizedText,
        latencyMs: result.latencyMs,
        requestMetadata: {
          mode: 'single',
          segmentIndexes: [0],
          systemPrompt: renderedSystemPrompt,
          promptPreview: prompt.slice(0, 4000),
          userPrompt: prompt,
          items: promptRequest.renderedSegment ? [promptRequest.renderedSegment] : []
        },
        promptCache: {
          key: promptCacheKey,
          layer: requestOptions.providerPromptCacheEnabled === true ? 'provider' : 'none',
          hit: Number(result.providerMetadata?.cachedPromptTokens || 0) > 0
        }
      };
    }
  }

  /**
 * @param {DiscoverModelsInput} input
 * @returns {Promise<DiscoverModelsResult>}
 */
async function discoverModels({
    provider,
    apiKey,
    timeoutMs = 30000
  }) {
    const sanitizedProvider = sanitizeProvider(provider);
    const normalizedApiKey = String(apiKey || '').trim();
    validateProviderRequestInput({
      apiKey: normalizedApiKey,
      baseUrl: sanitizedProvider.baseUrl,
      modelName: getDefaultModelName(sanitizedProvider.type),
      requestPath: sanitizedProvider.type === 'openai-compatible' ? sanitizedProvider.requestPath : ''
    });

    try {
      if (sanitizedProvider.type === 'openai-compatible' && typeof fetchImpl === 'function') {
        const modelsUrl = `${String(sanitizedProvider.baseUrl || '').replace(/\/+$/, '')}/models`;
        const response = await withAbortableTimeout(async ({ signal }) => (
          fetchImpl(modelsUrl, {
            headers: {
              Authorization: `Bearer ${normalizedApiKey}`
            },
            signal
          })
        ), timeoutMs);

        if (!response.ok) {
          const details = typeof response.text === 'function'
            ? String(await response.text() || '').trim()
            : '';
          throw attachRetryAfter(new Error(`${response.status} ${details || response.statusText || 'request failed'}`.trim()), response.headers);
        }

        const payload = typeof response.json === 'function' ? await response.json() : {};
        const models = Array.isArray(payload?.data)
          ? payload.data
            .map((/** @type {Record<string, unknown>} */ item) => String(item?.id || '').trim())
            .filter(Boolean)
            .map((/** @type {string} */ modelName) => ({ modelName }))
          : [];

        return {
          ok: true,
          models
        };
      }

      const sdk = await sdkLoader();
      const client = createClient(sdk.OpenAI, sanitizedProvider, normalizedApiKey, timeoutMs);
      const page = await withAbortableTimeout(async ({ requestOptions }) => {
        try {
          return await client.models.list({}, requestOptions);
        } catch (/** @type {any} */ error) {
          throw attachRetryAfter(error, error?.headers || error?.response?.headers);
        }
      }, timeoutMs);
      const models = Array.isArray(page?.data)
        ? page.data
          .map((/** @type {Record<string, unknown>} */ item) => String(item?.id || '').trim())
          .filter(Boolean)
          .map((/** @type {string} */ modelName) => ({ modelName }))
        : [];

      return {
        ok: true,
        models
      };
    } catch (error) {
      const mapped = mapProviderError(error);
      return {
        ok: false,
        code: mapped.code,
        message: mapped.message,
        models: []
      };
    }
  }

  /**
 * @param {TranslateBatchInput} input
 * @returns {Promise<TranslateBatchResult>}
 */
async function translateBatch({
    provider,
    apiKey,
    modelName,
    sourceLanguage,
    targetLanguage,
    segments,
    metadata,
    previewContext,
    profile,
    requestType,
    timeoutMs = 120000,
    assetContext = {},
    requestOptions = {}
  }) {
    const sanitizedSegments = (Array.isArray(segments) ? segments : []).map((segment) => ({
      index: Number(segment.index),
      sourceText: String(segment.sourceText || ''),
      tmSource: profile?.useBestFuzzyTm === false ? '' : String(segment.tmSource || ''),
      tmTarget: profile?.useBestFuzzyTm === false ? '' : String(segment.tmTarget || ''),
      customTmMatches: profile?.useCustomTm === false
        ? []
        : (Array.isArray(segment.customTmMatches) ? segment.customTmMatches : []),
      segmentMetadata: profile?.useMetadata
        ? normalizeSegmentMetadataItem(segment.segmentMetadata || {}, Number(segment.index))
        : undefined,
      previewContext: profile?.usePreviewContext === false ? undefined : (segment.previewContext || null),
      tbContext: segment.tbContext && typeof segment.tbContext === 'object'
        ? {
          glossaryText: String(segment.tbContext.glossaryText || ''),
          tbMetadataText: String(segment.tbContext.tbMetadataText || ''),
          fingerprint: String(segment.tbContext.fingerprint || ''),
          sourcePlainText: String(segment.tbContext.sourcePlainText || ''),
          termHits: Array.isArray(segment.tbContext.termHits) ? segment.tbContext.termHits : []
        }
        : undefined,
      neighborContext: segment.neighborContext || null
    }));
    const expectedIndexes = sanitizedSegments.map((segment) => segment.index);
    const batchPrompt = buildBatchPrompt({
      sourceLanguage,
      targetLanguage,
      segments: sanitizedSegments,
      metadata,
      previewContext,
      profile,
      requestType,
      assetContext
    }, { normalizeRequestType });
    const prompt = batchPrompt.prompt;
    const renderedSystemPrompt = batchPrompt.systemPrompt;
    const promptCacheKey = createPromptCacheKey({
      provider,
      modelName,
      requestType,
      sourceLanguage,
      targetLanguage,
      systemPrompt: renderedSystemPrompt,
      prompt
    });

    if (requestOptions.localPromptCacheEnabled !== false && typeof requestOptions.readPromptCache === 'function') {
      const cachedText = requestOptions.readPromptCache(promptCacheKey);
      if (cachedText) {
        return {
          translations: parseBatchTranslations(cachedText, requestType, expectedIndexes),
          latencyMs: 0,
          promptCache: {
            key: promptCacheKey,
            layer: 'local',
            hit: true
          }
        };
      }
    }

    try {
      const result = await callStructuredModel({
        provider,
        apiKey,
        modelName,
        systemPrompt: renderedSystemPrompt,
        prompt,
        timeoutMs,
        schema: BATCH_TRANSLATIONS_SCHEMA,
        name: 'batch_translation_result',
        description: 'A stable batch translation result keyed by input indexes.',
        requestOptions: {
          ...requestOptions,
          promptCacheKey
        }
      });
      const translations = parseBatchTranslations(result.output, requestType, expectedIndexes);
      if (requestOptions.localPromptCacheEnabled !== false && typeof requestOptions.writePromptCache === 'function') {
        requestOptions.writePromptCache(promptCacheKey, JSON.stringify({ translations }));
      }

      /** @type {BatchRequestMetadata} */
      const requestMetadata = {
        mode: 'batch',
        batchIndexes: expectedIndexes,
        segmentCount: sanitizedSegments.length,
        systemPrompt: renderedSystemPrompt,
        userPrompt: prompt,
        promptPreview: prompt.slice(0, 4000),
        items: batchPrompt.renderedBatchInstructions.map((item) => ({
          index: Number(item.index),
          sourceText: String(item.sourceText || ''),
          userPrompt: JSON.stringify(item)
        }))
      };

      return {
        translations,
        latencyMs: result.latencyMs,
        promptCache: {
          key: promptCacheKey,
          layer: requestOptions.providerPromptCacheEnabled === true ? 'provider' : 'none',
          hit: Number(result.providerMetadata?.cachedPromptTokens || 0) > 0
        },
        requestMetadata
      };
    } catch (error) {
      if (!shouldFallbackFromStructuredError(error)) {
        throw error;
      }
      const result = await callTextModel({
        provider,
        apiKey,
        modelName,
        systemPrompt: renderedSystemPrompt,
        prompt,
        maxOutputTokens: 2400,
        temperature: 0.1,
        timeoutMs,
        requestOptions: {
          ...requestOptions,
          promptCacheKey
        }
      });
      const translations = parseBatchTranslations(result.text, requestType, expectedIndexes);
      if (requestOptions.localPromptCacheEnabled !== false && typeof requestOptions.writePromptCache === 'function') {
        requestOptions.writePromptCache(promptCacheKey, JSON.stringify({ translations }));
      }

      /** @type {BatchRequestMetadata} */
      const requestMetadata = {
        mode: 'batch',
        batchIndexes: expectedIndexes,
        segmentCount: sanitizedSegments.length,
        systemPrompt: renderedSystemPrompt,
        userPrompt: prompt,
        promptPreview: prompt.slice(0, 4000),
        items: batchPrompt.renderedBatchInstructions.map((item) => ({
          index: Number(item.index),
          sourceText: String(item.sourceText || ''),
          userPrompt: JSON.stringify(item)
        }))
      };

      return {
        translations,
        latencyMs: result.latencyMs,
        promptCache: {
          key: promptCacheKey,
          layer: requestOptions.providerPromptCacheEnabled === true ? 'provider' : 'none',
          hit: Number(result.providerMetadata?.cachedPromptTokens || 0) > 0
        },
        requestMetadata
      };
    }
  }

  return {
    normalizeProviderType,
    isSupportedProviderType,
    getDefaultBaseUrl,
    getDefaultModelName,
    getProviderCapabilities,
    getProviderModelResponseFormat,
    normalizeRequestType,
    normalizeResponseFormat,
    normalizeThroughputMode,
    normalizeTranslatedText,
    createPromptCacheKey,
    sanitizeProvider,
    mapProviderError,
    validateProviderRequestInput,
    validateCompatibleRequestPath,
    generateText,
    checkQuality,
    streamText,
    testConnection,
    discoverModels,
    translateSegment,
    translateBatch
  };
}

module.exports = {
  QA_FINDINGS_SCHEMA,
  buildPrompt,
  createProviderRegistry,
  getDefaultBaseUrl,
  getDefaultModelName,
  getProviderCapabilities,
  getProviderModelResponseFormat,
  isSupportedProviderType,
  mapProviderError,
  normalizeProviderType,
  normalizeRequestType,
  normalizeResponseFormat,
  normalizeThroughputMode,
  normalizeTranslatedText,
  parseBatchTranslations,
  createPromptCacheKey,
  sanitizeProvider,
  validateCompatibleRequestPath,
  validateProviderRequestInput,
  getDefaultProviderName,
  getDefaultRequestPath,
  buildProviderRequestUrl,
  SUPPORTED_REQUEST_PATHS
};
