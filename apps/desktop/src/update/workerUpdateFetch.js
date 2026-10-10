const { randomUUID } = require('crypto');

// Pull-based IPC bounds memory and applies backpressure; archive bodies never cross IPC as one message.
function createWorkerUpdateFetch({ send, requestTimeoutMs = 50_000 }) {
  const pending = new Map();
  let sequence = 0;
  function request(channel, payload) {
    return new Promise((resolve, reject) => {
      const id = `update_rpc_${sequence += 1}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Update network request timed out. Please retry.'));
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { send({ type: 'main-request', id, channel, payload }); }
      catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  return {
    handleMessage(message) {
      if (message?.type !== 'main-response') return;
      const item = pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(message.id);
      if (message.ok) item.resolve(message.result);
      else item.reject(Object.assign(new Error(message.error?.message || 'Update network request failed.'), { code: message.error?.code || '', statusCode: message.error?.statusCode }));
    },
    async fetch(url, init = {}) {
      const id = `update_fetch_${randomUUID()}`;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        init.signal?.removeEventListener('abort', abort);
        void request('updates.network.close', { id }).catch(() => {});
      };
      let rejectAbort;
      const aborted = new Promise((_, reject) => { rejectAbort = reject; });
      const abort = () => {
        close();
        rejectAbort(init.signal?.reason || new Error('Update download cancelled.'));
      };
      if (init.signal?.aborted) throw init.signal.reason;
      init.signal?.addEventListener('abort', abort, { once: true });
      const call = (channel, payload) => Promise.race([request(channel, payload), aborted]);
      try {
        const meta = await call('updates.network.open', { id, url: String(url), manifest: new Headers(init.headers).get('accept') === 'application/json' });
        if (meta.status < 200 || meta.status >= 300) {
          close();
          const response = new Response(null, { status: meta.status, headers: meta.headers });
          Object.defineProperty(response, 'url', { value: meta.url });
          return response;
        }
        const stream = new ReadableStream({
          async pull(controller) {
            try {
              const result = await call('updates.network.read', { id });
              if (result.done) { close(); controller.close(); }
              else controller.enqueue(Buffer.from(result.data, 'base64'));
            } catch (error) { close(); controller.error(error); }
          },
          cancel() { close(); }
        }, { highWaterMark: 0 });
        const response = new Response([204, 205, 304].includes(meta.status) ? null : stream, { status: meta.status, headers: meta.headers });
        Object.defineProperty(response, 'url', { value: meta.url });
        if (!response.body) close();
        return response;
      } catch (error) { close(); throw error; }
    }
  };
}
module.exports = { createWorkerUpdateFetch };
