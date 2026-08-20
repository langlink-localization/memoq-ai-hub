const { buildWorkerForkOptions } = require('./workerLaunch');

const DEFAULT_BACKOFF_SCHEDULE_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const DEFAULT_STABLE_READY_MS = 60000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;
const SHUTDOWN_KILL_DELAY_MS = 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

function createWorkerError(serializedError, fallbackMessage = 'Desktop worker request failed.') {
  const error = new Error(String(serializedError?.message || fallbackMessage));
  error.code = serializedError?.code || '';
  error.statusCode = Number.isFinite(Number(serializedError?.statusCode)) ? Number(serializedError.statusCode) : 500;
  if (serializedError?.stack) {
    error.stack = serializedError.stack;
  }
  return error;
}

function describeWorkerExit(code, signal) {
  return signal
    ? `Desktop background worker stopped with signal ${signal}.`
    : `Desktop background worker exited with code ${code}.`;
}

function createWorkerSupervisor(options = {}) {
  const forkWorker = options.forkWorker || null;
  const workerPath = String(options.workerPath || '');
  const buildForkOptions = options.buildForkOptions || (() => buildWorkerForkOptions(process.env));
  const logger = options.logger || { info() {}, warn() {}, error() {} };
  const onStatusChange = options.onStatusChange || (() => {});
  const onStdout = options.onStdout || null;
  const onStderr = options.onStderr || null;
  const mainRequestHandler = options.mainRequestHandler || null;
  const timers = options.timers || {
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args)
  };
  const backoffScheduleMs = Array.isArray(options.backoffScheduleMs) && options.backoffScheduleMs.length
    ? options.backoffScheduleMs
    : DEFAULT_BACKOFF_SCHEDULE_MS;
  const stableReadyMs = Number.isFinite(Number(options.stableReadyMs)) ? Number(options.stableReadyMs) : DEFAULT_STABLE_READY_MS;
  const maxConsecutiveFailures = Number.isFinite(Number(options.maxConsecutiveFailures))
    ? Number(options.maxConsecutiveFailures)
    : DEFAULT_MAX_CONSECUTIVE_FAILURES;
  const defaultRequestTimeoutMs = Number.isFinite(Number(options.defaultRequestTimeoutMs))
    ? Number(options.defaultRequestTimeoutMs)
    : DEFAULT_REQUEST_TIMEOUT_MS;

  let worker = null;
  let workerGeneration = 0;
  let workerRequestId = 0;
  let quitting = false;
  let everStarted = false;
  let consecutiveFailures = 0;
  let respawnTimer = null;
  let stableTimer = null;
  let suppressNextExitFailure = false;
  let startupState = { status: 'starting', message: '' };
  const pendingWorkerRequests = new Map();

  function setStatus(status, message = '') {
    startupState = { status, message: String(message || '') };
    onStatusChange(startupState);
  }

  function getStartupState() {
    return startupState;
  }

  function sendToWorker(message) {
    try {
      worker?.send?.(message);
    } catch {
    }
  }

  function takePendingRequest(id) {
    const pending = pendingWorkerRequests.get(id);
    if (!pending) {
      return null;
    }
    pendingWorkerRequests.delete(id);
    timers.clearTimeout(pending.timer);
    return pending;
  }

  function rejectPendingRequests(serializedError) {
    const error = createWorkerError(serializedError, 'Desktop background worker stopped before replying.');
    for (const id of [...pendingWorkerRequests.keys()]) {
      const pending = takePendingRequest(id);
      if (!pending) {
        continue;
      }
      const { reject } = pending;
      reject(error);
    }
  }

  function clearRespawnTimer() {
    if (respawnTimer !== null) {
      timers.clearTimeout(respawnTimer);
      respawnTimer = null;
    }
  }

  function clearStableTimer() {
    if (stableTimer !== null) {
      timers.clearTimeout(stableTimer);
      stableTimer = null;
    }
  }

  function armStableTimer() {
    clearStableTimer();
    stableTimer = timers.setTimeout(() => {
      stableTimer = null;
      if (consecutiveFailures > 0) {
        consecutiveFailures = 0;
        logger.info('worker-stable', 'Desktop background worker stayed ready; failure backoff was reset.');
      }
    }, stableReadyMs);
  }

  function killWorker() {
    if (!worker) {
      return;
    }
    const exitingWorker = worker;
    if (exitingWorker.stdout) {
      exitingWorker.stdout.removeAllListeners();
    }
    if (exitingWorker.stderr) {
      exitingWorker.stderr.removeAllListeners();
    }
    try {
      exitingWorker.kill();
    } catch {
    }
  }

  function recordFailureAndScheduleRespawn(reason) {
    consecutiveFailures += 1;
    const attempt = consecutiveFailures;

    if (attempt > maxConsecutiveFailures) {
      const message = `${reason} The worker failed ${maxConsecutiveFailures} consecutive start attempts and will not restart automatically. Restart the app to try again.`;
      logger.error('worker-restart-gave-up', 'Desktop background worker exceeded the restart budget.', { reason, attempt });
      setStatus('error', message);
      if (worker) {
        suppressNextExitFailure = true;
        killWorker();
      }
      return;
    }

    const delayMs = backoffScheduleMs[Math.min(attempt - 1, backoffScheduleMs.length - 1)];
    const message = `${reason} Restarting desktop services (attempt ${attempt} of ${maxConsecutiveFailures}).`;
    logger.warn('worker-restart-scheduled', 'Desktop background worker will restart.', { reason, attempt, delayMs });
    setStatus('restarting', message);

    if (worker) {
      suppressNextExitFailure = true;
      killWorker();
    }

    clearRespawnTimer();
    respawnTimer = timers.setTimeout(() => {
      respawnTimer = null;
      if (!quitting) {
        spawnWorker();
      }
    }, delayMs);
  }

  function handleWorkerMessage(message) {
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'status') {
      const status = String(message.payload?.status || 'starting');
      if (status === 'ready') {
        armStableTimer();
        setStatus('ready');
        return;
      }
      if (status === 'error') {
        handleWorkerStartupError(String(message.payload?.message || 'Desktop services failed to start.'));
        return;
      }
      setStatus('starting');
      return;
    }

    if (message.type === 'main-request') {
      handleMainRequest(message);
      return;
    }

    if (message.type !== 'response') {
      return;
    }

    const pending = takePendingRequest(message.id);
    if (!pending) {
      return;
    }

    if (message.ok) {
      pending.resolve(message.result);
      return;
    }

    pending.reject(createWorkerError(message.error));
  }

  function handleMainRequest(message) {
    if (!mainRequestHandler) {
      sendToWorker({
        type: 'main-response',
        id: message.id,
        ok: false,
        error: { message: 'No main-process handler is available.' }
      });
      return;
    }

    Promise.resolve()
      .then(() => mainRequestHandler({ channel: message.channel, payload: message.payload }))
      .then((result) => {
        sendToWorker({ type: 'main-response', id: message.id, ok: true, result });
      })
      .catch((error) => {
        sendToWorker({
          type: 'main-response',
          id: message.id,
          ok: false,
          error: {
            message: String(error?.message || error || 'Main-process request failed.'),
            code: String(error?.code || ''),
            statusCode: Number.isFinite(Number(error?.statusCode)) ? Number(error.statusCode) : 500
          }
        });
      });
  }

  function handleWorkerStartupError(errorMessage) {
    if (quitting) {
      return;
    }
    logger.warn('worker-start-failed', 'Desktop background worker reported a startup failure.', { errorMessage });
    recordFailureAndScheduleRespawn(`Desktop services failed to start: ${errorMessage}`);
  }

  function handleWorkerExit(code, signal, exitedWorker) {
    worker = null;
    clearStableTimer();

    if (exitedWorker?.stdout) {
      exitedWorker.stdout.removeAllListeners();
    }
    if (exitedWorker?.stderr) {
      exitedWorker.stderr.removeAllListeners();
    }

    rejectPendingRequests({
      message: describeWorkerExit(code, signal),
      code: 'DESKTOP_WORKER_EXITED',
      statusCode: 500
    });
    logger.warn('worker-exit', 'Desktop background worker stopped.', { code, signal });

    if (quitting) {
      setStatus('stopped');
      return;
    }

    if (suppressNextExitFailure) {
      suppressNextExitFailure = false;
      return;
    }

    recordFailureAndScheduleRespawn(describeWorkerExit(code, signal));
  }

  function spawnWorker() {
    if (!forkWorker) {
      throw new Error('workerSupervisor requires a forkWorker implementation.');
    }

    workerGeneration += 1;
    const generation = workerGeneration;
    suppressNextExitFailure = false;
    everStarted = true;
    setStatus('starting');

    const spawned = forkWorker(workerPath, [], buildForkOptions());
    worker = spawned;
    logger.info('worker-start', 'Starting desktop background worker.', { generation });

    spawned.on('message', (message) => {
      if (generation === workerGeneration) {
        handleWorkerMessage(message);
      }
    });

    spawned.once('exit', (code, signal) => {
      if (generation === workerGeneration) {
        handleWorkerExit(code, signal, spawned);
      }
    });

    if (spawned.stdout && onStdout) {
      spawned.stdout.on('data', onStdout);
    }
    if (spawned.stderr && onStderr) {
      spawned.stderr.on('data', onStderr);
    }
  }

  function start() {
    if (quitting || worker || respawnTimer !== null) {
      return;
    }
    consecutiveFailures = 0;
    spawnWorker();
  }

  function invoke(channel, payload, requestOptions = {}) {
    if (!worker && !quitting && respawnTimer === null) {
      if (!everStarted) {
        start();
      }
    }

    if (!worker) {
      const state = startupState;
      const error = new Error(
        state.status === 'error'
          ? (state.message || 'Desktop services failed to start.')
          : (state.message || 'Desktop services are restarting.')
      );
      error.code = state.status === 'error' ? 'DESKTOP_WORKER_UNAVAILABLE' : 'DESKTOP_WORKER_RESTARTING';
      error.statusCode = 503;
      throw error;
    }

    const id = `worker_req_${Date.now()}_${workerRequestId += 1}`;
    const timeoutMs = Number.isFinite(Number(requestOptions.timeoutMs))
      ? Number(requestOptions.timeoutMs)
      : defaultRequestTimeoutMs;
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const timer = timers.setTimeout(() => {
        const pending = takePendingRequest(id);
        if (!pending) {
          return;
        }
        const elapsedMs = Date.now() - startedAt;
        const error = createWorkerError({
          message: `Desktop worker request timed out after ${timeoutMs} ms.`,
          code: 'DESKTOP_WORKER_REQUEST_TIMEOUT',
          statusCode: 504
        });
        logger.warn('worker-request-timeout', 'Desktop worker request timed out.', {
          channel,
          requestId: id,
          elapsedMs
        });
        pending.reject(error);
      }, timeoutMs);
      timer?.unref?.();
      pendingWorkerRequests.set(id, { resolve, reject, timer });

      try {
        worker.send({
          type: 'request',
          id,
          channel,
          payload
        });
      } catch (error) {
        takePendingRequest(id);
        reject(error);
      }
    });
  }

  function requestShutdown() {
    quitting = true;
    clearRespawnTimer();
    clearStableTimer();
    rejectPendingRequests({
      message: 'Desktop background worker is shutting down.',
      code: 'DESKTOP_WORKER_SHUTDOWN',
      statusCode: 503
    });

    if (!worker) {
      setStatus('stopped');
      return;
    }

    try {
      worker.send({
        type: 'request',
        id: `worker_shutdown_${Date.now()}`,
        channel: 'shutdown',
        payload: null
      });
    } catch {
    }

    const killTimer = timers.setTimeout(() => {
      if (worker) {
        killWorker();
      }
    }, SHUTDOWN_KILL_DELAY_MS);
    killTimer?.unref?.();
  }

  return {
    start,
    invoke,
    requestShutdown,
    getStartupState,
    isQuitting() {
      return quitting;
    }
  };
}

module.exports = {
  createWorkerSupervisor,
  DEFAULT_BACKOFF_SCHEDULE_MS,
  DEFAULT_STABLE_READY_MS,
  DEFAULT_MAX_CONSECUTIVE_FAILURES,
  DEFAULT_REQUEST_TIMEOUT_MS
};
