using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;

namespace MemoQAIHubPlugin
{
    internal static class MemoQAIHubPluginLogger
    {
        private const long LogMaxBytes = 5L * 1024L * 1024L;
        private const int LogMaxFiles = 6;
        private static readonly object Sync = new object();

        public static void Log(string message)
        {
            var line = $"[{DateTime.UtcNow:O}] [MemoQAIHubPlugin] {message}";
            Trace.WriteLine(line);

            try
            {
                lock (Sync)
                {
                    var logPath = ResolveLogPath();
                    Directory.CreateDirectory(Path.GetDirectoryName(logPath));
                    RotateLogFileIfNeeded(logPath);
                    File.AppendAllText(logPath, line + Environment.NewLine, Encoding.UTF8);
                    PruneLogFiles(Path.GetDirectoryName(logPath), Path.GetFileNameWithoutExtension(logPath));
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

        private static void RotateLogFileIfNeeded(string logPath)
        {
            var info = new FileInfo(logPath);
            if (!info.Exists || info.Length < LogMaxBytes)
            {
                return;
            }

            var directory = info.DirectoryName;
            var baseName = Path.GetFileNameWithoutExtension(logPath);
            var rotatedPath = Path.Combine(directory, $"{baseName}.{DateTime.UtcNow:yyyy-MM-ddTHH-mm-ss-fffZ}.log");
            File.Move(logPath, rotatedPath);
        }

        private static void PruneLogFiles(string directory, string baseName)
        {
            if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
            {
                return;
            }

            var cutoff = DateTime.UtcNow.AddDays(-14);
            var files = Directory.GetFiles(directory, $"{baseName}*.log")
                .Select(path => new FileInfo(path))
                .OrderByDescending(file => file.LastWriteTimeUtc)
                .ToList();

            foreach (var file in files.Where(file => file.LastWriteTimeUtc < cutoff).Concat(files.Skip(LogMaxFiles)))
            {
                try
                {
                    file.Delete();
                }
                catch
                {
                }
            }
        }
    }
}
