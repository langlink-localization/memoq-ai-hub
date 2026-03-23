using System;
using System.IO;

namespace MemoQ.DummyMTPlugin
{
    internal class DummyBatchTranslateScope : IDisposable
    {
        private readonly string logFilePath;

        private readonly Guid scopeID = Guid.NewGuid();

        public DummyBatchTranslateScope(int batchSize, string logFilePath)
        {
            this.logFilePath = logFilePath;
            try
            {
                lock (DummyBatchParalellizationLogger.LockObject)
                    File.AppendAllLines(logFilePath, new string[] { $"{scopeID} \t start: {DateTime.UtcNow:MM/dd/yyyy hh:mm:ss.fff} \t segment count: {batchSize}" });
            }
            catch 
            { 
                // nothing to do here
            }
        }

        public void Dispose()
        {
            try
            {
                lock (DummyBatchParalellizationLogger.LockObject)
                    File.AppendAllLines(logFilePath, new string[] { $"{scopeID} \t end:   {DateTime.UtcNow:MM/dd/yyyy hh:mm:ss.fff}" });
            }
            catch
            {
                // nothing to do here
            }
        }
    }
}
