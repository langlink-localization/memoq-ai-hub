using System;
using System.Linq;
using MemoQ.Addins.Common.DataStructures;
using MemoQ.Addins.Common.Utils;
using MemoQ.MTInterfaces;

namespace MemoQAIHubPlugin
{
    internal sealed class MemoQAIHubResponseMapper
    {
        private readonly string _sourceLangCode;
        private readonly string _targetLangCode;
        private readonly Action<string> _log;

        public MemoQAIHubResponseMapper(string sourceLangCode, string targetLangCode, Action<string> log)
        {
            _sourceLangCode = sourceLangCode;
            _targetLangCode = targetLangCode;
            _log = log ?? (_ => { });
        }

        public static void ThrowIfUnsuccessful(MemoQAIHubTranslateResponse response)
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

        public MemoQAIHubSegmentResult[] MapTranslationsByIndex(
            MemoQAIHubTranslateResponse response,
            int expectedCount,
            TranslationResult[] results)
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
                    _log("Translation response contained an empty translation item.");
                    continue;
                }

                _log($"Translation received index={translation.index} length={(translation.text ?? string.Empty).Length}");

                if (translation.index < 0 || translation.index >= expectedCount)
                {
                    _log($"Translation response contained an invalid index={translation.index} expectedCount={expectedCount}");
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
                    _log($"Translation response contained a duplicate index={translation.index}");
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
                    _log($"Translation response omitted index={index}");
                }
            }

            return translationsByIndex;
        }

        public void ApplyTranslations(
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
                    results[index].Confidence = Math.Max(0d, Math.Min(1d, translation.confidence));
                    results[index].ConfidenceProviderName = results[index].Confidence > 0d ? "memoQ AI Hub" : null;
                    results[index].Info = string.IsNullOrWhiteSpace(translation.info) ? null : translation.info;
                    results[index].Exception = null;
                    _log($"Segment conversion success index={index}");
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

        public static MTException WrapException(Exception error)
        {
            return error as MTException ?? new MTException(error.Message, error.Message, error);
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
                _log($"Whitespace normalization failed: {error.Message}");
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
            _log(
                $"Segment conversion failed index={index} mode={formattingMode} sourceLength={sourceLength} targetLength={targetLength} tagCount={tagCount} error={(error?.Message ?? message)}"
            );

            return WrapException(error ?? new InvalidOperationException(message));
        }
    }
}
