using System.IO;
using MemoQ.QAInterfaces;

namespace DummyQAAddin
{
    internal class SegmentLevelQAChecker : QAChecker, ISegmentLevelQAChecker
    {
        public Stream GetStreamForSegment()
        {
            return GetStreamForDocumentImpl(1);
        }

        public Stream PerformCheck(Stream stream, string chosenFormat)
        {
            return PerformCheckImpl(stream, 1, chosenFormat);
        }

        public void FinishedProcessingAnswer(Stream stream)
        {
            FinishedProcessingAnswerImpl(stream);
        }
    }
}
