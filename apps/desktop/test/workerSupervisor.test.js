const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const {
  createWorkerSupervisor,
  DEFAULT_BACKOFF_SCHEDULE_MS,
  DEFAULT_MAX_CONSECUTIVE_FAILURES,
  DEFAULT_REQUEST_TIMEOUT_MS
} = require('../src/workerSupervisor');

function createFakeTimers() {
  const tasks = new Map();
  let sequence = 0;

  return {
    setTimeout(fn, delayMs) {
      sequence += 1;
      tasks.set(sequence, { fn, delayMs: Number(delayMs) });
      return sequence;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    fireFirst() {
      const entry = [...tasks.entries()][0];
      if (!entry) {
        return null;
      }
      const [id, task] = entry;
      tasks.delete(id);
      task.fn();
      return task.delayMs;
    },
    fireByDelay(delayMs) {
      const entry = [...tasks.entries()].find(([, task]) => task.delayMs === delayMs);
      if (!entry) {
        return false;
      }
      const [id, task] = entry;
      tasks.delete(id);
      task.fn();
      return true;
    },
    firstDelayMs() {
      const first = [...tasks.values()][0];
      return first ? first.delayMs : null;
    },
    pendingCount() {
      return tasks.size;
    }
  };
}

function createFakeWorker() {
  const worker = new EventEmitter();
  worker.sent = [];
  worker.send = (message) => {
    worker.sent.push(message);
  };
  worker.kill = () => {
    worker.killed = true;
  };
  return worker;
}

function createHarness(overrides = {}) {
  const timers = createFakeTimers();
  const spawned = [];
  const statuses = [];
  const logs = [];

  const supervisor = createWorkerSupervisor({
    workerPath: 'background-worker-stub.js',
    forkWorker: () => {
      const worker = createFakeWorker();
      spawned.push(worker);
      return worker;
    },
    timers,
    onStatusChange(state) {
      statuses.push({ ...state });
    },
    logger: {
      info(event, message, metadata) { logs.push({ level: 'info', event, message, metadata }); },
      warn(event, message, metadata) { logs.push({ level: 'warn', event, message, metadata }); },
      error(event, message, metadata) { logs.push({ level: 'error', event, message, metadata }); }
    },
    ...overrides
  });

  return { supervisor, timers, spawned, statuses, logs };
}

function emitStatus(worker, status, message = '') {
  worker.emit('message', { type: 'status', payload: { status, message } });
}

test('worker supervisor tracks starting and ready states', () => {
  const { supervisor, spawned, statuses } = createHarness();

  supervisor.start();
  emitStatus(spawned[0], 'ready');

  assert.equal(supervisor.getStartupState().status, 'ready');
  assert.ok(statuses.some((state) => state.status === 'starting'));
  assert.ok(statuses.some((state) => state.status === 'ready'));
});

test('unexpected worker exit rejects pending requests and schedules a backoff respawn', async () => {
  const { supervisor, timers, spawned, statuses } = createHarness();

  supervisor.start();
  const pending = supervisor.invoke('getAppState', {});
  spawned[0].emit('exit', 1, null);

  await assert.rejects(
    () => pending,
    (error) => error.code === 'DESKTOP_WORKER_EXITED'
  );

  const restarting = statuses.find((state) => state.status === 'restarting');
  assert.ok(restarting, 'expected a restarting status after worker exit');
  assert.match(restarting.message, /attempt 1/i);
  assert.equal(timers.firstDelayMs(), DEFAULT_BACKOFF_SCHEDULE_MS[0]);

  timers.fireFirst();
  assert.equal(spawned.length, 2, 'respawn should fork a new worker');
  assert.equal(supervisor.getStartupState().status, 'starting');
});

test('consecutive failures escalate backoff and stop after the restart budget', () => {
  const { supervisor, timers, spawned, statuses } = createHarness({ backoffScheduleMs: [10, 20, 40] });

  supervisor.start();

  for (let attempt = 1; attempt <= DEFAULT_MAX_CONSECUTIVE_FAILURES; attempt += 1) {
    const current = spawned[spawned.length - 1];
    current.emit('exit', 1, null);
    assert.ok(timers.pendingCount() >= 1, `respawn timer expected after failure ${attempt}`);
    timers.fireFirst();
  }

  assert.equal(spawned.length, DEFAULT_MAX_CONSECUTIVE_FAILURES + 1);

  const terminal = spawned[spawned.length - 1];
  terminal.emit('exit', 1, null);

  const errorState = statuses.find((state) => state.status === 'error');
  assert.ok(errorState, 'terminal error state expected after exhausting the restart budget');
  assert.match(errorState.message, /will not restart automatically/i);
  assert.equal(timers.pendingCount(), 0, 'no further respawn should be scheduled');
});

test('a stable ready window resets the failure backoff', () => {
  const { supervisor, timers, spawned, statuses } = createHarness({ backoffScheduleMs: [10, 20, 40], stableReadyMs: 5000 });

  supervisor.start();
  spawned[0].emit('exit', 1, null);
  assert.equal(timers.firstDelayMs(), 10);
  timers.fireFirst();

  emitStatus(spawned[1], 'ready');
  // Fire the stable timer first so the failure budget resets before the next crash.
  timers.fireFirst();

  spawned[1].emit('exit', 1, null);
  const restarting = statuses.filter((state) => state.status === 'restarting');
  assert.match(restarting[restarting.length - 1].message, /attempt 1/i, 'failure count should reset after a stable window');
  assert.equal(timers.firstDelayMs(), 10);
});

test('worker-reported startup failures respawn without double counting after the kill', () => {
  const { supervisor, timers, spawned, statuses } = createHarness({ backoffScheduleMs: [10, 20, 40] });

  supervisor.start();
  emitStatus(spawned[0], 'error', 'port already in use');

  assert.ok(spawned[0].killed, 'failed worker should be killed');
  const restarting = statuses.find((state) => state.status === 'restarting');
  assert.match(restarting.message, /port already in use/i);
  assert.equal(timers.pendingCount(), 1);

  // The intentional kill emits an exit that must not schedule a second respawn.
  spawned[0].emit('exit', 0, null);
  assert.equal(timers.pendingCount(), 1, 'exit after an intentional kill must not schedule another respawn');

  timers.fireFirst();
  assert.equal(spawned.length, 2);
  emitStatus(spawned[1], 'ready');
  assert.equal(supervisor.getStartupState().status, 'ready');
});

test('requestShutdown stops supervision and further respawns', () => {
  const { supervisor, timers, spawned } = createHarness({ backoffScheduleMs: [10, 20, 40] });

  supervisor.start();
  supervisor.requestShutdown();

  assert.equal(supervisor.isQuitting(), true);
  assert.equal(timers.pendingCount(), 1, 'a kill timer should be pending after shutdown request');

  // The graceful shutdown message goes to the worker, and later timers must not respawn.
  const shutdownMessage = spawned[0].sent.find((message) => message.channel === 'shutdown');
  assert.ok(shutdownMessage, 'shutdown channel should be sent to the worker');

  timers.fireFirst();
  spawned[0].emit('exit', 0, null);

  assert.equal(spawned.length, 1, 'no respawn should happen after shutdown');
  assert.equal(supervisor.getStartupState().status, 'stopped');
});

test('invoke resolves and rejects worker responses', async () => {
  const { supervisor, spawned, timers } = createHarness();

  supervisor.start();
  const worker = spawned[0];

  const pendingResult = supervisor.invoke('getAppState', { filters: {} });
  const request = worker.sent.find((message) => message.type === 'request');
  assert.equal(request.channel, 'getAppState');

  worker.emit('message', { type: 'response', id: request.id, ok: true, result: { ok: true } });
  assert.deepEqual(await pendingResult, { ok: true });
  assert.equal(timers.pendingCount(), 0, 'successful response should clear its deadline');

  const pendingFailure = supervisor.invoke('deleteProfile', 'p1');
  const failingRequest = worker.sent.find((message) => message.type === 'request' && message.id !== request.id);
  worker.emit('message', {
    type: 'response',
    id: failingRequest.id,
    ok: false,
    error: { message: 'nope', code: 'X', statusCode: 409 }
  });

  await assert.rejects(
    () => pendingFailure,
    (error) => error.message === 'nope' && error.code === 'X' && error.statusCode === 409
  );
  assert.equal(timers.pendingCount(), 0, 'failed response should clear its deadline');
});

test('invoke times out with a 504, ignores late responses, and does not restart the worker', async () => {
  const { supervisor, spawned, timers, statuses, logs } = createHarness();
  const payload = { apiKey: 'must-not-be-logged' };

  supervisor.start();
  const pending = supervisor.invoke('testProvider', payload, { timeoutMs: 135000 });
  const request = spawned[0].sent.find((message) => message.type === 'request');

  assert.equal(timers.fireByDelay(135000), true);
  await assert.rejects(
    () => pending,
    (error) => error.code === 'DESKTOP_WORKER_REQUEST_TIMEOUT' && error.statusCode === 504
  );
  assert.equal(timers.pendingCount(), 0);
  assert.equal(spawned.length, 1);
  assert.equal(statuses.some((state) => state.status === 'restarting'), false);

  spawned[0].emit('message', { type: 'response', id: request.id, ok: true, result: { late: true } });
  assert.equal(timers.pendingCount(), 0);

  const timeoutLog = logs.find((entry) => entry.event === 'worker-request-timeout');
  assert.equal(timeoutLog.metadata.channel, 'testProvider');
  assert.equal(timeoutLog.metadata.requestId, request.id);
  assert.equal(JSON.stringify(timeoutLog).includes(payload.apiKey), false);
});

test('invoke uses the default deadline and clears it when sending fails', async () => {
  const { supervisor, spawned, timers } = createHarness();
  supervisor.start();
  spawned[0].send = () => { throw new Error('send failed'); };

  const pending = supervisor.invoke('getAppState', {});
  await assert.rejects(() => pending, /send failed/);
  assert.equal(timers.pendingCount(), 0);

  spawned[0].send = (message) => spawned[0].sent.push(message);
  const timed = supervisor.invoke('getAppState', {});
  assert.equal(timers.firstDelayMs(), DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(timers.fireByDelay(DEFAULT_REQUEST_TIMEOUT_MS), true);
  await assert.rejects(() => timed, (error) => error.code === 'DESKTOP_WORKER_REQUEST_TIMEOUT');
});

test('requestShutdown rejects pending requests and clears their deadlines', async () => {
  const { supervisor, spawned, timers } = createHarness();
  supervisor.start();
  const pending = supervisor.invoke('getAppState', {});

  supervisor.requestShutdown();

  await assert.rejects(() => pending, (error) => error.code === 'DESKTOP_WORKER_SHUTDOWN');
  assert.equal(timers.pendingCount(), 1, 'only the forced-kill timer should remain');
  assert.ok(spawned[0].sent.some((message) => message.channel === 'shutdown'));
});

test('main requests are routed to the main-process handler and answered', async () => {
  const { supervisor, spawned } = createHarness({
    mainRequestHandler: async ({ channel, payload }) => {
      if (channel === 'secrets.get') {
        return { value: `secret:${payload.id}` };
      }
      const error = new Error('unknown channel');
      error.code = 'MAIN_REQUEST_FAILED';
      error.statusCode = 409;
      throw error;
    }
  });

  supervisor.start();
  const worker = spawned[0];
  worker.emit('message', { type: 'main-request', id: 'main-1', channel: 'secrets.get', payload: { id: 'p1' } });
  worker.emit('message', { type: 'main-request', id: 'main-2', channel: 'nope', payload: {} });
  await new Promise((resolve) => setImmediate(resolve));

  const responses = worker.sent.filter((message) => message.type === 'main-response');
  assert.deepEqual(
    responses.find((message) => message.id === 'main-1'),
    { type: 'main-response', id: 'main-1', ok: true, result: { value: 'secret:p1' } }
  );
  const failure = responses.find((message) => message.id === 'main-2');
  assert.equal(failure.ok, false);
  assert.equal(failure.error.message, 'unknown channel');
  assert.equal(failure.error.code, 'MAIN_REQUEST_FAILED');
  assert.equal(failure.error.statusCode, 409);
});

test('invoke while restarting surfaces a restarting error instead of forking a duplicate', () => {
  const { supervisor, timers, spawned } = createHarness({ backoffScheduleMs: [10, 20, 40] });

  supervisor.start();
  spawned[0].emit('exit', 1, null);

  assert.throws(
    () => supervisor.invoke('getAppState', {}),
    (error) => error.code === 'DESKTOP_WORKER_RESTARTING'
  );
  assert.equal(spawned.length, 1, 'no duplicate worker should be spawned while a respawn is pending');

  timers.fireFirst();
  assert.equal(spawned.length, 2);
});
