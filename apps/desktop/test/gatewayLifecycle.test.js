const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { EventEmitter } = require('events');

const { startGatewayLifecycle, stopGatewayLifecycle } = require('../src/gatewayLifecycle');

test('gateway lifecycle marks runtime ready only after listen succeeds and clears it on stop', async () => {
  const calls = [];
  const runtime = {
    markGatewayReady(value) {
      calls.push(Boolean(value));
    }
  };

  const { server } = await startGatewayLifecycle({
    runtime,
    createGatewayServer() {
      return {
        app: {
          listen(port, host, callback) {
            const createdServer = http.createServer((_req, res) => res.end('ok'));
            return createdServer.listen(port, host, callback);
          }
        }
      };
    },
    host: '127.0.0.1',
    port: 0
  });

  await stopGatewayLifecycle({ runtime, server });

  assert.deepEqual(calls, [false, true, false]);
});

test('gateway lifecycle clears runtime readiness when listen fails', async () => {
  const calls = [];
  const runtime = {
    markGatewayReady(value) {
      calls.push(Boolean(value));
    }
  };

  await assert.rejects(
    startGatewayLifecycle({
      runtime,
      createGatewayServer() {
        return {
          app: {
            listen() {
              const emitter = new EventEmitter();
              process.nextTick(() => {
                emitter.emit('error', new Error('listen exploded'));
              });
              return emitter;
            }
          }
        };
      },
      host: '127.0.0.1',
      port: 0
    }),
    /listen exploded/
  );

  assert.deepEqual(calls, [false, false]);
});
