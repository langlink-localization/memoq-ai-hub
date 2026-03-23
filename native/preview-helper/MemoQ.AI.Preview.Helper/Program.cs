using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace MemoQAIHubPreviewHelper
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            var dataDir = ResolveDataDirectory(args);
            var app = new PreviewMirrorApp(dataDir);
            app.Run();
            return 0;
        }

        private static string ResolveDataDirectory(string[] args)
        {
            for (var index = 0; index < args.Length - 1; index += 1)
            {
                if (string.Equals(args[index], "--data-dir", StringComparison.OrdinalIgnoreCase))
                {
                    return args[index + 1];
                }
            }

            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return Path.Combine(appData, "memoq-ai-hub", "preview-helper");
        }
    }

    internal sealed class PreviewMirrorApp
    {
        private const string PipeBaseName = "MQ_PREVIEW_PIPE";
        private const string PreviewToolName = "memoQ AI Hub Preview Helper";
        private const string PreviewToolDescription = "Provides target-text, above-text, below-text, full-text, and summary support for memoQ AI Hub.";
        private const string PreviewPartIdRegex = ".*";
        private const string PreviewContentComplexity = "Minimal";
        private readonly object _sync = new object();
        private readonly string _dataDir;
        private readonly string _documentsDir;
        private readonly string _logsDir;
        private readonly string _statusPath;
        private readonly JavaScriptSerializer _serializer = new JavaScriptSerializer();
        private readonly Dictionary<string, DocumentCache> _documents = new Dictionary<string, DocumentCache>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, PendingResponse> _pendingResponses = new Dictionary<string, PendingResponse>(StringComparer.OrdinalIgnoreCase);
        private readonly Guid _previewToolId;
        private PipeTransport _pipe;
        private string _state = "starting";
        private string _lastError = string.Empty;
        private string _lastConnectedAt = string.Empty;
        private string _lastUpdatedAt = string.Empty;

        public PreviewMirrorApp(string dataDir)
        {
            _dataDir = dataDir;
            _documentsDir = Path.Combine(_dataDir, "documents");
            _logsDir = Path.Combine(_dataDir, "logs");
            _statusPath = Path.Combine(_dataDir, "status.json");
            _previewToolId = CreatePreviewToolId(dataDir);

            Directory.CreateDirectory(_dataDir);
            Directory.CreateDirectory(_documentsDir);
            Directory.CreateDirectory(_logsDir);
            WriteStatus("starting", connected: false, error: string.Empty);
        }

        public void Run()
        {
            while (true)
            {
                try
                {
                    ConnectAndPump();
                }
                catch (Exception error)
                {
                    Log($"Preview helper failure: {error}");
                    WriteStatus("error", connected: false, error: error.Message);
                }

                Thread.Sleep(3000);
            }
        }

        private void ConnectAndPump()
        {
            WriteStatus("connecting", connected: false, error: string.Empty);

            using (var pipe = new PipeTransport(PipeBaseName, _serializer))
            {
                _pipe = pipe;
                pipe.MessageReceived += HandleMessage;
                pipe.Connect();
                pipe.StartReading();

                var negotiation = SendCommandAndWait(
                    "negotiation-request",
                    new Dictionary<string, object>
                    {
                        ["KnownProtocolVersions"] = new[] { "V1" }
                    },
                    "negotiation-request"
                );

                var protocolVersion = negotiation.GetValue("ProtocolVersion");
                if (string.IsNullOrWhiteSpace(protocolVersion))
                {
                    throw new InvalidOperationException("memoQ preview negotiation failed.");
                }

                var registrationResponse = SendCommandAndWait(
                    "registration-request",
                    BuildRegistrationParameters(),
                    "registration-request"
                );

                if (!registrationResponse.Accepted)
                {
                    if (!IsAlreadyConnectedError(registrationResponse.ErrorCode))
                    {
                        throw new InvalidOperationException(registrationResponse.ErrorMessage ?? "memoQ preview helper registration was refused.");
                    }
                }

                if (IsAlreadyConnectedError(registrationResponse.ErrorCode))
                {
                    var connectResponse = SendCommandAndWait(
                        "connection-request",
                        new Dictionary<string, object>
                        {
                            ["PreviewToolId"] = _previewToolId.ToString()
                        },
                        "connection-request"
                    );

                    if (!connectResponse.Accepted)
                    {
                        throw new InvalidOperationException(connectResponse.ErrorMessage ?? "memoQ preview helper connection was refused.");
                    }
                }

                var runtimeSettingsResponse = SendCommandAndWait(
                    "change-runtime-settings-request",
                    BuildRuntimeSettingsParameters(),
                    "change-runtime-settings-request"
                );

                if (!runtimeSettingsResponse.Accepted)
                {
                    throw new InvalidOperationException(runtimeSettingsResponse.ErrorMessage ?? "memoQ preview runtime settings change was refused.");
                }

                WriteStatus("connected", connected: true, error: string.Empty);
                RequestPreviewPartIds();
                pipe.WaitUntilClosed();
            }

            WriteStatus("disconnected", connected: false, error: string.Empty);
        }

        private Dictionary<string, object> BuildRegistrationParameters()
        {
            // Keep registration aligned with the bridge transport and only send
            // auto-start metadata when the helper really needs memoQ to launch it.
            return new Dictionary<string, object>
            {
                ["PreviewToolId"] = _previewToolId.ToString(),
                ["PreviewToolName"] = PreviewToolName,
                ["PreviewToolDescription"] = PreviewToolDescription,
                ["PreviewPartIdRegex"] = PreviewPartIdRegex,
                ["RequiresWebPreviewBaseUrl"] = false,
                ["ContentComplexity"] = PreviewContentComplexity,
                ["RequiredProperties"] = new string[0]
            };
        }

        private Dictionary<string, object> BuildRuntimeSettingsParameters()
        {
            return new Dictionary<string, object>
            {
                ["PreviewToolId"] = _previewToolId.ToString(),
                ["ContentComplexity"] = PreviewContentComplexity,
                ["RequiredProperties"] = new string[0]
            };
        }

        private static bool IsAlreadyConnectedError(string errorCode)
        {
            var normalized = NormalizeErrorCode(errorCode);
            return string.Equals(normalized, "previewtoolalreadyconnectedwiththisid", StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeErrorCode(string errorCode)
        {
            return string.IsNullOrWhiteSpace(errorCode)
                ? string.Empty
                : new string(errorCode.Where(char.IsLetterOrDigit).ToArray());
        }

        private PendingResponse SendCommandAndWait(string commandType, Dictionary<string, object> parameters, string responseKey)
        {
            PendingResponse pending;
            lock (_sync)
            {
                pending = new PendingResponse(responseKey);
                _pendingResponses[responseKey] = pending;
            }

            _pipe.Send(commandType, parameters);
            if (!pending.WaitHandle.WaitOne(5000))
            {
                throw new TimeoutException($"Timed out while waiting for preview response: {responseKey}");
            }

            lock (_sync)
            {
                _pendingResponses.Remove(responseKey);
            }

            return pending;
        }

        private void RequestPreviewPartIds()
        {
            _pipe.Send(
                "preview-part-id-update-request-from-preview-tool",
                new Dictionary<string, object>
                {
                    ["PreviewToolId"] = _previewToolId.ToString()
                }
            );
        }

        private void HandleMessage(object sender, PipeMessageEventArgs eventArgs)
        {
            var commandType = eventArgs.CommandType;
            var parameters = eventArgs.CommandParameters;

            if (string.Equals(commandType, "request-accepted", StringComparison.OrdinalIgnoreCase))
            {
                var originalCommandType = ReadString(parameters, "CommandType");
                ResolvePending(originalCommandType, accepted: true, parameters, string.Empty, string.Empty);
                return;
            }

            if (string.Equals(commandType, "request-refused", StringComparison.OrdinalIgnoreCase))
            {
                var originalCommandType = ReadString(parameters, "CommandType");
                ResolvePending(
                    originalCommandType,
                    accepted: false,
                    parameters,
                    ReadString(parameters, "ErrorCode"),
                    ReadString(parameters, "ErrorMessage")
                );
                return;
            }

            if (string.Equals(commandType, "invalid-request", StringComparison.OrdinalIgnoreCase))
            {
                var originalRequest = ReadDictionary(parameters, "OriginalRequest");
                var originalCommandType = ReadString(originalRequest, "CommandType");
                ResolvePending(
                    originalCommandType,
                    accepted: false,
                    parameters,
                    "InvalidRequestParameters",
                    ReadString(parameters, "ErrorMessage")
                );
                return;
            }

            if (string.Equals(commandType, "negotiation-response", StringComparison.OrdinalIgnoreCase))
            {
                ResolvePending("negotiation-request", accepted: true, parameters, string.Empty, string.Empty);
                return;
            }

            if (string.Equals(commandType, "content-update-request-from-mq", StringComparison.OrdinalIgnoreCase))
            {
                HandleContentUpdate(parameters);
                return;
            }

            if (string.Equals(commandType, "change-highlight-request-from-mq", StringComparison.OrdinalIgnoreCase))
            {
                HandleHighlightChange(parameters);
                return;
            }

            if (string.Equals(commandType, "preview-part-id-update-request-from-mq", StringComparison.OrdinalIgnoreCase))
            {
                HandlePreviewPartIdUpdate(parameters);
            }
        }

        private void ResolvePending(string key, bool accepted, IDictionary<string, object> parameters, string errorCode, string errorMessage)
        {
            if (string.IsNullOrWhiteSpace(key))
            {
                return;
            }

            PendingResponse pending;
            lock (_sync)
            {
                if (!_pendingResponses.TryGetValue(key, out pending))
                {
                    return;
                }
            }

            pending.Accepted = accepted;
            pending.Payload = CopyDictionary(parameters);
            pending.ErrorCode = errorCode;
            pending.ErrorMessage = errorMessage;
            pending.WaitHandle.Set();
        }

        private void HandleContentUpdate(IDictionary<string, object> parameters)
        {
            var previewParts = ReadArray(parameters, "PreviewParts");
            for (var index = 0; index < previewParts.Length; index += 1)
            {
                var item = previewParts[index];
                var previewPart = item as IDictionary<string, object>;
                if (previewPart == null)
                {
                    continue;
                }

                var sourceDocument = ReadDictionary(previewPart, "SourceDocument");
                var documentId = ReadString(sourceDocument, "DocumentGuid");
                var documentName = ReadString(sourceDocument, "DocumentName");
                var importPath = ReadString(sourceDocument, "ImportPath");
                var sourceLanguage = ReadString(previewPart, "SourceLangCode");
                var targetLanguage = ReadString(previewPart, "TargetLangCode");
                var previewPartId = ReadString(previewPart, "PreviewPartId");
                if (string.IsNullOrWhiteSpace(documentId))
                {
                    continue;
                }

                var sourceContent = ReadDictionary(previewPart, "SourceContent");
                var targetContent = ReadDictionary(previewPart, "TargetContent");

                var key = BuildDocumentKey(documentId, sourceLanguage, targetLanguage);
                DocumentCache document;
                lock (_sync)
                {
                    if (!_documents.TryGetValue(key, out document))
                    {
                        document = new DocumentCache
                        {
                            DocumentId = documentId,
                            SourceLanguage = sourceLanguage,
                            TargetLanguage = targetLanguage
                        };
                        _documents[key] = document;
                    }

                    var sourceText = ReadString(sourceContent, "Content");
                    var targetText = ReadString(targetContent, "Content");
                    document.DocumentName = documentName;
                    document.ImportPath = importPath;
                    document.UpdatedAt = DateTime.UtcNow.ToString("o");
                    document.UpsertPreviewPart(new PreviewPartCache
                    {
                        PreviewPartId = previewPartId,
                        Order = index,
                        SourceText = sourceText,
                        TargetText = targetText
                    });

                    var segmentIndex = ResolveSegmentIndex(document, previewPartId);
                    if (segmentIndex >= 0)
                    {
                        document.UpsertSegment(new SegmentCache
                        {
                            Index = segmentIndex,
                            PreviewPartId = previewPartId,
                            SourceText = sourceText,
                            TargetText = targetText
                        });
                    }
                }

                PersistDocument(document);
            }

            WriteStatus("connected", connected: true, error: string.Empty);
        }

        private void HandleHighlightChange(IDictionary<string, object> parameters)
        {
            var activePreviewParts = ReadArray(parameters, "ActivePreviewParts");
            var parts = new List<IDictionary<string, object>>();

            foreach (var item in activePreviewParts)
            {
                if (item is IDictionary<string, object> part)
                {
                    parts.Add(part);
                }
            }

            if (parts.Count == 0)
            {
                return;
            }

            var firstPart = parts.First();
            var firstSourceDocument = ReadDictionary(firstPart, "SourceDocument");
            var documentId = ReadString(firstSourceDocument, "DocumentGuid");
            var sourceLanguage = ReadString(firstPart, "SourceLangCode");
            var targetLanguage = ReadString(firstPart, "TargetLangCode");
            if (string.IsNullOrWhiteSpace(documentId))
            {
                return;
            }

            var key = BuildDocumentKey(documentId, sourceLanguage, targetLanguage);

            DocumentCache document;
            lock (_sync)
            {
                if (!_documents.TryGetValue(key, out document))
                {
                    document = new DocumentCache
                    {
                        DocumentId = documentId,
                        SourceLanguage = sourceLanguage,
                        TargetLanguage = targetLanguage
                    };
                    _documents[key] = document;
                }

                document.DocumentName = ReadString(firstSourceDocument, "DocumentName");
                document.ImportPath = ReadString(firstSourceDocument, "ImportPath");
                document.ActivePreviewPartIds = parts
                    .Select(part => ReadString(part, "PreviewPartId"))
                    .Where(id => !string.IsNullOrWhiteSpace(id))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                var resolvedIndices = new List<int>();
                for (var index = 0; index < parts.Count; index += 1)
                {
                    var part = parts[index];
                    var previewPartId = ReadString(part, "PreviewPartId");
                    var sourceContent = ReadDictionary(part, "SourceContent");
                    var targetContent = ReadDictionary(part, "TargetContent");
                    var sourceText = ReadString(sourceContent, "Content");
                    var targetText = ReadString(targetContent, "Content");
                    var sourceFocusedRange = ReadFocusedRange(part, "SourceFocusedRange");
                    var targetFocusedRange = ReadFocusedRange(part, "TargetFocusedRange");

                    document.UpsertPreviewPartFocus(new PreviewPartCache
                    {
                        PreviewPartId = previewPartId,
                        Order = index,
                        SourceText = sourceText,
                        TargetText = targetText,
                        SourceFocusedRange = sourceFocusedRange,
                        TargetFocusedRange = targetFocusedRange
                    });

                    var resolvedIndex = ResolveSegmentIndex(document, previewPartId);
                    if (resolvedIndex >= 0)
                    {
                        resolvedIndices.Add(resolvedIndex);
                        document.UpsertSegment(new SegmentCache
                        {
                            Index = resolvedIndex,
                            PreviewPartId = previewPartId,
                            SourceText = sourceText,
                            TargetText = targetText
                        });
                    }
                }

                if (resolvedIndices.Count > 0)
                {
                    document.CurrentRange = new RangeCache
                    {
                        Start = resolvedIndices.Min(),
                        End = resolvedIndices.Max(),
                        UpdatedAt = DateTime.UtcNow.ToString("o")
                    };
                }
                else
                {
                    document.CurrentRange = null;
                }
                document.UpdatedAt = DateTime.UtcNow.ToString("o");
            }

            PersistDocument(document);
            WriteStatus("connected", connected: true, error: string.Empty);
        }

        private void HandlePreviewPartIdUpdate(IDictionary<string, object> parameters)
        {
            var previewPartIds = ReadArray(parameters, "PreviewPartIds")
                .Select(item => Convert.ToString(item) ?? string.Empty)
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            if (previewPartIds.Length == 0)
            {
                return;
            }

            _pipe.Send(
                "content-update-request-from-preview-tool",
                new Dictionary<string, object>
                {
                    ["PreviewToolId"] = _previewToolId.ToString(),
                    ["PreviewPartIds"] = previewPartIds
                }
            );
        }

        private void PersistDocument(DocumentCache document)
        {
            if (document == null)
            {
                return;
            }

            var payload = new Dictionary<string, object>
            {
                ["documentId"] = document.DocumentId ?? string.Empty,
                ["documentName"] = document.DocumentName ?? string.Empty,
                ["importPath"] = document.ImportPath ?? string.Empty,
                ["sourceLanguage"] = document.SourceLanguage ?? string.Empty,
                ["targetLanguage"] = document.TargetLanguage ?? string.Empty,
                ["updatedAt"] = document.UpdatedAt ?? DateTime.UtcNow.ToString("o"),
                ["currentRange"] = document.CurrentRange == null
                    ? null
                    : new Dictionary<string, object>
                    {
                        ["start"] = document.CurrentRange.Start,
                        ["end"] = document.CurrentRange.End,
                        ["updatedAt"] = document.CurrentRange.UpdatedAt ?? string.Empty
                    },
                ["activePreviewPartIds"] = document.ActivePreviewPartIds.ToArray(),
                ["parts"] = document.PreviewParts
                    .OrderBy(part => part.Order)
                    .Select(part => new Dictionary<string, object>
                    {
                        ["previewPartId"] = part.PreviewPartId ?? string.Empty,
                        ["sourceText"] = part.SourceText ?? string.Empty,
                        ["targetText"] = part.TargetText ?? string.Empty,
                        ["sourceFocusedRange"] = ToFocusedRangeDictionary(part.SourceFocusedRange),
                        ["targetFocusedRange"] = ToFocusedRangeDictionary(part.TargetFocusedRange),
                        ["order"] = part.Order
                    })
                    .ToArray(),
                ["segments"] = document.Segments
                    .OrderBy(segment => segment.Index)
                    .Select(segment => new Dictionary<string, object>
                    {
                        ["index"] = segment.Index,
                        ["previewPartId"] = segment.PreviewPartId ?? string.Empty,
                        ["sourceText"] = segment.SourceText ?? string.Empty,
                        ["targetText"] = segment.TargetText ?? string.Empty
                    })
                    .ToArray()
            };

            var fileName = $"{SanitizeToken(document.DocumentId)}__{SanitizeToken(document.SourceLanguage)}__{SanitizeToken(document.TargetLanguage)}.json";
            var filePath = Path.Combine(_documentsDir, fileName);
            File.WriteAllText(filePath, _serializer.Serialize(payload), Encoding.UTF8);
        }

        private static int ResolveSegmentIndex(DocumentCache document, string previewPartId)
        {
            if (document != null && !string.IsNullOrWhiteSpace(previewPartId))
            {
                var mappedSegment = document.Segments.FirstOrDefault(item =>
                    string.Equals(item.PreviewPartId, previewPartId, StringComparison.OrdinalIgnoreCase));
                if (mappedSegment != null && mappedSegment.Index >= 0)
                {
                    return mappedSegment.Index;
                }
            }

            return ParseTrailingInteger(previewPartId);
        }

        private static IDictionary<string, object> ToFocusedRangeDictionary(FocusedRangeCache range)
        {
            if (range == null)
            {
                return null;
            }

            return new Dictionary<string, object>
            {
                ["startIndex"] = range.StartIndex,
                ["length"] = range.Length
            };
        }

        private static FocusedRangeCache ReadFocusedRange(IDictionary<string, object> source, string key)
        {
            var range = ReadDictionary(source, key);
            if (range.Count == 0)
            {
                return null;
            }

            if (!TryReadInt(range, "StartIndex", out var startIndex) && !TryReadInt(range, "startIndex", out startIndex))
            {
                return null;
            }

            if (!TryReadInt(range, "Length", out var length) && !TryReadInt(range, "length", out length))
            {
                return null;
            }

            return new FocusedRangeCache
            {
                StartIndex = startIndex,
                Length = length
            };
        }

        private void WriteStatus(string state, bool connected, string error)
        {
            lock (_sync)
            {
                _state = state ?? "idle";
                _lastError = error ?? string.Empty;
                _lastUpdatedAt = DateTime.UtcNow.ToString("o");
                if (connected)
                {
                    _lastConnectedAt = _lastUpdatedAt;
                }

                var payload = new Dictionary<string, object>
                {
                    ["previewToolId"] = _previewToolId.ToString(),
                    ["connected"] = connected,
                    ["state"] = _state,
                    ["lastError"] = _lastError,
                    ["lastConnectedAt"] = _lastConnectedAt,
                    ["lastUpdatedAt"] = _lastUpdatedAt
                };

                File.WriteAllText(_statusPath, _serializer.Serialize(payload), Encoding.UTF8);
            }
        }

        private void Log(string message)
        {
            try
            {
                var logPath = Path.Combine(_logsDir, "preview-helper.log");
                File.AppendAllText(logPath, $"[{DateTime.UtcNow:O}] {message}{Environment.NewLine}", Encoding.UTF8);
            }
            catch
            {
            }
        }

        private static Guid CreatePreviewToolId(string value)
        {
            using (var md5 = MD5.Create())
            {
                var hash = md5.ComputeHash(Encoding.UTF8.GetBytes(value ?? string.Empty));
                var suffix = BitConverter.ToString(hash).Replace("-", string.Empty).ToLowerInvariant().Substring(0, 12);
                return Guid.Parse($"c6f2be44-e33c-478e-ba23-{suffix}");
            }
        }

        private static int ParseTrailingInteger(string value)
        {
            // Compatibility fallback for legacy preview ids that embed an index.
            var match = Regex.Match(value ?? string.Empty, @"(\d+)$");
            if (!match.Success)
            {
                return -1;
            }

            return int.TryParse(match.Groups[1].Value, out var parsed) ? parsed : -1;
        }

        private static IDictionary<string, object> CopyDictionary(IDictionary<string, object> source)
        {
            var copy = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            if (source == null)
            {
                return copy;
            }

            foreach (var pair in source)
            {
                copy[pair.Key] = pair.Value;
            }

            return copy;
        }

        private static IDictionary<string, object> ReadDictionary(IDictionary<string, object> source, string key)
        {
            if (source == null || !source.ContainsKey(key) || source[key] == null)
            {
                return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            }

            if (source[key] is IDictionary<string, object> direct)
            {
                return direct;
            }

            return source[key] as Dictionary<string, object> ?? new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        }

        private static object[] ReadArray(IDictionary<string, object> source, string key)
        {
            if (source == null || !source.ContainsKey(key) || source[key] == null)
            {
                return new object[0];
            }

            return source[key] as object[] ?? new object[0];
        }

        private static string ReadString(IDictionary<string, object> source, string key)
        {
            if (source == null || !source.ContainsKey(key) || source[key] == null)
            {
                return string.Empty;
            }

            return Convert.ToString(source[key]) ?? string.Empty;
        }

        private static bool TryReadInt(IDictionary<string, object> source, string key, out int value)
        {
            value = 0;
            if (source == null || !source.ContainsKey(key) || source[key] == null)
            {
                return false;
            }

            try
            {
                value = Convert.ToInt32(source[key]);
                return true;
            }
            catch
            {
                return int.TryParse(Convert.ToString(source[key]), out value);
            }
        }

        private static string BuildDocumentKey(string documentId, string sourceLanguage, string targetLanguage)
        {
            return $"{documentId}|{sourceLanguage}|{targetLanguage}";
        }

        private static string SanitizeToken(string value)
        {
            var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
            var builder = new StringBuilder(normalized.Length);
            foreach (var character in normalized)
            {
                builder.Append(char.IsLetterOrDigit(character) || character == '.' || character == '_' || character == '-'
                    ? character
                    : '_');
            }

            return builder.ToString();
        }
    }

    internal sealed class PipeTransport : IDisposable
    {
        private readonly string _pipeName;
        private readonly JavaScriptSerializer _serializer;
        private readonly ManualResetEventSlim _closedEvent = new ManualResetEventSlim(false);
        private NamedPipeClientStream _stream;

        public PipeTransport(string pipeName, JavaScriptSerializer serializer)
        {
            _pipeName = pipeName;
            _serializer = serializer;
        }

        public event EventHandler<PipeMessageEventArgs> MessageReceived;

        public void Connect()
        {
            _stream = new NamedPipeClientStream(
                ".",
                $"{_pipeName}_{Process.GetCurrentProcess().SessionId}",
                PipeDirection.InOut,
                PipeOptions.Asynchronous
            );

            _stream.Connect(2000);
            _stream.ReadMode = PipeTransmissionMode.Message;
        }

        public void StartReading()
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    while (_stream != null && _stream.IsConnected)
                    {
                        var data = ReadSingleMessage();
                        if (data == null || data.Length == 0)
                        {
                            break;
                        }

                        var json = Encoding.UTF8.GetString(data);
                        var payload = _serializer.DeserializeObject(json) as IDictionary<string, object>;
                        if (payload == null)
                        {
                            continue;
                        }

                        var commandType = payload.ContainsKey("CommandType") ? Convert.ToString(payload["CommandType"]) : string.Empty;
                        var commandParameters = payload.ContainsKey("CommandParameters")
                            ? payload["CommandParameters"] as IDictionary<string, object>
                            : null;

                        MessageReceived?.Invoke(this, new PipeMessageEventArgs(commandType, commandParameters ?? new Dictionary<string, object>()));
                    }
                }
                finally
                {
                    _closedEvent.Set();
                }
            });
        }

        public void Send(string commandType, IDictionary<string, object> commandParameters)
        {
            var payload = new Dictionary<string, object>
            {
                ["CommandType"] = commandType,
                ["CommandParameters"] = commandParameters ?? new Dictionary<string, object>()
            };

            var json = _serializer.Serialize(payload);
            var bytes = Encoding.UTF8.GetBytes(json);
            _stream.Write(bytes, 0, bytes.Length);
            _stream.Flush();
        }

        public void WaitUntilClosed()
        {
            _closedEvent.Wait();
        }

        public void Dispose()
        {
            try
            {
                _stream?.Dispose();
            }
            catch
            {
            }
        }

        private byte[] ReadSingleMessage()
        {
            using (var memory = new MemoryStream())
            {
                var buffer = new byte[4096];
                do
                {
                    var read = _stream.Read(buffer, 0, buffer.Length);
                    if (read == 0)
                    {
                        break;
                    }

                    memory.Write(buffer, 0, read);
                }
                while (!_stream.IsMessageComplete);

                return memory.ToArray();
            }
        }
    }

    internal sealed class PipeMessageEventArgs : EventArgs
    {
        public PipeMessageEventArgs(string commandType, IDictionary<string, object> commandParameters)
        {
            CommandType = commandType ?? string.Empty;
            CommandParameters = commandParameters ?? new Dictionary<string, object>();
        }

        public string CommandType { get; }
        public IDictionary<string, object> CommandParameters { get; }
    }

    internal sealed class PendingResponse
    {
        public PendingResponse(string commandType)
        {
            CommandType = commandType;
            WaitHandle = new AutoResetEvent(false);
        }

        public string CommandType { get; }
        public bool Accepted { get; set; }
        public string ErrorCode { get; set; }
        public string ErrorMessage { get; set; }
        public IDictionary<string, object> Payload { get; set; }
        public AutoResetEvent WaitHandle { get; }

        public string GetValue(string key)
        {
            if (Payload == null || !Payload.ContainsKey(key) || Payload[key] == null)
            {
                return string.Empty;
            }

            return Convert.ToString(Payload[key]) ?? string.Empty;
        }
    }

    internal sealed class DocumentCache
    {
        public string DocumentId { get; set; }
        public string DocumentName { get; set; }
        public string ImportPath { get; set; }
        public string SourceLanguage { get; set; }
        public string TargetLanguage { get; set; }
        public string UpdatedAt { get; set; }
        public RangeCache CurrentRange { get; set; }
        public List<string> ActivePreviewPartIds { get; set; } = new List<string>();
        public List<PreviewPartCache> PreviewParts { get; } = new List<PreviewPartCache>();
        public List<SegmentCache> Segments { get; } = new List<SegmentCache>();

        public void UpsertPreviewPart(PreviewPartCache incoming)
        {
            var existing = PreviewParts.FirstOrDefault(item => string.Equals(item.PreviewPartId, incoming.PreviewPartId, StringComparison.OrdinalIgnoreCase));
            if (existing == null)
            {
                PreviewParts.Add(incoming);
                return;
            }

            existing.Order = incoming.Order;
            existing.SourceText = incoming.SourceText;
            existing.TargetText = incoming.TargetText;
            existing.SourceFocusedRange = incoming.SourceFocusedRange ?? existing.SourceFocusedRange;
            existing.TargetFocusedRange = incoming.TargetFocusedRange ?? existing.TargetFocusedRange;
        }

        public void UpsertPreviewPartFocus(PreviewPartCache incoming)
        {
            var existing = PreviewParts.FirstOrDefault(item => string.Equals(item.PreviewPartId, incoming.PreviewPartId, StringComparison.OrdinalIgnoreCase));
            if (existing == null)
            {
                PreviewParts.Add(incoming);
                return;
            }

            if (!string.IsNullOrWhiteSpace(incoming.SourceText))
            {
                existing.SourceText = incoming.SourceText;
            }

            if (!string.IsNullOrWhiteSpace(incoming.TargetText))
            {
                existing.TargetText = incoming.TargetText;
            }

            if (incoming.SourceFocusedRange != null)
            {
                existing.SourceFocusedRange = incoming.SourceFocusedRange;
            }

            if (incoming.TargetFocusedRange != null)
            {
                existing.TargetFocusedRange = incoming.TargetFocusedRange;
            }
        }

        public void UpsertSegment(SegmentCache incoming)
        {
            var existing = Segments.FirstOrDefault(item => item.Index == incoming.Index);
            if (existing == null)
            {
                Segments.Add(incoming);
                return;
            }

            existing.SourceText = incoming.SourceText;
            existing.TargetText = incoming.TargetText;
            existing.PreviewPartId = incoming.PreviewPartId;
        }
    }

    internal sealed class PreviewPartCache
    {
        public string PreviewPartId { get; set; }
        public string SourceText { get; set; }
        public string TargetText { get; set; }
        public FocusedRangeCache SourceFocusedRange { get; set; }
        public FocusedRangeCache TargetFocusedRange { get; set; }
        public int Order { get; set; }
    }

    internal sealed class SegmentCache
    {
        public int Index { get; set; }
        public string PreviewPartId { get; set; }
        public string SourceText { get; set; }
        public string TargetText { get; set; }
    }

    internal sealed class RangeCache
    {
        public int Start { get; set; }
        public int End { get; set; }
        public string UpdatedAt { get; set; }
    }

    internal sealed class FocusedRangeCache
    {
        public int StartIndex { get; set; }
        public int Length { get; set; }
    }
}
