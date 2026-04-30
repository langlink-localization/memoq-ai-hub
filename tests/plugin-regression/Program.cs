using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Threading;
using MemoQ.Addins.Common.DataStructures;
using MemoQ.MTInterfaces;
using MemoQAIHubPlugin;

internal static class Program
{
    private static int Main()
    {
        try
        {
            RunEngineCapabilityScenario();
            RunPartialBatchRetryScenario();
            RunRequestTypeFallbackScenario();
            RunGatewayConcurrencyScenario();
            RunAggregateSubmitGateScenario();
            RunGatewayTimeoutConfigurationScenario();
            Console.WriteLine("Plugin regression passed: retry and fallback scenarios behaved as expected.");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            return 1;
        }
    }

    private static void RunEngineCapabilityScenario()
    {
        var engine = new MemoQAIHubEngine(
            "eng",
            "fra",
            new MemoQAIHubOptions(new MemoQAIHubGeneralSettings(), new MemoQAIHubSecureSettings())
        );

        Assert(engine.SupportsFuzzyCorrection, "Expected plugin engine to expose fuzzy correction capability.");
        Assert(engine.MaxDegreeOfParallelism == 8, "Expected plugin engine parallelism to preserve memoQ resource compatibility.");
    }

    private static void RunPartialBatchRetryScenario()
    {
        var requestBodies = new List<string>();
        RunScenario(
            "partial-batch-retry",
            new MemoQAIHubGeneralSettings
            {
                EnableGateway = true,
                GatewayTimeoutMs = 10000,
                FormattingAndTagUsage = FormattingAndTagsUsageOption.Plaintext
            },
            new[]
            {
                SegmentBuilder.CreateFromString("alpha"),
                SegmentBuilder.CreateFromString("beta"),
                SegmentBuilder.CreateFromString("gamma")
            },
            requestBody =>
            {
                lock (requestBodies)
                {
                    requestBodies.Add(requestBody);
                }

                var isBatchRequest = CountOccurrences(requestBody, "\"index\":") == 3;
                if (isBatchRequest)
                {
                    return "{\"success\":true,\"requestId\":\"batch-1\",\"traceId\":\"trace-batch-1\",\"providerId\":\"test-provider\",\"model\":\"test-model\",\"translations\":[{\"index\":0,\"text\":\"alpha translated\"},{\"index\":2,\"text\":\"gamma translated\"}]}";
                }

                return "{\"success\":true,\"requestId\":\"retry-1\",\"traceId\":\"trace-retry-1\",\"providerId\":\"test-provider\",\"model\":\"test-model\",\"translations\":[{\"index\":0,\"text\":\"beta translated\"}]}";
            },
            results =>
            {
                Assert(results.Length == 3, "Expected three translation results.");
                Assert(results[0].Exception == null && results[0].Translation.PlainText == "alpha translated", "Expected segment 0 batch success.");
                Assert(results[1].Exception == null && results[1].Translation.PlainText == "beta translated", "Expected segment 1 retry success.");
                Assert(results[2].Exception == null && results[2].Translation.PlainText == "gamma translated", "Expected segment 2 batch success.");
                Assert(requestBodies.Count == 2, "Expected one batch request and one single-segment retry request.");
            }
        );
    }

    private static void RunRequestTypeFallbackScenario()
    {
        var requestTypes = new List<string>();
        RunScenario(
            "request-type-fallback",
            new MemoQAIHubGeneralSettings
            {
                EnableGateway = true,
                GatewayTimeoutMs = 10000,
                FormattingAndTagUsage = FormattingAndTagsUsageOption.BothFormattingAndTags
            },
            new[]
            {
                CreateTaggedSegment("delta")
            },
            requestBody =>
            {
                var requestType = ExtractRequestType(requestBody);
                lock (requestTypes)
                {
                    requestTypes.Add(requestType);
                }

                switch (requestType)
                {
                    case "BothFormattingAndTags":
                        return "{\"success\":true,\"requestId\":\"fallback-1\",\"traceId\":\"trace-fallback-1\",\"providerId\":\"test-provider\",\"model\":\"test-model\",\"translations\":[{\"index\":0,\"text\":\"<span data-mqitag=\\\"99\\\">◿</span> broken\"}]}";
                    case "OnlyFormatting":
                        return "{\"success\":true,\"requestId\":\"fallback-2\",\"traceId\":\"trace-fallback-2\",\"providerId\":\"test-provider\",\"model\":\"test-model\",\"translations\":[{\"index\":0,\"text\":\"<span data-mqitag=\\\"99\\\">◿</span> still broken\"}]}";
                    case "Plaintext":
                        return "{\"success\":true,\"requestId\":\"fallback-3\",\"traceId\":\"trace-fallback-3\",\"providerId\":\"test-provider\",\"model\":\"test-model\",\"translations\":[{\"index\":0,\"text\":\"delta translated\"}]}";
                    default:
                        throw new InvalidOperationException("Unexpected request type: " + requestType);
                }
            },
            results =>
            {
                Assert(results.Length == 1, "Expected one translation result.");
                Assert(results[0].Exception == null, "Expected fallback chain to recover the failed segment.");
                Assert(results[0].Translation != null && results[0].Translation.PlainText.Contains("delta translated"), "Expected plaintext fallback translation to be applied.");
                Assert(results[0].Translation != null && CountInlineTags(results[0].Translation) == 1, "Expected fallback translation to preserve the original inline tag.");
                Assert(requestTypes.Count == 3, "Expected one initial request plus two fallback retries.");
                Assert(requestTypes[0] == "BothFormattingAndTags", "Expected initial request type to preserve tags.");
                Assert(requestTypes[1] == "OnlyFormatting", "Expected the first fallback request type to be OnlyFormatting.");
                Assert(requestTypes[2] == "Plaintext", "Expected final fallback request type to be Plaintext.");
            }
        );
    }

    private static void RunGatewayTimeoutConfigurationScenario()
    {
        var helperType = typeof(MemoQAIHubSession).Assembly.GetType("MemoQAIHubPlugin.MemoQAIHubServiceHelper");
        Assert(helperType != null, "Expected service helper type to exist.");

        var clientField = helperType.GetField("HttpClient", BindingFlags.NonPublic | BindingFlags.Static);
        Assert(clientField != null, "Expected service helper to expose a private HttpClient field.");
        var client = clientField.GetValue(null) as HttpClient;
        Assert(client != null, "Expected service helper HttpClient to be initialized.");
        Assert(client.Timeout == Timeout.InfiniteTimeSpan, "Expected HttpClient default timeout to be disabled.");

        var normalizeMethod = helperType.GetMethod("NormalizeTimeoutMs", BindingFlags.NonPublic | BindingFlags.Static);
        Assert(normalizeMethod != null, "Expected service helper timeout normalization method to exist.");
        Assert((int)normalizeMethod.Invoke(null, new object[] { 15000 }) == 120000, "Expected short saved gateway timeouts to be raised to 120 seconds.");
        Assert((int)normalizeMethod.Invoke(null, new object[] { 360000 }) == 360000, "Expected explicit longer gateway timeouts to be preserved.");
    }

    private static void RunGatewayConcurrencyScenario()
    {
        var listener = new HttpListener();
        var port = GetFreeTcpPort();
        var prefix = $"http://127.0.0.1:{port}/";
        listener.Prefixes.Add(prefix);
        listener.Start();

        var activeRequests = 0;
        var maxActiveRequests = 0;
        var servedRequests = 0;
        var serverDone = new ManualResetEventSlim(false);
        Exception serverError = null;
        var serverThread = new Thread(() =>
        {
            try
            {
                while (listener.IsListening)
                {
                    HttpListenerContext context;
                    try
                    {
                        context = listener.GetContext();
                    }
                    catch (HttpListenerException)
                    {
                        return;
                    }
                    catch (ObjectDisposedException)
                    {
                        return;
                    }

                    ThreadPool.QueueUserWorkItem(_ =>
                    {
                        try
                        {
                            using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding))
                            {
                                reader.ReadToEnd();
                            }

                            var currentActive = Interlocked.Increment(ref activeRequests);
                            UpdateMax(ref maxActiveRequests, currentActive);
                            Thread.Sleep(250);

                            var responseBody = "{\"success\":true,\"requestId\":\"gate\",\"traceId\":\"gate-trace\",\"providerId\":\"test-provider\",\"model\":\"test-model\",\"translations\":[{\"index\":0,\"text\":\"ok\"}]}";
                            var payload = Encoding.UTF8.GetBytes(responseBody);
                            context.Response.StatusCode = 200;
                            context.Response.ContentType = "application/json";
                            context.Response.ContentEncoding = Encoding.UTF8;
                            context.Response.ContentLength64 = payload.Length;
                            context.Response.OutputStream.Write(payload, 0, payload.Length);
                            context.Response.OutputStream.Close();
                        }
                        catch (Exception error)
                        {
                            serverError = error;
                        }
                        finally
                        {
                            Interlocked.Decrement(ref activeRequests);
                            if (Interlocked.Increment(ref servedRequests) == 6)
                            {
                                serverDone.Set();
                            }
                        }
                    });
                }
            }
            catch (Exception error)
            {
                serverError = error;
            }
        });
        serverThread.IsBackground = true;
        serverThread.Start();

        var settings = new MemoQAIHubGeneralSettings
        {
            EnableGateway = true,
            GatewayBaseUrl = prefix.TrimEnd('/'),
            GatewayTimeoutMs = 10000,
            FormattingAndTagUsage = FormattingAndTagsUsageOption.Plaintext
        };
        var session = new MemoQAIHubSession(
            "zho",
            "eng",
            new MemoQAIHubOptions(settings, new MemoQAIHubSecureSettings())
        );
        var start = new ManualResetEventSlim(false);
        var workers = Enumerable.Range(0, 6)
            .Select(index => new Thread(() =>
            {
                start.Wait();
                var results = session.TranslateCorrectSegment(
                    segs: new[] { SegmentBuilder.CreateFromString("segment " + index) },
                    tmSources: null,
                    tmTargets: null
                );
                Assert(results.Length == 1, "Expected one result from concurrency scenario.");
                Assert(results[0].Exception == null, "Expected gated request to succeed.");
                Assert(results[0].Translation.PlainText == "ok", "Expected gated request translation text.");
            }))
            .ToArray();

        try
        {
            foreach (var worker in workers)
            {
                worker.IsBackground = true;
                worker.Start();
            }

            start.Set();
            foreach (var worker in workers)
            {
                Assert(worker.Join(TimeSpan.FromSeconds(10)), "Expected gated translation worker to finish.");
            }

            Assert(serverDone.Wait(TimeSpan.FromSeconds(2)), "Expected test server to receive all gated requests.");
            Assert(serverError == null, $"Gateway concurrency server failed: {serverError}");
            Assert(maxActiveRequests <= 2, $"Expected at most 2 concurrent desktop gateway requests, saw {maxActiveRequests}.");
        }
        finally
        {
            if (listener.IsListening)
            {
                listener.Stop();
            }

            listener.Close();
            serverThread.Join(TimeSpan.FromSeconds(2));
        }
    }

    private static void RunAggregateSubmitGateScenario()
    {
        var listener = new HttpListener();
        var port = GetFreeTcpPort();
        var prefix = $"http://127.0.0.1:{port}/";
        listener.Prefixes.Add(prefix);
        listener.Start();

        var activeSubmits = 0;
        var maxActiveSubmits = 0;
        var activeWaits = 0;
        var maxActiveWaits = 0;
        var submitCount = 0;
        var waitCount = 0;
        var completedWaitCount = 0;
        var resultAttempts = new ConcurrentDictionary<string, int>();
        var serverDone = new ManualResetEventSlim(false);
        Exception serverError = null;
        var serverThread = new Thread(() =>
        {
            try
            {
                while (listener.IsListening)
                {
                    HttpListenerContext context;
                    try
                    {
                        context = listener.GetContext();
                    }
                    catch (HttpListenerException)
                    {
                        return;
                    }
                    catch (ObjectDisposedException)
                    {
                        return;
                    }

                    ThreadPool.QueueUserWorkItem(_ =>
                    {
                        try
                        {
                            string requestBody;
                            using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding))
                            {
                                requestBody = reader.ReadToEnd();
                            }

                            var path = context.Request.Url.AbsolutePath;
                            string responseBody;
                            if (path == "/mt/translate-aggregate")
                            {
                                var currentActive = Interlocked.Increment(ref activeSubmits);
                                UpdateMax(ref maxActiveSubmits, currentActive);
                                Thread.Sleep(250);
                                var requestId = ExtractJsonString(requestBody, "requestId");
                                responseBody = "{\"success\":true,\"requestId\":\"" + requestId + "\",\"traceId\":\"trace\",\"jobRequestId\":\"" + requestId + "\",\"aggregationGroupId\":\"group-1\"}";
                                Interlocked.Decrement(ref activeSubmits);
                                Interlocked.Increment(ref submitCount);
                            }
                            else if (path == "/mt/translate-aggregate/result")
                            {
                                var currentActive = Interlocked.Increment(ref activeWaits);
                                UpdateMax(ref maxActiveWaits, currentActive);
                                Thread.Sleep(500);
                                var jobRequestId = ExtractJsonString(requestBody, "jobRequestId");
                                var attempt = resultAttempts.AddOrUpdate(jobRequestId, 1, (_, current) => current + 1);
                                if (attempt == 1)
                                {
                                    responseBody = "{\"success\":false,\"pending\":true,\"requestId\":\"" + jobRequestId + "\",\"traceId\":\"trace\",\"jobRequestId\":\"" + jobRequestId + "\",\"aggregationGroupId\":\"group-1\",\"error\":{\"code\":\"TRANSLATION_PENDING\",\"message\":\"Aggregated translation is still pending.\"},\"translations\":[]}";
                                }
                                else
                                {
                                    responseBody = "{\"success\":true,\"requestId\":\"" + jobRequestId + "\",\"traceId\":\"trace\",\"jobRequestId\":\"" + jobRequestId + "\",\"aggregationGroupId\":\"group-1\",\"providerId\":\"test-provider\",\"model\":\"test-model\",\"translations\":[{\"index\":0,\"text\":\"ok 0\"},{\"index\":1,\"text\":\"ok 1\"}]}";
                                    if (Interlocked.Increment(ref completedWaitCount) == 8)
                                    {
                                        serverDone.Set();
                                    }
                                }
                                Interlocked.Decrement(ref activeWaits);
                                Interlocked.Increment(ref waitCount);
                            }
                            else
                            {
                                throw new InvalidOperationException("Unexpected aggregate gate path: " + path);
                            }

                            var payload = Encoding.UTF8.GetBytes(responseBody);
                            context.Response.StatusCode = 200;
                            context.Response.ContentType = "application/json";
                            context.Response.ContentEncoding = Encoding.UTF8;
                            context.Response.ContentLength64 = payload.Length;
                            context.Response.OutputStream.Write(payload, 0, payload.Length);
                            context.Response.OutputStream.Close();
                        }
                        catch (Exception error)
                        {
                            serverError = error;
                        }
                    });
                }
            }
            catch (Exception error)
            {
                serverError = error;
            }
        });
        serverThread.IsBackground = true;
        serverThread.Start();

        var settings = new MemoQAIHubGeneralSettings
        {
            EnableGateway = true,
            GatewayBaseUrl = prefix.TrimEnd('/'),
            GatewayTimeoutMs = 10000,
            FormattingAndTagUsage = FormattingAndTagsUsageOption.Plaintext
        };
        var session = new MemoQAIHubSession(
            "zho",
            "eng",
            new MemoQAIHubOptions(settings, new MemoQAIHubSecureSettings())
        );
        var start = new ManualResetEventSlim(false);
        var workers = Enumerable.Range(0, 8)
            .Select(index => new Thread(() =>
            {
                start.Wait();
                var metadata = CreateMetadata(2);
                var results = session.TranslateCorrectSegment(
                    segs: new[]
                    {
                        SegmentBuilder.CreateFromString("segment " + index + ".0"),
                        SegmentBuilder.CreateFromString("segment " + index + ".1")
                    },
                    tmSources: null,
                    tmTargets: null,
                    metadata: metadata
                );
                Assert(results.Length == 2, "Expected two results from aggregate gate scenario.");
                Assert(results[0].Exception == null && results[0].Translation.PlainText == "ok 0", "Expected aggregate result 0.");
                Assert(results[1].Exception == null && results[1].Translation.PlainText == "ok 1", "Expected aggregate result 1.");
            }))
            .ToArray();

        try
        {
            foreach (var worker in workers)
            {
                worker.IsBackground = true;
                worker.Start();
            }

            start.Set();
            foreach (var worker in workers)
            {
                Assert(worker.Join(TimeSpan.FromSeconds(15)), "Expected aggregate gate worker to finish.");
            }

            Assert(serverDone.Wait(TimeSpan.FromSeconds(2)), "Expected test server to receive all aggregate waits.");
            Assert(serverError == null, $"Aggregate gate server failed: {serverError}");
            Assert(submitCount == 8, $"Expected 8 aggregate submit calls, saw {submitCount}.");
            Assert(waitCount == 16, $"Expected 16 aggregate wait calls after pending polling, saw {waitCount}.");
            Assert(maxActiveSubmits <= 4, $"Expected at most 4 concurrent aggregate submits, saw {maxActiveSubmits}.");
            Assert(maxActiveWaits > 4, $"Expected result waits not to consume submit gate, saw only {maxActiveWaits} active waits.");
        }
        finally
        {
            if (listener.IsListening)
            {
                listener.Stop();
            }

            listener.Close();
            serverThread.Join(TimeSpan.FromSeconds(2));
        }
    }

    private static void RunScenario(
        string scenarioName,
        MemoQAIHubGeneralSettings settings,
        Segment[] segments,
        Func<string, string> responder,
        Action<TranslationResult[]> assertResults)
    {
        var listener = new HttpListener();
        var port = GetFreeTcpPort();
        var prefix = $"http://127.0.0.1:{port}/";
        settings.GatewayBaseUrl = prefix.TrimEnd('/');
        listener.Prefixes.Add(prefix);
        listener.Start();

        Exception serverError = null;
        var serverThread = new Thread(() => ServeRequests(listener, responder, ref serverError));
        serverThread.IsBackground = true;
        serverThread.Start();

        try
        {
            var session = new MemoQAIHubSession(
                "zho",
                "eng",
                new MemoQAIHubOptions(settings, new MemoQAIHubSecureSettings())
            );

            var results = session.TranslateCorrectSegment(segs: segments, tmSources: null, tmTargets: null);
            Assert(serverError == null, $"Scenario '{scenarioName}' server failed: {serverError}");
            assertResults(results);
        }
        finally
        {
            if (listener.IsListening)
            {
                listener.Stop();
            }

            listener.Close();
            serverThread.Join(TimeSpan.FromSeconds(2));
        }
    }

    private static void ServeRequests(HttpListener listener, Func<string, string> responder, ref Exception serverError)
    {
        try
        {
            while (listener.IsListening)
            {
                HttpListenerContext context;
                try
                {
                    context = listener.GetContext();
                }
                catch (HttpListenerException)
                {
                    return;
                }
                catch (ObjectDisposedException)
                {
                    return;
                }

                using (var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding))
                {
                    var requestBody = reader.ReadToEnd();
                    if (string.IsNullOrWhiteSpace(requestBody))
                    {
                        throw new InvalidOperationException("Expected a request body.");
                    }

                    var responseBody = responder(requestBody);
                    var payload = Encoding.UTF8.GetBytes(responseBody);
                    context.Response.StatusCode = 200;
                    context.Response.ContentType = "application/json";
                    context.Response.ContentEncoding = Encoding.UTF8;
                    context.Response.ContentLength64 = payload.Length;
                    context.Response.OutputStream.Write(payload, 0, payload.Length);
                    context.Response.OutputStream.Close();
                }
            }
        }
        catch (Exception error)
        {
            serverError = error;
        }
    }

    private static string ExtractRequestType(string requestBody)
    {
        return ExtractJsonString(requestBody, "requestType");
    }

    private static string ExtractJsonString(string requestBody, string propertyName)
    {
        var marker = "\"" + propertyName + "\":\"";
        var markerIndex = requestBody.IndexOf(marker, StringComparison.Ordinal);
        if (markerIndex < 0)
        {
            throw new InvalidOperationException(propertyName + " missing from request body.");
        }

        var startIndex = markerIndex + marker.Length;
        var endIndex = requestBody.IndexOf('"', startIndex);
        if (endIndex < 0)
        {
            throw new InvalidOperationException(propertyName + " terminator missing from request body.");
        }

        return requestBody.Substring(startIndex, endIndex - startIndex);
    }

    private static int CountOccurrences(string value, string pattern)
    {
        var count = 0;
        var index = 0;
        while ((index = value.IndexOf(pattern, index, StringComparison.Ordinal)) >= 0)
        {
            count += 1;
            index += pattern.Length;
        }

        return count;
    }

    private static void UpdateMax(ref int target, int value)
    {
        while (true)
        {
            var current = target;
            if (value <= current)
            {
                return;
            }

            if (Interlocked.CompareExchange(ref target, value, current) == current)
            {
                return;
            }
        }
    }

    private static Segment CreateTaggedSegment(string text)
    {
        var builder = new SegmentBuilder();
        builder.AppendSegment(SegmentBuilder.CreateFromString(text));
        builder.AppendInlineTag(new InlineTag(InlineTagTypes.Empty, "ph", null));
        return builder.ToSegment();
    }

    private static MTRequestMetadata CreateMetadata(int segmentCount)
    {
        var metadata = new MTRequestMetadata
        {
            DocumentID = Guid.Parse("11111111-1111-1111-1111-111111111111"),
            ProjectGuid = Guid.Parse("22222222-2222-2222-2222-222222222222"),
            SegmentLevelMetadata = new List<SegmentMetadata>()
        };

        for (var index = 0; index < segmentCount; index += 1)
        {
            metadata.SegmentLevelMetadata.Add(new SegmentMetadata
            {
                SegmentID = Guid.NewGuid(),
                SegmentIndex = index,
                SegmentStatus = 0
            });
        }

        return metadata;
    }

    private static int CountInlineTags(Segment segment)
    {
        var count = 0;
        foreach (var _ in segment.ITags)
        {
            count += 1;
        }

        return count;
    }

    private static int GetFreeTcpPort()
    {
        var listener = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException(message);
        }
    }
}
