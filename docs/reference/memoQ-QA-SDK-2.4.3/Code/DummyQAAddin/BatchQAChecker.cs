// use this directive to keep temporary files for debugging
//#define KEEP_TEMPORARY_FILES

using System.IO;
using MemoQ.QAInterfaces;

namespace DummyQAAddin
{
    internal class BatchQAChecker : QAChecker, IBatchQAChecker
    {
        public Stream GetStreamForDocument(int transUnitCount)
        {
            return GetStreamForDocumentImpl(transUnitCount);
        }

        public Stream PerformCheck(Stream stream, int transUnitCount, string chosenFormat)
        {
            return PerformCheckImpl(stream, transUnitCount, chosenFormat);
        }

        public void FinishedProcessingAnswer(Stream stream)
        {
            FinishedProcessingAnswerImpl(stream);
        }
    }
}
