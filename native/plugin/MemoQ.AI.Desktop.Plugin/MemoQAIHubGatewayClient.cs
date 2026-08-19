using System;
using System.Diagnostics;
using System.Threading;

namespace MemoQAIHubPlugin
{
    internal sealed class MemoQAIHubGatewayClient
    {
        private const int DirectConcurrency = 2;
        private const int SubmitConcurrency = 4;
        private const int MinimumTimeoutMs = 120000;
        private const int AggregateResultPollWaitMs = 25000;
        private const int AggregateResultPollDelayMs = 250;
        private const int AggregateResultTimeoutSafetyMs = 15000;
        private static readonly SemaphoreSlim DirectGate = new SemaphoreSlim(DirectConcurrency, DirectConcurrency);
        private static readonly SemaphoreSlim SubmitGate = new SemaphoreSlim(SubmitConcurrency, SubmitConcurrency);

        private readonly string _baseUrl;
        private readonly int _timeoutMs;
        private readonly Action<string> _log;

        public MemoQAIHubGatewayClient(string baseUrl, int timeoutMs, Action<string> log)
        {
            _baseUrl = baseUrl;
            _timeoutMs = timeoutMs;
            _log = log ?? (_ => { });
        }

        public MemoQAIHubTranslateResponse Translate(
            MemoQAIHubTranslateRequest request,
            string formattingMode,
            int segmentCount,
            string stage = "batch",
            int? originalIndex = null)
        {
            if (ShouldUseAggregateRequest(request, stage, segmentCount))
            {
                try
                {
                    return SendAggregateTranslateRequest(request, formattingMode, segmentCount, stage, originalIndex);
                }
                catch (Exception error) when (error is NotSupportedException)
                {
                    _log(
                        $"Translate aggregate unavailable stage={stage} mode={formattingMode} segments={segmentCount} requestId={request.requestId} traceId={request.traceId} fallback=direct error={error.Message}"
                    );
                }
            }

            return SendDirectTranslateRequest(request, formattingMode, segmentCount, stage, originalIndex);
        }

        private static bool ShouldUseAggregateRequest(MemoQAIHubTranslateRequest request, string stage, int segmentCount)
        {
            if (!string.Equals(stage, "batch", StringComparison.OrdinalIgnoreCase) || segmentCount <= 1)
            {
                return false;
            }

            if (request?.metadata == null)
            {
                return false;
            }

            var documentId = request.metadata.ContainsKey("documentId") ? request.metadata["documentId"] as string : string.Empty;
            var projectGuid = request.metadata.ContainsKey("projectGuid") ? request.metadata["projectGuid"] as string : string.Empty;
            return !string.IsNullOrWhiteSpace(documentId) || !string.IsNullOrWhiteSpace(projectGuid);
        }

        private MemoQAIHubTranslateResponse SendAggregateTranslateRequest(
            MemoQAIHubTranslateRequest request,
            string formattingMode,
            int segmentCount,
            string stage,
            int? originalIndex)
        {
            var submitTimer = Stopwatch.StartNew();
            SubmitGate.Wait();
            submitTimer.Stop();
            var submitQueuedMs = submitTimer.ElapsedMilliseconds;
            var originalIndexText = originalIndex.HasValue ? $" originalIndex={originalIndex.Value}" : string.Empty;

            MemoQAIHubAggregateSubmitResponse submitResponse;
            try
            {
                submitResponse = MemoQAIHubServiceHelper.SubmitAggregateTranslation(_baseUrl, _timeoutMs, request);
            }
            catch (Exception error)
            {
                throw new NotSupportedException("Aggregate translation submit failed.", error);
            }
            finally
            {
                SubmitGate.Release();
            }

            if (submitResponse == null || !submitResponse.success || string.IsNullOrWhiteSpace(submitResponse.jobRequestId))
            {
                throw new NotSupportedException(submitResponse?.error?.message ?? "Aggregate translation submit returned an invalid response.");
            }

            _log(
                $"Translate aggregate submitted stage={stage} mode={formattingMode} segments={segmentCount}{originalIndexText} requestId={request.requestId} traceId={request.traceId} jobRequestId={submitResponse.jobRequestId} aggregationGroupId={submitResponse.aggregationGroupId ?? string.Empty} submitQueuedMs={submitQueuedMs}"
            );

            var waitTimer = Stopwatch.StartNew();
            var pendingAttempts = 0;
            try
            {
                var overallWaitBudgetMs = Math.Max(1, NormalizeTimeoutMs(_timeoutMs) - AggregateResultTimeoutSafetyMs);
                while (true)
                {
                    var remainingMs = overallWaitBudgetMs - waitTimer.ElapsedMilliseconds;
                    if (remainingMs <= 0)
                    {
                        throw new TimeoutException("Aggregate translation result remained pending after " + waitTimer.ElapsedMilliseconds + " ms.");
                    }

                    var pollWaitMs = (int)Math.Min(AggregateResultPollWaitMs, remainingMs);
                    var response = MemoQAIHubServiceHelper.WaitAggregateTranslation(
                        _baseUrl,
                        _timeoutMs,
                        new MemoQAIHubAggregateResultRequest
                        {
                            requestId = request.requestId,
                            traceId = request.traceId,
                            jobRequestId = submitResponse.jobRequestId,
                            aggregationGroupId = submitResponse.aggregationGroupId,
                            waitTimeoutMs = pollWaitMs
                        }
                    );

                    if (response != null && response.pending)
                    {
                        pendingAttempts += 1;
                        _log(
                            $"Translate aggregate pending stage={stage} mode={formattingMode} segments={segmentCount}{originalIndexText} requestId={request.requestId} traceId={request.traceId} jobRequestId={submitResponse.jobRequestId} aggregationGroupId={submitResponse.aggregationGroupId ?? string.Empty} submitQueuedMs={submitQueuedMs} resultWaitMs={waitTimer.ElapsedMilliseconds} pendingAttempt={pendingAttempts} pollWaitMs={pollWaitMs}"
                        );
                        var delayMs = (int)Math.Min(AggregateResultPollDelayMs, Math.Max(0, overallWaitBudgetMs - waitTimer.ElapsedMilliseconds));
                        if (delayMs > 0)
                        {
                            Thread.Sleep(delayMs);
                        }
                        continue;
                    }

                    waitTimer.Stop();
                    _log(
                        $"Translate aggregate result stage={stage} mode={formattingMode} segments={segmentCount}{originalIndexText} requestId={request.requestId} traceId={request.traceId} jobRequestId={submitResponse.jobRequestId} aggregationGroupId={submitResponse.aggregationGroupId ?? string.Empty} submitQueuedMs={submitQueuedMs} resultWaitMs={waitTimer.ElapsedMilliseconds} pendingAttempts={pendingAttempts}"
                    );
                    return response;
                }
            }
            catch (Exception error)
            {
                waitTimer.Stop();
                _log(
                    $"Translate aggregate failed stage={stage} mode={formattingMode} segments={segmentCount}{originalIndexText} requestId={request.requestId} traceId={request.traceId} jobRequestId={submitResponse.jobRequestId} aggregationGroupId={submitResponse.aggregationGroupId ?? string.Empty} submitQueuedMs={submitQueuedMs} resultWaitMs={waitTimer.ElapsedMilliseconds} pendingAttempts={pendingAttempts} error={error.Message}"
                );
                throw;
            }
        }

        private MemoQAIHubTranslateResponse SendDirectTranslateRequest(
            MemoQAIHubTranslateRequest request,
            string formattingMode,
            int segmentCount,
            string stage,
            int? originalIndex)
        {
            var queueTimer = Stopwatch.StartNew();
            DirectGate.Wait();
            queueTimer.Stop();
            var gatewayQueuedMs = queueTimer.ElapsedMilliseconds;
            var originalIndexText = originalIndex.HasValue ? $" originalIndex={originalIndex.Value}" : string.Empty;

            _log(
                $"Translate request start stage={stage} mode={formattingMode} segments={segmentCount}{originalIndexText} requestId={request.requestId} traceId={request.traceId} gatewayQueuedMs={gatewayQueuedMs}"
            );

            try
            {
                return MemoQAIHubServiceHelper.Translate(_baseUrl, _timeoutMs, request);
            }
            catch (Exception error)
            {
                _log(
                    $"Translate failed stage={stage} mode={formattingMode} segments={segmentCount}{originalIndexText} requestId={request.requestId} traceId={request.traceId} gatewayQueuedMs={gatewayQueuedMs} error={error.Message}"
                );
                throw;
            }
            finally
            {
                DirectGate.Release();
            }
        }

        private static int NormalizeTimeoutMs(int timeoutMs)
        {
            return timeoutMs >= MinimumTimeoutMs ? timeoutMs : MinimumTimeoutMs;
        }
    }
}
