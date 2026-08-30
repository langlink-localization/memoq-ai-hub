using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace MemoQAIHubPlugin
{
    internal static class MemoQAIHubServiceHelper
    {
        private const int MinimumGatewayTimeoutMs = 120000;
        private static readonly HttpClient HttpClient = CreateHttpClient();
        private static readonly ConcurrentDictionary<string, byte> VerifiedContractVersions = new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase);
        private static readonly object HandshakeLock = new object();

        // Two-way contract handshake: the plugin stamps its expected contract
        // version into requests, and before the first gateway call it verifies
        // the desktop actually speaks the same version. Mismatches fail fast
        // with an actionable message instead of opaque per-segment errors.
        // The lock keeps concurrent first calls to one single verification.
        public static void EnsureContractVersion(string baseUrl, Action<string> log)
        {
            var normalizedBaseUrl = (baseUrl ?? string.Empty).Trim();
            if (VerifiedContractVersions.ContainsKey(normalizedBaseUrl))
            {
                return;
            }

            lock (HandshakeLock)
            {
                if (VerifiedContractVersions.ContainsKey(normalizedBaseUrl))
                {
                    return;
                }

                var remoteVersion = GetDesktopContractVersion(normalizedBaseUrl);
                if (!string.Equals(remoteVersion, MemoQAIHubContract.Version, StringComparison.Ordinal))
                {
                    throw new InvalidOperationException(
                        "memoQ AI Hub desktop contract version mismatch: the plugin expects contract version "
                        + MemoQAIHubContract.Version
                        + " but the desktop gateway reported '"
                        + (string.IsNullOrWhiteSpace(remoteVersion) ? "unknown" : remoteVersion)
                        + "'. Update the memoQ AI Hub desktop app and plugin to matching versions."
                    );
                }

                VerifiedContractVersions.TryAdd(normalizedBaseUrl, 0);
                log?.Invoke($"Desktop contract handshake ok baseUrl={normalizedBaseUrl} contractVersion={remoteVersion}");
            }
        }

        private static string GetDesktopContractVersion(string baseUrl)
        {
            var serializer = new JavaScriptSerializer();
            using (var timeoutCts = new CancellationTokenSource(TimeSpan.FromMilliseconds(MemoQAIHubContract.HandshakeTimeoutMs)))
            using (var request = new HttpRequestMessage(HttpMethod.Get, baseUrl.TrimEnd('/') + MemoQAIHubContract.DesktopVersionPath))
            {
                try
                {
                    using (var response = HttpClient.SendAsync(request, HttpCompletionOption.ResponseContentRead, timeoutCts.Token).GetAwaiter().GetResult())
                    {
                        var text = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                        if (!response.IsSuccessStatusCode)
                        {
                            throw new HttpRequestException(BuildHttpErrorMessage(response, text));
                        }

                        var versionResponse = serializer.Deserialize<MemoQAIHubDesktopVersionResponse>(text);
                        return versionResponse?.contractVersion ?? string.Empty;
                    }
                }
                catch (TaskCanceledException error) when (timeoutCts.IsCancellationRequested)
                {
                    throw new TimeoutException("Desktop version handshake timed out after " + MemoQAIHubContract.HandshakeTimeoutMs + " ms.", error);
                }
            }
        }

        public static MemoQAIHubTranslateResponse Translate(string baseUrl, int timeoutMs, MemoQAIHubTranslateRequest payload)
        {
            return PostJson<MemoQAIHubTranslateResponse>(baseUrl, timeoutMs, "/mt/translate", payload, "Desktop translation service");
        }

        public static MemoQAIHubAggregateSubmitResponse SubmitAggregateTranslation(string baseUrl, int timeoutMs, MemoQAIHubTranslateRequest payload)
        {
            return PostJson<MemoQAIHubAggregateSubmitResponse>(baseUrl, timeoutMs, "/mt/translate-aggregate", payload, "Desktop aggregate translation submit service");
        }

        public static MemoQAIHubTranslateResponse WaitAggregateTranslation(string baseUrl, int timeoutMs, MemoQAIHubAggregateResultRequest payload)
        {
            return PostJson<MemoQAIHubTranslateResponse>(baseUrl, timeoutMs, "/mt/translate-aggregate/result", payload, "Desktop aggregate translation result service");
        }

        public static MemoQAIHubStoreTranslationsResponse StoreTranslations(string baseUrl, int timeoutMs, MemoQAIHubStoreTranslationsRequest payload)
        {
            return PostJson<MemoQAIHubStoreTranslationsResponse>(baseUrl, timeoutMs, "/mt/store-translations", payload, "Desktop translation writeback service");
        }

        private static TResponse PostJson<TResponse>(string baseUrl, int timeoutMs, string relativePath, object payload, string serviceName)
        {
            var serializer = new JavaScriptSerializer();
            var body = serializer.Serialize(payload);
            var effectiveTimeoutMs = NormalizeTimeoutMs(timeoutMs);
            using (var timeoutCts = new CancellationTokenSource(TimeSpan.FromMilliseconds(effectiveTimeoutMs)))
            using (var content = new StringContent(body, Encoding.UTF8, "application/json"))
            using (var request = new HttpRequestMessage(HttpMethod.Post, baseUrl.TrimEnd('/') + relativePath)
            {
                Content = content
            })
            {
                try
                {
                    using (var response = HttpClient.SendAsync(request, HttpCompletionOption.ResponseContentRead, timeoutCts.Token).GetAwaiter().GetResult())
                    {
                        var text = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                        if (!response.IsSuccessStatusCode)
                        {
                            throw new HttpRequestException(BuildHttpErrorMessage(response, text));
                        }

                        if (string.IsNullOrWhiteSpace(text))
                        {
                            throw new InvalidOperationException(serviceName + " returned an empty response.");
                        }

                        var result = serializer.Deserialize<TResponse>(text);
                        if (result == null)
                        {
                            throw new InvalidOperationException(serviceName + " returned an invalid response payload.");
                        }

                        return result;
                    }
                }
                catch (TaskCanceledException error) when (timeoutCts.IsCancellationRequested)
                {
                    throw new TimeoutException(serviceName + " timed out after " + effectiveTimeoutMs + " ms.", error);
                }
            }
        }

        private static HttpClient CreateHttpClient()
        {
            return new HttpClient
            {
                Timeout = Timeout.InfiniteTimeSpan
            };
        }

        private static int NormalizeTimeoutMs(int timeoutMs)
        {
            return timeoutMs >= MinimumGatewayTimeoutMs ? timeoutMs : MinimumGatewayTimeoutMs;
        }

        private static string BuildHttpErrorMessage(HttpResponseMessage response, string body)
        {
            var message = new StringBuilder()
                .Append("Desktop translation service returned ")
                .Append((int)response.StatusCode)
                .Append(' ')
                .Append(response.ReasonPhrase ?? "Unknown status");

            if (!string.IsNullOrWhiteSpace(body))
            {
                message.Append(": ").Append(body.Trim());
            }

            return message.ToString();
        }
    }

    internal class MemoQAIHubTranslateRequest
    {
        public string requestId { get; set; }
        public string traceId { get; set; }
        public string @interface { get; set; }
        public string pluginVersion { get; set; }
        public string contractVersion { get; set; }
        public string sourceLanguage { get; set; }
        public string targetLanguage { get; set; }
        public string requestType { get; set; }
        public Dictionary<string, object> metadata { get; set; }
        public MemoQAIHubProfileResolution profileResolution { get; set; }
        public List<MemoQAIHubSegment> segments { get; set; }
        public MemoQAIHubClientCapabilities capabilities { get; set; }
    }

    internal class MemoQAIHubClientCapabilities
    {
        public bool mtConfidenceInfo { get; set; }
    }

    internal class MemoQAIHubProfileResolution
    {
        public string useCase { get; set; }
        public string profileId { get; set; }
    }

    internal class MemoQAIHubSegment
    {
        public int index { get; set; }
        public string text { get; set; }
        public string plainText { get; set; }
        public string tmSource { get; set; }
        public string tmTarget { get; set; }
        public MemoQAIHubTmDiagnostics tmDiagnostics { get; set; }
    }

    internal class MemoQAIHubTmDiagnostics
    {
        public bool supportFuzzyForwarding { get; set; }
        public bool tmHintsRequested { get; set; }
        public bool tmSourcePresent { get; set; }
        public bool tmTargetPresent { get; set; }
    }

    internal class MemoQAIHubTranslateResponse
    {
        public bool success { get; set; }
        public string requestId { get; set; }
        public string traceId { get; set; }
        public string jobRequestId { get; set; }
        public string aggregationGroupId { get; set; }
        public bool pending { get; set; }
        public string providerId { get; set; }
        public string model { get; set; }
        public bool partial { get; set; }
        public MemoQAIHubError error { get; set; }
        public List<MemoQAIHubSegmentResult> translations { get; set; }
    }

    internal class MemoQAIHubAggregateSubmitResponse
    {
        public bool success { get; set; }
        public string requestId { get; set; }
        public string traceId { get; set; }
        public string jobRequestId { get; set; }
        public string aggregationGroupId { get; set; }
        public MemoQAIHubError error { get; set; }
    }

    internal class MemoQAIHubAggregateResultRequest
    {
        public string requestId { get; set; }
        public string traceId { get; set; }
        public string jobRequestId { get; set; }
        public string aggregationGroupId { get; set; }
        public int waitTimeoutMs { get; set; }
    }

    internal class MemoQAIHubStoreTranslationsRequest
    {
        public string requestId { get; set; }
        public string traceId { get; set; }
        public string contractVersion { get; set; }
        public string sourceLanguage { get; set; }
        public string targetLanguage { get; set; }
        public string requestType { get; set; }
        public List<MemoQAIHubStoredTranslation> translations { get; set; }
    }

    internal class MemoQAIHubStoredTranslation
    {
        public int index { get; set; }
        public string sourceText { get; set; }
        public string targetText { get; set; }
    }

    internal class MemoQAIHubStoreTranslationsResponse
    {
        public bool success { get; set; }
        public string requestId { get; set; }
        public string traceId { get; set; }
        public int storedCount { get; set; }
        public MemoQAIHubError error { get; set; }
    }

    internal class MemoQAIHubSegmentResult
    {
        public int index { get; set; }
        public string text { get; set; }
        public double confidence { get; set; }
        public string info { get; set; }
        public Dictionary<string, object> confidenceSignals { get; set; }
    }

    internal class MemoQAIHubError
    {
        public string code { get; set; }
        public string message { get; set; }
    }

    internal class MemoQAIHubDesktopVersionResponse
    {
        public string productName { get; set; }
        public string desktopVersion { get; set; }
        public string contractVersion { get; set; }
    }
}
