using System;
using System.Linq;
using MemoQ.Addins.Common.DataStructures;
using MemoQ.Addins.Common.Utils;
using MemoQ.DummyMTPlugin;
using MemoQ.MTInterfaces;

namespace DummyMTPlugin
{
    /// <summary>
    /// Session that perform actual translation or storing translations. Created on a segment-by-segment basis, or once for batch operations.
    /// </summary>
    /// <remarks>
    /// Implementation checklist:
    ///     - The MTException class is used to wrap the original exceptions occurred during the translation.
    ///     - All allocated resources are disposed correctly in the session.
    /// </remarks>
    public class DummyMTSession : ISession, ISessionForStoringTranslations
    {
        /// <summary>
        /// The source language.
        /// </summary>
        private readonly string srcLangCode;

        /// <summary>
        /// The target language.
        /// </summary>
        private readonly string trgLangCode;

        /// <summary>
        /// Options of the plugin.
        /// </summary>
        private readonly DummyMTOptions options;

        private string tokenCode;

        public DummyMTSession(string srcLangCode, string trgLangCode, DummyMTOptions options, string tokenCode)
        {
            this.srcLangCode = srcLangCode;
            this.trgLangCode = trgLangCode;
            this.options = options;
            this.tokenCode = tokenCode;
        }

        #region ISession Members

        /// <summary>
        /// Translates a single segment, possibly using a fuzzy TM hit for improvement
        /// </summary>
        public TranslationResult TranslateCorrectSegment(Segment segm, Segment tmSource, Segment tmTarget)
        {
            TranslationResult result = new TranslationResult();

            try
            {
                string textToTranslate = createTextFromSegment(segm, options.GeneralSettings.FormattingAndTagUsage);
                string translation = DummyMTServiceHelper.Translate(options, textToTranslate, this.srcLangCode, this.trgLangCode);
                result.Translation = createSegmentFromResult(segm, translation, options.GeneralSettings.FormattingAndTagUsage);
            }
            catch (Exception e)
            {
                // Use the MTException class is to wrap the original exceptions occurred during the translation.
                string localizedMessage = LocalizationHelper.Instance.GetResourceString("NetworkError");
                result.Exception = new MTException(string.Format(localizedMessage, e.Message), string.Format("A network error occured ({0}).", e.Message), e);
            }

            return result;
        }

        /// <summary>
        /// Translates multiple segments, possibly using a fuzzy TM hit for improvement
        /// </summary>
        public TranslationResult[] TranslateCorrectSegment(Segment[] segs, Segment[] tmSources, Segment[] tmTargets)
        {
            using (DummyBatchParalellizationLogger.CreateScope(segs.Length, options?.GeneralSettings?.LogFileLocation))
            {
                TranslationResult[] results = new TranslationResult[segs.Length];

                try
                {
                    var texts = segs.Select(s => createTextFromSegment(s, options.GeneralSettings.FormattingAndTagUsage)).ToList();
                    int i = 0;
                    var translations = DummyMTServiceHelper.BatchTranslate(tokenCode, texts, this.srcLangCode, this.trgLangCode);
                    foreach (string translation in translations)
                    {
                        results[i] = new TranslationResult();
                        results[i].Translation = createSegmentFromResult(segs[i], translation, options.GeneralSettings.FormattingAndTagUsage);
                        i++;
                    }
                }
                catch (Exception e)
                {
                    // Use the MTException class is to wrap the original exceptions occurred during the translation.
                    foreach (TranslationResult result in results)
                    {
                        result.Exception = new MTException(e.Message, e.Message, e);
                    }
                }

                return results;
            }
        }

        /// <summary>
        /// Creates the text to translate from the segment according to the settings. Appends tags and formatting if needed.
        /// </summary>
        private string createTextFromSegment(Segment segment, FormattingAndTagsUsageOption formattingAndTagOption)
        {
            switch (formattingAndTagOption)
            {
                case FormattingAndTagsUsageOption.OnlyFormatting:
                    return SegmentHtmlConverter.ConvertSegment2Html(segment, false);
                case FormattingAndTagsUsageOption.BothFormattingAndTags:
                    return SegmentHtmlConverter.ConvertSegment2Html(segment, true);
                default:
                    return segment.PlainText;
            }
        }

        private static Segment createSegmentFromResult(Segment originalSegment, string translatedText, FormattingAndTagsUsageOption formattingAndTagUsage)
        {
            if (formattingAndTagUsage == FormattingAndTagsUsageOption.Plaintext)
                return SegmentBuilder.CreateFromTrimmedStringAndITags(translatedText, originalSegment.ITags);
            else if (formattingAndTagUsage == FormattingAndTagsUsageOption.OnlyFormatting)
            {
                // Convert to segment (conversion is needed because the result can contain formatting information)
                var convertedSegment = SegmentHtmlConverter.ConvertHtml2Segment(translatedText, originalSegment.ITags);
                var sb = new SegmentBuilder();
                sb.AppendSegment(convertedSegment);

                // Insert the tags to the end of the segment
                foreach (InlineTag it in originalSegment.ITags)
                    sb.AppendInlineTag(it);

                return sb.ToSegment();
            }
            else
                return SegmentHtmlConverter.ConvertHtml2Segment(translatedText, originalSegment.ITags);
        }

        #endregion

        #region ISessionForStoringTranslations

        public void StoreTranslation(TranslationUnit transunit)
        {
            try
            {
                DummyMTServiceHelper.StoreTranslation(options, transunit.Source.PlainText, transunit.Target.PlainText, this.srcLangCode, this.trgLangCode);
            }
            catch (Exception e)
            {
                // Use the MTException class is to wrap the original exceptions occurred during the translation.
                string localizedMessage = LocalizationHelper.Instance.GetResourceString("NetworkError");
                throw new MTException(string.Format(localizedMessage, e.Message), string.Format("A network error occured ({0}).", e.Message), e);
            }
        }

        public int[] StoreTranslation(TranslationUnit[] transunits)
        {
            try
            {
                return DummyMTServiceHelper.BatchStoreTranslation(options,
                                        transunits.Select(s => s.Source.PlainText).ToList(), transunits.Select(s => s.Target.PlainText).ToList(),
                                        this.srcLangCode, this.trgLangCode);
            }
            catch (Exception e)
            {
                // Use the MTException class is to wrap the original exceptions occurred during the translation.
                string localizedMessage = LocalizationHelper.Instance.GetResourceString("NetworkError");
                throw new MTException(string.Format(localizedMessage, e.Message), string.Format("A network error occured ({0}).", e.Message), e);
            }
        }

        #endregion

        #region IDisposable Members

        public void Dispose()
        {
            // dispose your resources if needed
        }

        #endregion
    }
}
