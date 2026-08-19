using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using MemoQ.Addins.Common;
using MemoQ.Addins.Common.DataStructures;
using MemoQ.MTInterfaces;

namespace MemoQAIHubPlugin
{
    public class MemoQAIHubSession : ISession, ISessionForStoringTranslations, ISessionWithMetadata
    {
        private readonly string _sourceLangCode;
        private readonly string _targetLangCode;
        private readonly MemoQAIHubOptions _options;
        private readonly MemoQAIHubGatewayClient _gatewayClient;
        private readonly MemoQAIHubRequestMapper _requestMapper;
        private readonly MemoQAIHubResponseMapper _responseMapper;

        public MemoQAIHubSession(string sourceLangCode, string targetLangCode, MemoQAIHubOptions options)
        {
            _sourceLangCode = sourceLangCode;
            _targetLangCode = targetLangCode;
            _options = options;
            _gatewayClient = new MemoQAIHubGatewayClient(
                options.GeneralSettings.GatewayBaseUrl,
                options.GeneralSettings.GatewayTimeoutMs,
                MemoQAIHubPluginLogger.Log
            );
            _requestMapper = new MemoQAIHubRequestMapper(
                sourceLangCode,
                targetLangCode,
                () => options?.GeneralSettings?.PreferredProfileId,
                MemoQAIHubPluginLogger.Log
            );
            _responseMapper = new MemoQAIHubResponseMapper(
                sourceLangCode,
                targetLangCode,
                MemoQAIHubPluginLogger.Log
            );
        }

        public TranslationResult TranslateCorrectSegment(Segment segm, Segment tmSource, Segment tmTarget)
        {
            return TranslateCorrectSegment(new[] { segm }, new[] { tmSource }, new[] { tmTarget }, null)[0];
        }

        public TranslationResult[] TranslateCorrectSegment(Segment[] segs, Segment[] tmSources, Segment[] tmTargets)
        {
            return TranslateCorrectSegment(segs, tmSources, tmTargets, null);
        }

        public TranslationResult TranslateCorrectSegment(Segment segm, Segment tmSource, Segment tmTarget, MTRequestMetadata metadata)
        {
            return TranslateCorrectSegment(new[] { segm }, new[] { tmSource }, new[] { tmTarget }, metadata)[0];
        }

        public TranslationResult[] TranslateCorrectSegment(Segment[] segs, Segment[] tmSources, Segment[] tmTargets, MTRequestMetadata metadata)
        {
            if (segs == null)
            {
                throw new ArgumentNullException(nameof(segs));
            }

            var results = CreateInitializedResults(segs.Length);
            var formattingMode = _options.GeneralSettings.FormattingAndTagUsage;

            MemoQAIHubPluginLogger.Log($"Translate start mode={formattingMode} segments={segs.Length}");

            try
            {
                MemoQAIHubCapabilityGate.EnsureLookupConfigured(_options);
                TranslateBatch(segs, tmSources, tmTargets, metadata, formattingMode, results);
                RetryFailedSegmentsIndividually(segs, tmSources, tmTargets, metadata, formattingMode, results);
            }
            catch (Exception error)
            {
                var wrapped = MemoQAIHubResponseMapper.WrapException(error);
                MemoQAIHubPluginLogger.Log($"Translate failed mode={formattingMode} error={error.Message}");
                for (var index = 0; index < results.Length; index += 1)
                {
                    results[index].Exception = wrapped;
                }
            }

            return results;
        }

        private void TranslateBatch(
            Segment[] segs,
            Segment[] tmSources,
            Segment[] tmTargets,
            MTRequestMetadata metadata,
            FormattingAndTagsUsageOption formattingMode,
            TranslationResult[] results)
        {
            var request = _requestMapper.CreateTranslateRequest(
                segs,
                tmSources,
                tmTargets,
                metadata,
                formattingMode,
                Enumerable.Range(0, segs.Length).ToArray()
            );

            LogMetadataSummary(request.metadata);
            MemoQAIHubPluginLogger.Log("Fuzzy forwarding support=true tmHintsRequested=true");

            var response = _gatewayClient.Translate(request, formattingMode.ToString(), segs.Length);

            MemoQAIHubPluginLogger.Log(
                $"Translate response success={response.success} translations={response.translations?.Count ?? 0} requestId={response.requestId ?? request.requestId} traceId={response.traceId ?? request.traceId}"
            );
            MemoQAIHubResponseMapper.ThrowIfUnsuccessful(response);
            MemoQAIHubPluginLogger.Log(
                $"Translate response mode={formattingMode} requestType={request.requestType} segments={segs.Length} translations={response.translations.Count} provider={response.providerId ?? string.Empty} model={response.model ?? string.Empty} requestId={request.requestId} traceId={request.traceId}"
            );

            var translationsByIndex = _responseMapper.MapTranslationsByIndex(response, segs.Length, results);
            var missingCount = GetFailedIndexes(results).Count;
            if (response.partial || missingCount > 0)
            {
                MemoQAIHubPluginLogger.Log(
                    $"Partial translate response translations={response.translations?.Count ?? 0} missing={missingCount} retrying={missingCount} error={response.error?.message ?? string.Empty}"
                );
            }
            _responseMapper.ApplyTranslations(segs, translationsByIndex, results, formattingMode);
        }

        private void RetryFailedSegmentsIndividually(
            Segment[] segs,
            Segment[] tmSources,
            Segment[] tmTargets,
            MTRequestMetadata metadata,
            FormattingAndTagsUsageOption initialMode,
            TranslationResult[] results)
        {
            var retryModes = BuildRetryModes(initialMode, segs.Length);
            if (retryModes.Length == 0)
            {
                return;
            }

            var pendingIndexes = GetFailedIndexes(results);
            foreach (var retryMode in retryModes)
            {
                if (pendingIndexes.Count == 0)
                {
                    return;
                }

                MemoQAIHubPluginLogger.Log($"Retry stage start mode={retryMode} segments={pendingIndexes.Count}");
                var stillFailing = new ConcurrentBag<int>();
                var parallelOptions = new ParallelOptions
                {
                    MaxDegreeOfParallelism = Math.Min(4, pendingIndexes.Count)
                };

                Parallel.ForEach(pendingIndexes, parallelOptions, originalIndex =>
                {
                    var retryResult = TranslateSingleSegmentWithMode(
                        segs,
                        tmSources,
                        tmTargets,
                        metadata,
                        originalIndex,
                        retryMode
                    );

                    if (retryResult.Exception == null && retryResult.Translation != null)
                    {
                        results[originalIndex] = retryResult;
                        MemoQAIHubPluginLogger.Log($"Retry stage success index={originalIndex} mode={retryMode}");
                        return;
                    }

                    results[originalIndex].Exception = retryResult.Exception;
                    stillFailing.Add(originalIndex);
                    MemoQAIHubPluginLogger.Log($"Retry stage failed index={originalIndex} mode={retryMode} error={retryResult.Exception?.Message ?? string.Empty}");
                });

                pendingIndexes = stillFailing.OrderBy(index => index).ToList();
            }
        }

        private TranslationResult TranslateSingleSegmentWithMode(
            Segment[] segs,
            Segment[] tmSources,
            Segment[] tmTargets,
            MTRequestMetadata metadata,
            int originalIndex,
            FormattingAndTagsUsageOption formattingMode)
        {
            var result = new TranslationResult();
            var singleSeg = new[] { segs[originalIndex] };
            var singleTmSource = SliceSegmentArray(tmSources, originalIndex);
            var singleTmTarget = SliceSegmentArray(tmTargets, originalIndex);

            try
            {
                var request = _requestMapper.CreateTranslateRequest(
                    singleSeg,
                    singleTmSource,
                    singleTmTarget,
                    metadata,
                    formattingMode,
                    new[] { originalIndex }
                );
                LogMetadataSummary(request.metadata);
                MemoQAIHubPluginLogger.Log($"Retry request start originalIndex={originalIndex} mode={formattingMode} requestId={request.requestId} traceId={request.traceId}");

                var response = _gatewayClient.Translate(
                    request,
                    formattingMode.ToString(),
                    singleSeg.Length,
                    "retry",
                    originalIndex
                );

                MemoQAIHubPluginLogger.Log(
                    $"Retry response success={response.success} translations={response.translations?.Count ?? 0} originalIndex={originalIndex} mode={formattingMode} requestId={response.requestId ?? request.requestId} traceId={response.traceId ?? request.traceId}"
                );
                MemoQAIHubResponseMapper.ThrowIfUnsuccessful(response);

                var singleResults = CreateInitializedResults(1);
                var translationsByIndex = _responseMapper.MapTranslationsByIndex(response, 1, singleResults);
                _responseMapper.ApplyTranslations(singleSeg, translationsByIndex, singleResults, formattingMode);

                return singleResults[0];
            }
            catch (Exception error)
            {
                result.Exception = MemoQAIHubResponseMapper.WrapException(error);
                return result;
            }
        }

        private static TranslationResult[] CreateInitializedResults(int count)
        {
            var results = new TranslationResult[count];
            for (var index = 0; index < count; index += 1)
            {
                results[index] = new TranslationResult();
            }

            return results;
        }

        private static Segment[] SliceSegmentArray(Segment[] items, int index)
        {
            if (items == null || items.Length <= index)
            {
                return null;
            }

            return new[] { items[index] };
        }

        private static List<int> GetFailedIndexes(TranslationResult[] results)
        {
            return Enumerable.Range(0, results.Length)
                .Where(index => results[index].Exception != null)
                .ToList();
        }

        private static FormattingAndTagsUsageOption[] BuildRetryModes(FormattingAndTagsUsageOption initialMode, int originalRequestSegmentCount)
        {
            var includeInitialModeRetry = originalRequestSegmentCount > 1;
            switch (initialMode)
            {
                case FormattingAndTagsUsageOption.BothFormattingAndTags:
                    return includeInitialModeRetry
                        ? new[]
                        {
                            FormattingAndTagsUsageOption.BothFormattingAndTags,
                            FormattingAndTagsUsageOption.OnlyFormatting,
                            FormattingAndTagsUsageOption.Plaintext
                        }
                        : new[]
                        {
                            FormattingAndTagsUsageOption.OnlyFormatting,
                            FormattingAndTagsUsageOption.Plaintext
                        };
                case FormattingAndTagsUsageOption.OnlyFormatting:
                    return includeInitialModeRetry
                        ? new[]
                        {
                            FormattingAndTagsUsageOption.OnlyFormatting,
                            FormattingAndTagsUsageOption.Plaintext
                        }
                        : new[]
                        {
                            FormattingAndTagsUsageOption.Plaintext
                        };
                default:
                    return includeInitialModeRetry
                        ? new[]
                        {
                            FormattingAndTagsUsageOption.Plaintext
                        }
                        : Array.Empty<FormattingAndTagsUsageOption>();
            }
        }

        private static void LogMetadataSummary(Dictionary<string, object> metadata)
        {
            var metadataProjectId = metadata.ContainsKey("projectId") ? metadata["projectId"] : string.Empty;
            var metadataClient = metadata.ContainsKey("client") ? metadata["client"] : string.Empty;
            var metadataDomain = metadata.ContainsKey("domain") ? metadata["domain"] : string.Empty;
            var metadataSubject = metadata.ContainsKey("subject") ? metadata["subject"] : string.Empty;
            var metadataDocumentId = metadata.ContainsKey("documentId") ? metadata["documentId"] : string.Empty;
            var metadataProjectGuid = metadata.ContainsKey("projectGuid") ? metadata["projectGuid"] : string.Empty;
            var segmentMetadataCount = metadata.ContainsKey("segmentLevelMetadata") && metadata["segmentLevelMetadata"] is List<Dictionary<string, object>> items
                ? items.Count
                : 0;
            MemoQAIHubPluginLogger.Log(
                $"Metadata summary projectId={metadataProjectId} " +
                $"client={metadataClient} " +
                $"domain={metadataDomain} " +
                $"subject={metadataSubject} " +
                $"documentId={metadataDocumentId} " +
                $"projectGuid={metadataProjectGuid} " +
                $"segmentMetadataCount={segmentMetadataCount}"
            );
        }

        public void StoreTranslation(TranslationUnit transunit)
        {
            if (transunit == null)
            {
                throw new ArgumentNullException(nameof(transunit));
            }

            StoreTranslation(new[] { transunit });
        }

        public int[] StoreTranslation(TranslationUnit[] transunits)
        {
            if (transunits == null)
            {
                throw new ArgumentNullException(nameof(transunits));
            }

            MemoQAIHubCapabilityGate.EnsureLookupConfigured(_options);

            var formattingMode = _options.GeneralSettings.FormattingAndTagUsage;
            var request = new MemoQAIHubStoreTranslationsRequest
            {
                requestId = Guid.NewGuid().ToString("N"),
                traceId = Guid.NewGuid().ToString("N"),
                sourceLanguage = _sourceLangCode,
                targetLanguage = _targetLangCode,
                requestType = MemoQAIHubRequestMapper.BuildRequestType(formattingMode),
                translations = transunits
                    .Select((unit, index) => new MemoQAIHubStoredTranslation
                    {
                        index = index,
                        sourceText = unit?.Source != null ? MemoQAIHubRequestMapper.BuildText(unit.Source, formattingMode) : string.Empty,
                        targetText = unit?.Target != null ? MemoQAIHubRequestMapper.BuildText(unit.Target, formattingMode) : string.Empty
                    })
                    .ToList()
            };

            var response = MemoQAIHubServiceHelper.StoreTranslations(
                _options.GeneralSettings.GatewayBaseUrl,
                _options.GeneralSettings.GatewayTimeoutMs,
                request
            );

            if (response == null)
            {
                throw new InvalidOperationException("Desktop translation writeback service returned an empty response.");
            }

            if (!response.success)
            {
                throw new MTException(
                    response.error?.message ?? "Desktop translation writeback failed.",
                    response.error?.code ?? "STORE_TRANSLATION_FAILED",
                    null
                );
            }

            return request.translations
                .Where(item => !string.IsNullOrWhiteSpace(item.sourceText) && !string.IsNullOrWhiteSpace(item.targetText))
                .Select(item => item.index)
                .ToArray();
        }

        public void Dispose()
        {
        }
    }
}
