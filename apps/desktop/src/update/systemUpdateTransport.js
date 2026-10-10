const { Readable } = require('stream');
const { normalizeExternalHttpsUrl } = require('../shared/externalNavigation');

const CHUNK_BYTES = 256 * 1024;
const IDLE_TIMEOUT_MS = 45_000;

// Main-process transport only. The worker retains update policy, files and SHA-256 verification.
function createSystemUpdateTransport({ getSession, createRequest, idleTimeoutMs = IDLE_TIMEOUT_MS }) {
  const requests = new Map();
  function close(id) {
    const entry = requests.get(id);
    if (!entry) return;
    requests.delete(id);
    clearTimeout(entry.timer);
    entry.controller.abort();
    void entry.reader?.cancel().catch(() => {});
  }
  function touch(id, entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => close(id), idleTimeoutMs);
    entry.timer.unref?.();
  }
  return {
    dispose() { for (const id of requests.keys()) close(id); },
    async handle(channel, payload = {}) {
      const id = String(payload.id || '');
      if (!/^update_fetch_[a-z0-9_-]+$/i.test(id)) throw new Error('Invalid update request ID.');
      if (channel === 'updates.network.close') { close(id); return {}; }
      if (channel === 'updates.network.open') {
        if (requests.size >= 2 || requests.has(id)) throw new Error('Update network request already active.');
        let url = normalizeExternalHttpsUrl(payload.url, { label: 'Update URL' });
        const entry = { controller: new AbortController(), reader: null, buffer: Buffer.alloc(0), timer: null, reading: false, bytes: 0 };
        requests.set(id, entry);
        touch(id, entry);
        try {
          const ses = await getSession();
          // Re-read changed OS/PAC configuration on each check or download. Never switch to direct on failure.
          await ses.forceReloadProxyConfig();
          if (entry.controller.signal.aborted) throw new Error('Update request cancelled.');
          const response = await new Promise((resolve, reject) => {
            const request = createRequest({ session: ses, url, method: 'GET', redirect: 'manual',
              useSessionCookies: false, cache: 'no-store', bypassCustomProtocolHandlers: true,
              headers: { accept: payload.manifest ? 'application/json' : 'application/octet-stream' } });
            let redirects = 0;
            const fail = (error) => { reject(error); entry.controller.abort(error); };
            entry.controller.signal.addEventListener('abort', () => {
              reject(entry.controller.signal.reason);
              request.abort();
            }, { once: true });
            request.on('error', fail);
            request.on('login', (_authInfo, callback) => {
              callback();
              fail(Object.assign(new Error('Proxy authentication is required. Open the download page in your browser.'), { code: 'UPDATE_PROXY_AUTH_REQUIRED' }));
            });
            request.on('redirect', (_status, _method, redirectUrl) => {
              try {
                if (++redirects > 8) throw new Error('Too many update redirects.');
                url = normalizeExternalHttpsUrl(new URL(redirectUrl, url).href, { label: 'Update redirect URL' });
                request.followRedirect();
              } catch (error) { fail(error); }
            });
            request.once('response', resolve);
            request.end();
          });
          if (entry.controller.signal.aborted) { response.destroy(); throw new Error('Update request cancelled.'); }
          entry.limit = payload.manifest ? 1024 * 1024 : 1024 * 1024 * 1024;
          const length = String(response.headers['content-length'] || '');
          if (Number(length) > entry.limit) { response.destroy(); throw new Error('Update response exceeds the size limit.'); }
          entry.reader = Readable.toWeb(response).getReader();
          touch(id, entry);
          const metadata = { status: response.statusCode, url, headers: { 'content-length': length } };
          if (response.statusCode < 200 || response.statusCode >= 300) close(id);
          return metadata;
        } catch (error) { close(id); throw error; }
      }
      if (channel === 'updates.network.read') {
        const entry = requests.get(id);
        if (!entry) throw new Error('Update connection expired. Please retry.');
        if (entry.reading) throw new Error('Concurrent update stream reads are not supported.');
        entry.reading = true;
        touch(id, entry);
        try {
          if (!entry.buffer.length) {
            const result = entry.reader ? await entry.reader.read() : { done: true };
            if (entry.controller.signal.aborted) throw new Error('Update connection expired or cancelled.');
            if (result.done) { close(id); return { done: true }; }
            entry.buffer = Buffer.from(result.value);
            entry.bytes += entry.buffer.length;
            if (entry.bytes > entry.limit) throw new Error('Update response exceeds the size limit.');
          }
          const chunk = entry.buffer.subarray(0, CHUNK_BYTES);
          entry.buffer = entry.buffer.subarray(chunk.length);
          touch(id, entry);
          return { done: false, data: chunk.toString('base64') };
        } catch (error) { close(id); throw error; }
        finally { entry.reading = false; }
      }
      throw new Error('Unknown update network operation.');
    }
  };
}
module.exports = { createSystemUpdateTransport };
