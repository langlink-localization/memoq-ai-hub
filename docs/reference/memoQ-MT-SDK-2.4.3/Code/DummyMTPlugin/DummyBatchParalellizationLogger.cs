using System.IO;

namespace MemoQ.DummyMTPlugin
{
    internal class DummyBatchParalellizationLogger
    {
        private static readonly string logFileName = "BatchParalellizationLog.txt";
        internal static readonly object LockObject = new object();

        public static DummyBatchTranslateScope CreateScope(int batchSize, string logfileLocation)
        {
            if (Directory.Exists(logfileLocation))
                return new DummyBatchTranslateScope(batchSize, Path.Combine(logfileLocation, logFileName));

            return null;
        }
    }
}
