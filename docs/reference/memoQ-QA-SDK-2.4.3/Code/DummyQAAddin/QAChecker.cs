using MemoQ.Addins.Common.Utils;
using MemoQ.QAInterfaces;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Xml;

namespace DummyQAAddin
{
    internal abstract class QAChecker
    {
        // record of used streams and temporary file paths
        protected readonly List<Stream> streams = new List<Stream>();

#if !KEEP_TEMPORARY_FILES
        protected readonly Dictionary<Stream, IDisposable> tempFilePaths = new Dictionary<Stream, IDisposable>();
#endif

        private Random r = new Random();

        protected bool disposed = false;

        protected Stream GetStreamForDocumentImpl(int transUnitCount)
        {
            if (disposed)
                throw new ObjectDisposedException("Dummy QA Addin - BatchQAChecker");

            // if you have a good idea, you may return different types
            // of streams based on the transUnitCount parameter
            // however do not use too much memory, FileStream is a safe choice

            Guid guid = Guid.NewGuid();

            string tempFolder;
            var folder = TempPathHelper.GetTempFolderForScope(out tempFolder);
            string filePath = Path.Combine(tempFolder, "dummy_qa_addin-" + guid + ".xliff");

            Stream fs = File.Create(filePath);

            streams.Add(fs);

#if !KEEP_TEMPORARY_FILES
            tempFilePaths.Add(fs, folder);
#endif

            return fs;
        }

        public Stream PerformCheckImpl(Stream stream, int transUnitCount, string chosenFormat)
        {
            // basically, what this method does is the following:
            // copies the content from the stream to the answer stream
            // with addition of checking the translations:
            //    - inserting markers
            //    - adding errors and warnings

            if (disposed)
                throw new ObjectDisposedException("Dummy QA Addin - BatchQAChecker");

            // sample addin does not do xliff:doc and other formats, only MemoQ-Xliff
            if (chosenFormat != ExportFormats.MqXliff)
                return stream;

            // if you have a good idea, you may return different types
            // of streams based on the transUnitCount parameter
            // however do not use too much memory, FileStream is a safe choice

            // temporary file for the answer
            Guid guid = Guid.NewGuid();
            string tempFolder;
            var folder = TempPathHelper.GetTempFolderForScope(out tempFolder);
            string filePath = Path.Combine(tempFolder, "dummy_qa_addin_answer-" + guid + ".xliff");

            // need to seek back to the beginning, because the framework just copied
            // the document to stream, so the current position is at the end
            stream.Seek(0, SeekOrigin.Begin);

            using (XmlReader rdr = XmlReader.Create(stream))
            using (XmlTextWriter wrt = new XmlTextWriter(filePath, Encoding.UTF8))
            {
                while (rdr.Read())
                {
                    // the only important part for the addin is in the trans-unit part
                    if (rdr.NodeType == XmlNodeType.Element
                        && rdr.LocalName == "trans-unit")
                    {
                        wrt.WriteStartElement("trans-unit");
                        // it is important to copy the attributes
                        wrt.WriteAttributes(rdr, false);
                        wrt.WriteWhitespace("\r\n");

                        #region source tag

                        // copy and process source tag
                        // ReadInnerXml is not the way you go, because it inserts xmlns attributes
                        // (because it wants to be namespace aware) so it screws up the hash!
                        rdr.Read();

                        rdr.EatWhitespace();

                        if (rdr.NodeType != XmlNodeType.Element || rdr.LocalName != "source")
                            throw new ApplicationException("Source tag is not after trans-unit");

                        wrt.WriteStartElement("source");
                        wrt.WriteAttributes(rdr, false);

                        string srcContent = rdr.ReadInnerAsString();
                        Text source = new Text(srcContent);
                        // use this instead of simple copy from reader to writer,
                        // because content of inline tags can contain special characters
                        // that XmlWriter does not escape the way memoQ does (e.g. " instead of &quot;)
                        wrt.WriteRaw(source.GetXliffRepresentation());

                        wrt.WriteEndElement();
                        wrt.WriteWhitespace("\r\n");

                        #endregion

                        #region target tag

                        // copy and process target tag
                        rdr.Read();

                        rdr.EatWhitespace();

                        if (rdr.NodeType != XmlNodeType.Element || rdr.LocalName != "target")
                            throw new ApplicationException("Target tag is not after source");

                        wrt.WriteStartElement("target");
                        wrt.WriteAttributes(rdr, false);

                        string trgContent = rdr.ReadInnerAsString();
                        Text target = new Text(trgContent);

                        #endregion

                        #region errors and warnings

                        // do check or review and write results to answer stream

                        TranslationCheckResult[] checkResults = reviewTranslation(source, target);

                        // write the target tag here, because markers are placed in the
                        // reviewTranslation call
                        wrt.WriteRaw(target.GetXliffRepresentation());

                        wrt.WriteEndElement();
                        wrt.WriteWhitespace("\r\n");

                        if (checkResults != null)
                        {
                            List<TranslationCheckResult> errors, warnings;

                            errors = checkResults.Where(cr => cr.Type == CheckResultType.Error).ToList();
                            warnings = checkResults.Where(cr => cr.Type == CheckResultType.Warning).ToList();

                            if (errors.Count > 0)
                                writeErrors(errors, wrt);
                            if (warnings.Count > 0)
                                writeWarnings(warnings, wrt);
                        }

                        #endregion

                        // trans-unit
                        wrt.WriteEndElement();
                        // whitespace writing not needed as there is
                        // whitespace after the closing tag in the original
                        // document so it will be copied

                        // jump over the closing trans-unit tag
                        rdr.Read();
                    }
                    else
                    {
                        // every other node is just copied to the answer
                        // this method is in the XmlExtensions class
                        rdr.ShallowCopyNodeTo(wrt);
                    }
                }
            }

            closeStream(stream);

            Stream fs = File.Open(filePath, FileMode.Open, FileAccess.Read, FileShare.Read);
            streams.Add(fs);

#if !KEEP_TEMPORARY_FILES
            tempFilePaths.Add(fs, folder);
#endif

            return fs;
        }

        protected void FinishedProcessingAnswerImpl(Stream stream)
        {
            if (disposed)
                throw new ObjectDisposedException("Dummy QA Addin - BatchQAChecker");

            closeStream(stream);
        }

        public void Dispose()
        {
            if (disposed)
                return;

            foreach (var stream in streams)
            {
                try
                {
                    stream.Dispose();
#if !KEEP_TEMPORARY_FILES
                    // delete temporary folder
                    IDisposable folder;
                    if (tempFilePaths.TryGetValue(stream, out folder))
                    {
                        folder.Dispose();
                    }
#endif
                }
                catch (Exception)
                { }
            }

            disposed = true;
        }

        private TranslationCheckResult[] reviewTranslation(Text source, Text target)
        {
            // TO-DO:
            // insert your QA check logic here

            // hints:
            // - you can place markers in the target text and TranslationCheckResult
            //   objects can refer to those markers if the error or warning is only
            //   about a part of the text
            // - you can return multiple errors and warnings about a translation
            // - if no problem found in the translation then return null

            if (source.Length <= 0 || target.Length <= 0)
                return null;

            // sample checks:

            #region #1

            // #1
            // always no error or warning
            // return null;

            #endregion

            #region #2

            // #2
            // random number of errors and warnings in a random range
            var result = new List<TranslationCheckResult>();
            int numWarnings = r.Next(4), numErrors = r.Next(4);

            for (int i = 0; i < numWarnings; i++)
            {
                var tcr = new TranslationCheckResult(source, target);
                int start = r.Next(0, target.Length - 1);
                //int start = 0;
                int end = r.Next(start + 1, target.Length);
                //int end = target.Length - 1;

                tcr.Type = CheckResultType.Warning;
                tcr.Code = r.Next(500, 700);
                tcr.DataSpecific = false;
                tcr.Ignorable = (i % 2) == 0;
                tcr.ProblemName = "Randomness";
                tcr.DisplayText = "Universe is so big";
                tcr.LongDescription = "Random generated warning";
                tcr.StartingPos = start == 0 ? (int?)null : target.AddMarker(start);
                tcr.EndingPos = end >= target.Length - 1 ? (int?)null : target.AddMarker(end);

                result.Add(tcr);
            }

            for (int i = 0; i < numErrors; i++)
            {
                var tcr = new TranslationCheckResult(source, target);
                int start = r.Next(0, target.Length - 1);
                int end = r.Next(start + 1, target.Length);

                tcr.Type = CheckResultType.Error;
                tcr.Code = r.Next(200, 500);
                tcr.DataSpecific = true;
                tcr.Ignorable = false;
                tcr.ProblemName = "High voltage";
                tcr.DisplayText = "You can get burned";
                tcr.LongDescription = "You shall respect electricity otherwise you can get burned, shocked and will not be able to translate";
                tcr.StartingPos = start == 0 ? (int?)null : target.AddMarker(start);
                tcr.EndingPos = end >= target.Length - 1 ? (int?)null : target.AddMarker(end);

                result.Add(tcr);
            }

            return result.ToArray();

            #endregion

            #region #3

            // #3
            // count of 'a' characters on target and source are not the same
            //int sourceCnt = source.OfType<FormattedCharacter>().Count(fc => fc.CharValue == 'a' || fc.CharValue == 'A');
            //int trgCount = target.OfType<FormattedCharacter>().Count(fc => fc.CharValue == 'a' || fc.CharValue == 'A');

            //if (sourceCnt == trgCount)
            //    return null;

            //var trc = new TranslationCheckResult(source, target);
            //trc.Code = 444;
            //trc.ProblemName = "A count mismatch";
            //trc.DataSpecific = false;
            //trc.DisplayText = "The count of 'a' characters are not the same on the two sides";
            //trc.Type = CheckResultType.Warning;

            //return new[] {trc};

            #endregion
        }

        private void writeErrors(IEnumerable<TranslationCheckResult> errors, XmlWriter writer)
        {
            writer.WriteStartElement("mq:errors");

            foreach (var error in errors)
                writeCheckResult(error, writer);

            writer.WriteEndElement();
            writer.WriteWhitespace("\r\n");
        }

        private void writeWarnings(IEnumerable<TranslationCheckResult> warnings, XmlWriter writer)
        {
            writer.WriteStartElement("mq:warnings");

            foreach (var warning in warnings)
                writeCheckResult(warning, writer);

            writer.WriteEndElement();
            writer.WriteWhitespace("\r\n");
        }

        private void writeCheckResult(TranslationCheckResult tcr, XmlWriter writer)
        {
            writer.WriteStartElement("mq:errorwarning");

            string codeToWrite = PluginDirector.GeneratorId.ToString("00") + tcr.Code.ToString("000");

            writer.WriteAttributeString("mq:code", codeToWrite);

            writer.WriteAttributeString("mq:problemname", tcr.ProblemName);

            writer.WriteAttributeString("mq:shorttext", tcr.DisplayText);

            if (!string.IsNullOrEmpty(tcr.LongDescription))
                writer.WriteAttributeString("mq:longdesc", tcr.LongDescription);

            // can be omitted if false
            writer.WriteAttributeString("mq:dataspecific", XmlConvert.ToString(tcr.DataSpecific));

            // can be omitted if false
            writer.WriteAttributeString("mq:ignorable", XmlConvert.ToString(tcr.Ignorable));

            if (tcr.StartingPos.HasValue)
                writer.WriteAttributeString("mq:range-start-mid", tcr.StartingPos.Value.ToString());

            if (tcr.EndingPos.HasValue)
                writer.WriteAttributeString("mq:range-end-mid", tcr.EndingPos.Value.ToString());

            writer.WriteEndElement();
            writer.WriteWhitespace("\r\n");
        }

        private void closeStream(Stream stream)
        {
            try
            {
                stream.Dispose();
                streams.Remove(stream);
#if !KEEP_TEMPORARY_FILES
                // delete temporary folder
                IDisposable folder;
                if (tempFilePaths.TryGetValue(stream, out folder))
                {
                    folder.Dispose();
                }
#endif
            }
            catch (Exception)
            { }
        }
    }
}
