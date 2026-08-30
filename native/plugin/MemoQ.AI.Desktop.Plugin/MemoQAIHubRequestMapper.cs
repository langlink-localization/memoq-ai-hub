using System;
using System.Collections.Generic;
using System.Linq;
using MemoQ.Addins.Common.DataStructures;
using MemoQ.Addins.Common.Utils;
using MemoQ.MTInterfaces;

namespace MemoQAIHubPlugin
{
    internal sealed class MemoQAIHubRequestMapper
    {
        private readonly string _sourceLangCode;
        private readonly string _targetLangCode;
        private readonly Func<string> _getPreferredProfileId;
        private readonly Action<string> _log;

        public MemoQAIHubRequestMapper(
            string sourceLangCode,
            string targetLangCode,
            Func<string> getPreferredProfileId,
            Action<string> log)
        {
            _sourceLangCode = sourceLangCode;
            _targetLangCode = targetLangCode;
            _getPreferredProfileId = getPreferredProfileId;
            _log = log ?? (_ => { });
        }

        public MemoQAIHubTranslateRequest CreateTranslateRequest(
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
                contractVersion = MemoQAIHubContract.Version,
                sourceLanguage = _sourceLangCode,
                targetLanguage = _targetLangCode,
                requestType = BuildRequestType(formattingMode),
                metadata = BuildMetadata(metadata, originalIndexes),
                profileResolution = new MemoQAIHubProfileResolution
                {
                    useCase = BuildUseCase(segs),
                    profileId = (_getPreferredProfileId?.Invoke() ?? string.Empty).Trim()
                },
                capabilities = new MemoQAIHubClientCapabilities
                {
                    mtConfidenceInfo = true
                },
                segments = BuildSegments(segs, tmSources, tmTargets, formattingMode)
            };
        }

        public static string BuildRequestType(FormattingAndTagsUsageOption formattingMode)
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

        public static string BuildText(Segment segment, FormattingAndTagsUsageOption formattingMode)
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

        private static string BuildUseCase(Segment[] segs)
        {
            return segs != null && segs.Length > 1 ? "batch" : "interactive";
        }

        private static Dictionary<string, object> BuildMetadata(MTRequestMetadata metadata, int[] originalIndexes)
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

        private List<MemoQAIHubSegment> BuildSegments(
            Segment[] segs,
            Segment[] tmSources,
            Segment[] tmTargets,
            FormattingAndTagsUsageOption formattingMode)
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
                _log($"Segment TM diagnostics index={index} tmSourcePresent={tmSourcePresent} tmTargetPresent={tmTargetPresent}");
            }

            _log($"TM diagnostics summary segments={segs.Length} tmSourcePresentCount={tmSourcePresentCount} tmTargetPresentCount={tmTargetPresentCount}");
            return items;
        }
    }
}
