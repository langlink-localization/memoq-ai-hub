using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using MemoQ.Addins.Common;
using MemoQ.Addins.Common.DataStructures;
using MemoQ.Addins.Common.Utils;
using MemoQ.MTInterfaces;

namespace MemoQAIHubPlugin
{
    public class MemoQAIHubSession : ISession, ISessionForStoringTranslations, ISessionWithMetadata
    {
        private const int GatewayTranslateConcurrency = 2;
        private static readonly SemaphoreSlim GatewayTranslateGate = new SemaphoreSlim(GatewayTranslateConcurrency, GatewayTranslateConcurrency);
        private static readonly object LogSync = new object();
        private readonly string _sourceLangCode;
        private readonly string _targetLangCode;
        private readonly MemoQAIHubOptions _options;

        public MemoQAIHubSession(string sourceLangCode, string targetLangCode, MemoQAIHubOptions options)
        {
            _sourceLangCode = sourceLangCode;
            _targetLangCode = targetLangCode;
            _options = options;
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

            LogDebug($"Translate start mode={formattingMode} segments={segs.Length}");

            try
            {
                MemoQAIHubCapabilityGate.EnsureLookupConfigured(_options);
                TranslateBatch(segs, tmSources, tmTargets, metadata, formattingMode, results);
                RetryFailedSegmentsIndividually(segs, tmSources, tmTargets, metadata, formattingMode, results);
            }
            catch (Exception error)
            {
                var wrapped = WrapException(error);
                LogDebug($"Translate failed mode={formattingMode} error={error.Message}");
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
            var request = CreateTranslateRequest(
                segs,
                tmSources,
                tmTargets,
                metadata,
                formattingMode,
                Enumerable.Range(0, segs.Length).ToArray()
            );

            LogMetadataSummary(request.metadata);
            LogDebug("Fuzzy forwarding support=true tmHintsRequested=true");

            var response = SendTranslateRequest(request, formattingMode.ToString(), segs.Length);

            LogDebug(
                $"Translate response success={response.success} translations={response.translations?.Count ?? 0} requestId={response.requestId ?? request.requestId} traceId={response.traceId ?? request.traceId}"
            );
            ThrowIfUnsuccessful(response);
            LogDebug(
                $"Translate response mode={formattingMode} requestType={request.requestType} segments={segs.Length} translations={response.translations.Count} provider={response.providerId ?? string.Empty} model={response.model ?? string.Empty} requestId={request.requestId} traceId={request.traceId}"
            );

            var translationsByIndex = MapTranslationsByIndex(response, segs.Length, results);
            var missingCount = GetFailedIndexes(results).Count;
            if (response.partial || missingCount > 0)
            {
                LogDebug(
                    $"Partial translate response translations={response.translations?.Count ?? 0} missing={missingCount} retrying={missingCount} error={response.error?.message ?? string.Empty}"
                );
            }
            ApplyTranslations(segs, translationsByIndex, results, formattingMode);
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

                LogDebug($"Retry stage start mode={retryMode} segments={pendingIndexes.Count}");
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
                        LogDebug($"Retry stage success index={originalIndex} mode={retryMode}");
                        return;
                    }

                    results[originalIndex].Exception = retryResult.Exception;
                    stillFailing.Add(originalIndex);
                    LogDebug($"Retry stage failed index={originalIndex} mode={retryMode} error={retryResult.Exception?.Message ?? string.Empty}");
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
                var request = CreateTranslateRequest(
                    singleSeg,
                    singleTmSource,
                    singleTmTarget,
                    metadata,
                    formattingMode,
                    new[] { originalIndex }
                );
                LogMetadataSummary(request.metadata);
                LogDebug($"Retry request start originalIndex={originalIndex} mode={formattingMode} requestId={request.requestId} traceId={request.traceId}");

                var response = SendTranslateRequest(
                    request,
                    formattingMode.ToString(),
                    singleSeg.Length,
                    "retry",
                    originalIndex
                );

                LogDebug(
                    $"Retry response success={response.success} translations={response.translations?.Count ?? 0} originalIndex={originalIndex} mode={formattingMode} requestId={response.requestId ?? request.requestId} traceId={response.traceId ?? request.traceId}"
                );
                ThrowIfUnsuccessful(response);

                var singleResults = CreateInitializedResults(1);
                var translationsByIndex = MapTranslationsByIndex(response, 1, singleResults);
                ApplyTranslations(singleSeg, translationsByIndex, singleResults, formattingMode);

                return singleResults[0];
            }
            catch (Exception error)
            {
                result.Exception = WrapException(error);
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

        private MemoQAIHubTranslateResponse SendTranslateRequest(
            MemoQAIHubTranslateRequest request,
            string formattingMode,
            int segmentCount,
            string stage = "batch",
            int? originalIndex = null)
        {
            var queueTimer = Stopwatch.StartNew();
            GatewayTranslateGate.Wait();
            queueTimer.Stop();
            var gatewayQueuedMs = queueTimer.ElapsedMilliseconds;
            var originalIndexText = originalIndex.HasValue ? $" originalIndex={originalIndex.Value}" : string.Empty;

            LogDebug(
                $"Translate request start stage={stage} mode={formattingMode} segments={segmentCount}{originalIndexText} requestId={request.requestId} traceId={request.traceId} gatewayQueuedMs={gatewayQueuedMs}"
            );

            try
            {
                return MemoQAIHubServiceHelper.Translate(
                    _options.GeneralSettings.GatewayBaseUrl,
                    _options.GeneralSettings.GatewayTimeoutMs,
                    request
                );
            }
            catch (Exception error)
            {
                LogDebug(
                    $"Translate failed stage={stage} mode={formattingMode} segments={segmentCount}{originalIndexText} requestId={request.requestId} traceId={request.traceId} gatewayQueuedMs={gatewayQueuedMs} error={error.Message}"
                );
                throw;
            }
            finally
            {
                GatewayTranslateGate.Release();
            }
        }

        private static string BuildRequestType(FormattingAndTagsUsageOption formattingMode)
        {
            switch (formattingMode)
            {
                case FormattingAndTagsUsageOption.OnlyFormatting:
                    return "OnlyFormatting";
                case FormattingAndTagsUsageOption.BothFormattingAndTags:
                    return "BothFormattingAndTags";
                default:
                    return "Plaintext";
            }
        }

        private static string BuildUseCase(Segment[] segs)
        {
            return segs != null && segs.Length > 1 ? "batch" : "interactive";
        }

        private MemoQAIHubTranslateRequest CreateTranslateRequest(
            Segment[] segs,
            Segment[] tmSources,
            Segment[] tmTargets,
            MTRequestMetadata metadata,
            FormattingAndTagsUsageOption formattingMode,
            int[] originalIndexes)
        {
            return new MemoQAIHubTranslateRequest
            {
                requestId = Guid.NewGuid().ToString("N"),
                traceId = Guid.NewGuid().ToString("N"),
                @interface = "mt",
                pluginVersion = typeof(MemoQAIHubSession).Assembly.GetName().Version.ToString(),
                contractVersion = "1",
                sourceLanguage = _sourceLangCode,
                targetLanguage = _targetLangCode,
                requestType = BuildRequestType(formattingMode),
                metadata = BuildMetadata(metadata, originalIndexes),
                profileResolution = new MemoQAIHubProfileResolution
                {
                    useCase = BuildUseCase(segs),
                    profileId = (_options?.GeneralSettings?.PreferredProfileId ?? string.Empty).Trim()
                },
                segments = BuildSegments(segs, tmSources, tmTargets, formattingMode)
            };
        }

        private static void ThrowIfUnsuccessful(MemoQAIHubTranslateResponse response)
        {
            if (response == null)
            {
                throw new InvalidOperationException("Desktop translation service returned an empty response.");
            }

            if (!response.success)
            {
                throw new MTException(
                    response.error?.message ?? "Desktop translation failed.",
                    response.error?.code ?? "TRANSLATION_FAILED",
                    null
                );
            }
        }

        private static MemoQAIHubSegmentResult[] MapTranslationsByIndex(MemoQAIHubTranslateResponse response, int expectedCount, TranslationResult[] results)
        {
            if (response.translations == null)
            {
                throw new InvalidOperationException("Desktop translation service returned no translations.");
            }

            if (results == null)
            {
                throw new ArgumentNullException(nameof(results));
            }

            var translationsByIndex = new MemoQAIHubSegmentResult[expectedCount];
            var seenIndexes = new bool[expectedCount];
            foreach (var translation in response.translations)
            {
                if (translation == null)
                {
                    LogDebug("Translation response contained an empty translation item.");
                    continue;
                }

                LogDebug($"Translation received index={translation.index} length={(translation.text ?? string.Empty).Length}");

                if (translation.index < 0 || translation.index >= expectedCount)
                {
                    LogDebug($"Translation response contained an invalid index={translation.index} expectedCount={expectedCount}");
                    continue;
                }

                if (seenIndexes[translation.index])
                {
                    results[translation.index].Exception = WrapException(
                        new InvalidOperationException(
                            string.Format(
                                "Desktop translation service returned duplicate translations for index {0}.",
                                translation.index
                            )
                        )
                    );
                    LogDebug($"Translation response contained a duplicate index={translation.index}");
                    continue;
                }

                seenIndexes[translation.index] = true;
                translationsByIndex[translation.index] = translation;
            }

            for (var index = 0; index < seenIndexes.Length; index += 1)
            {
                if (!seenIndexes[index])
                {
                    results[index].Exception = WrapException(
                        new InvalidOperationException(
                            string.Format(
                                "Desktop translation service did not return a translation for index {0}.",
                                index
                            )
                        )
                    );
                    LogDebug($"Translation response omitted index={index}");
                }
            }

            return translationsByIndex;
        }

        private static MTException WrapException(Exception error)
        {
            return error as MTException ?? new MTException(error.Message, error.Message, error);
        }

        private Dictionary<string, object> BuildMetadata(MTRequestMetadata metadata, int[] originalIndexes = null)
        {
            var payload = new Dictionary<string, object>();
            if (metadata == null)
            {
                return payload;
            }

            Dictionary<int, int> indexMap = null;
            if (originalIndexes != null)
            {
                indexMap = originalIndexes
                    .Select((originalIndex, localIndex) => new { originalIndex, localIndex })
                    .ToDictionary(item => item.originalIndex, item => item.localIndex);
            }

            payload["client"] = metadata.Client ?? string.Empty;
            payload["domain"] = metadata.Domain ?? string.Empty;
            payload["subject"] = metadata.Subject ?? string.Empty;
            payload["projectId"] = metadata.PorjectID ?? string.Empty;
            payload["documentId"] = metadata.DocumentID != Guid.Empty ? metadata.DocumentID.ToString() : string.Empty;
            payload["projectGuid"] = metadata.ProjectGuid != Guid.Empty ? metadata.ProjectGuid.ToString() : string.Empty;

            var segmentLevelMetadata = new List<Dictionary<string, object>>();
            foreach (var item in metadata.SegmentLevelMetadata ?? new List<SegmentMetadata>())
            {
                var localIndex = item.SegmentIndex;
                if (indexMap != null && !indexMap.TryGetValue(item.SegmentIndex, out localIndex))
                {
                    continue;
                }

                segmentLevelMetadata.Add(new Dictionary<string, object>
                {
                    ["segmentId"] = item.SegmentID != Guid.Empty ? item.SegmentID.ToString() : string.Empty,
                    ["segmentStatus"] = item.SegmentStatus,
                    ["segmentIndex"] = indexMap != null ? localIndex : item.SegmentIndex
                });
            }

            payload["segmentLevelMetadata"] = segmentLevelMetadata;
            if (segmentLevelMetadata.Count == 1)
            {
                payload["segmentStatus"] = segmentLevelMetadata[0]["segmentStatus"];
            }

            return payload;
        }

        private List<MemoQAIHubSegment> BuildSegments(Segment[] segs, Segment[] tmSources, Segment[] tmTargets, FormattingAndTagsUsageOption formattingMode)
        {
            var items = new List<MemoQAIHubSegment>();
            var tmSourcePresentCount = 0;
            var tmTargetPresentCount = 0;
            for (var index = 0; index < segs.Length; index += 1)
            {
                var tmSource = tmSources != null && tmSources.Length > index && tmSources[index] != null ? tmSources[index].PlainText : string.Empty;
                var tmTarget = tmTargets != null && tmTargets.Length > index && tmTargets[index] != null ? tmTargets[index].PlainText : string.Empty;
                var tmSourcePresent = !string.IsNullOrWhiteSpace(tmSource);
                var tmTargetPresent = !string.IsNullOrWhiteSpace(tmTarget);
                if (tmSourcePresent)
                {
                    tmSourcePresentCount += 1;
                }
                if (tmTargetPresent)
                {
                    tmTargetPresentCount += 1;
                }
                items.Add(new MemoQAIHubSegment
                {
                    index = index,
                    text = BuildText(segs[index], formattingMode),
                    plainText = segs[index].PlainText,
                    tmSource = tmSource,
                    tmTarget = tmTarget,
                    tmDiagnostics = new MemoQAIHubTmDiagnostics
                    {
                        supportFuzzyForwarding = true,
                        tmHintsRequested = true,
                        tmSourcePresent = tmSourcePresent,
                        tmTargetPresent = tmTargetPresent
                    }
                });
                LogDebug($"Segment TM diagnostics index={index} tmSourcePresent={tmSourcePresent} tmTargetPresent={tmTargetPresent}");
            }

            LogDebug($"TM diagnostics summary segments={segs.Length} tmSourcePresentCount={tmSourcePresentCount} tmTargetPresentCount={tmTargetPresentCount}");

            return items;
        }

        private static string BuildText(Segment segment, FormattingAndTagsUsageOption formattingMode)
        {
            switch (formattingMode)
            {
                case FormattingAndTagsUsageOption.OnlyFormatting:
                    return SegmentHtmlConverter.ConvertSegment2Html(segment, false);
                case FormattingAndTagsUsageOption.BothFormattingAndTags:
                    return SegmentHtmlConverter.ConvertSegment2Html(segment, true);
                default:
                    return segment.PlainText;
            }
        }

        private void ApplyTranslations(
            Segment[] segs,
            MemoQAIHubSegmentResult[] translationsByIndex,
            TranslationResult[] results,
            FormattingAndTagsUsageOption formattingMode)
        {
            for (var index = 0; index < segs.Length; index += 1)
            {
                if (results[index].Exception != null)
                {
                    continue;
                }

                var translation = translationsByIndex[index];
                if (translation == null)
                {
                    results[index].Exception = CreateSegmentTranslationException(
                        "Desktop translation service did not return a translation for this segment.",
                        segs[index],
                        index,
                        formattingMode,
                        null
                    );
                    continue;
                }

                try
                {
                    var translationText = translation.text ?? string.Empty;
                    results[index].Translation = BuildSegmentFromResult(segs[index], translationText, formattingMode);
                    results[index].Exception = null;
                    LogDebug($"Segment conversion success index={index}");
                }
                catch (Exception error)
                {
                    results[index].Exception = CreateSegmentTranslationException(
                        "Desktop translation service returned a translation that could not be converted back into a memoQ segment.",
                        segs[index],
                        index,
                        formattingMode,
                        error,
                        translation
                    );
                }
            }
        }

        private Segment BuildSegmentFromResult(
            Segment originalSegment,
            string translatedText,
            FormattingAndTagsUsageOption formattingMode)
        {
            var converted = BuildConvertedSegment(originalSegment, translatedText, formattingMode);
            return NormalizeWhitespaceAroundTags(originalSegment, converted);
        }

        private static Segment BuildConvertedSegment(
            Segment originalSegment,
            string translatedText,
            FormattingAndTagsUsageOption formattingMode)
        {
            switch (formattingMode)
            {
                case FormattingAndTagsUsageOption.OnlyFormatting:
                    return BuildOnlyFormattingSegment(originalSegment, translatedText);
                case FormattingAndTagsUsageOption.BothFormattingAndTags:
                    return SegmentHtmlConverter.ConvertHtml2Segment(translatedText ?? string.Empty, originalSegment.ITags);
                default:
                    return SegmentBuilder.CreateFromTrimmedStringAndITags(translatedText ?? string.Empty, originalSegment.ITags);
            }
        }

        private static Segment BuildOnlyFormattingSegment(Segment originalSegment, string translatedText)
        {
            var convertedSegment = SegmentHtmlConverter.ConvertHtml2Segment(translatedText ?? string.Empty, originalSegment.ITags);
            var builder = new SegmentBuilder();
            builder.AppendSegment(convertedSegment);

            foreach (InlineTag inlineTag in originalSegment.ITags)
            {
                builder.AppendInlineTag(inlineTag);
            }

            return builder.ToSegment();
        }

        private Segment NormalizeWhitespaceAroundTags(Segment sourceSegment, Segment targetSegment)
        {
            try
            {
                return TagWhitespaceNormalizer.NormalizeWhitespaceAroundTags(sourceSegment, targetSegment, _sourceLangCode, _targetLangCode);
            }
            catch (Exception error)
            {
                LogDebug($"Whitespace normalization failed: {error.Message}");
                return targetSegment;
            }
        }

        private MTException CreateSegmentTranslationException(
            string message,
            Segment originalSegment,
            int index,
            FormattingAndTagsUsageOption formattingMode,
            Exception error,
            MemoQAIHubSegmentResult translation = null)
        {
            var sourceLength = originalSegment?.PlainText != null ? originalSegment.PlainText.Length : 0;
            var targetLength = translation?.text != null ? translation.text.Length : 0;
            var tagCount = originalSegment?.ITags != null ? originalSegment.ITags.Count() : 0;
            LogDebug(
                $"Segment conversion failed index={index} mode={formattingMode} sourceLength={sourceLength} targetLength={targetLength} tagCount={tagCount} error={(error?.Message ?? message)}"
            );

            return WrapException(error ?? new InvalidOperationException(message));
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
            LogDebug(
                $"Metadata summary projectId={metadataProjectId} " +
                $"client={metadataClient} " +
                $"domain={metadataDomain} " +
                $"subject={metadataSubject} " +
                $"documentId={metadataDocumentId} " +
                $"projectGuid={metadataProjectGuid} " +
                $"segmentMetadataCount={segmentMetadataCount}"
            );
        }

        private static void LogDebug(string message)
        {
            var line = $"[{DateTime.UtcNow:O}] [MemoQAIHubPlugin] {message}";
            Trace.WriteLine(line);

            try
            {
                lock (LogSync)
                {
                    var logPath = ResolveLogPath();
                    Directory.CreateDirectory(Path.GetDirectoryName(logPath));
                    File.AppendAllText(logPath, line + Environment.NewLine, Encoding.UTF8);
                }
            }
            catch
            {
            }
        }

        private static string ResolveLogPath()
        {
            try
            {
                var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                if (!string.IsNullOrWhiteSpace(localAppData))
                {
                    return Path.Combine(localAppData, "memoQ AI Hub", "Logs", "memoq-ai-hub-plugin.log");
                }
            }
            catch
            {
            }

            return Path.Combine(Path.GetTempPath(), "memoq-ai-hub-plugin.log");
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
                requestType = BuildRequestType(formattingMode),
                translations = transunits
                    .Select((unit, index) => new MemoQAIHubStoredTranslation
                    {
                        index = index,
                        sourceText = unit?.Source != null ? BuildText(unit.Source, formattingMode) : string.Empty,
                        targetText = unit?.Target != null ? BuildText(unit.Target, formattingMode) : string.Empty
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
