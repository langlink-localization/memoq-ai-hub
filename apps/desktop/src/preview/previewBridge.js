const http = require('http');
const { execFileSync } = require('child_process');

const DEFAULT_PREVIEW_TOOL_NAME = 'memoQ AI Hub Preview Helper';
const DEFAULT_PREVIEW_TOOL_DESCRIPTION = 'Provides target-text, above-text, below-text, full-text, and summary support for memoQ AI Hub.';
const PREVIEW_TOOL_CONTRACT = Object.freeze({
  PreviewPartIdRegex: '.*',
  RequiresWebPreviewBaseUrl: false,
  ContentComplexity: 'Minimal',
  RequiredProperties: Object.freeze([])
});

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAuthHeader(connectionKey) {
  return `PREVIEW-TOOL-CONNECTION-KEY ${connectionKey}`;
}

function safeJsonParse(text) {
  if (!normalizeText(text)) {
    return null;
  }

  return JSON.parse(text);
}

function buildPreviewRegistrationRequest({
  previewToolId,
  previewToolName = DEFAULT_PREVIEW_TOOL_NAME,
  previewToolDescription = DEFAULT_PREVIEW_TOOL_DESCRIPTION
} = {}) {
  return {
    PreviewToolId: normalizeText(previewToolId),
    PreviewToolName: normalizeText(previewToolName) || DEFAULT_PREVIEW_TOOL_NAME,
    PreviewToolDescription: normalizeText(previewToolDescription) || DEFAULT_PREVIEW_TOOL_DESCRIPTION,
    PreviewPartIdRegex: PREVIEW_TOOL_CONTRACT.PreviewPartIdRegex,
    RequiresWebPreviewBaseUrl: PREVIEW_TOOL_CONTRACT.RequiresWebPreviewBaseUrl,
    ContentComplexity: PREVIEW_TOOL_CONTRACT.ContentComplexity,
    RequiredProperties: [...PREVIEW_TOOL_CONTRACT.RequiredProperties]
  };
}

function getCurrentSessionId() {
  const candidates = [
    ['powershell', ['-NoProfile', '-Command', '(Get-Process -Id $PID).SessionId']],
    ['pwsh', ['-NoProfile', '-Command', '(Get-Process -Id $PID).SessionId']]
  ];

  for (const [command, args] of candidates) {
    try {
      const output = execFileSync(command, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      }).toString('utf8').trim();
      const sessionId = Number(output);
      if (Number.isFinite(sessionId)) {
        return String(sessionId);
      }
    } catch {
      // Ignore and try the next command.
    }
  }

  return '1';
}

async function parseResponse(response) {
  const text = await response.text();
  const payload = safeJsonParse(text);

  if (!response.ok) {
    const error = new Error(
      normalizeText(payload?.ErrorMessage || payload?.error?.message || text || `memoQ Preview request failed with status ${response.status}`)
    );
    error.code = normalizeText(payload?.ErrorCode || payload?.error?.code || `HTTP_${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  return payload || {};
}

function createMemoQPreviewBridge(options = {}) {
  const runtime = options.runtime;
  const preview = options.preview || {};
  const previewToolId = normalizeText(preview.previewToolId);
  const previewToolName = normalizeText(preview.previewToolName) || DEFAULT_PREVIEW_TOOL_NAME;
  const previewToolDescription = normalizeText(preview.previewToolDescription) || DEFAULT_PREVIEW_TOOL_DESCRIPTION;
  const serviceBaseUrl = normalizeText(preview.serviceBaseUrl) || 'http://localhost:8088/MQPreviewService';
  const reconnectIntervalMs = Number(preview.reconnectIntervalMs) || 15000;

  let connectionKey = '';
  let callbackAddress = '';
  let callbackServer = null;
  let callbackRoutePrefix = '';
  let reconnectTimer = null;
  let starting = false;
  let stopped = false;
  const multipartBodies = new Map();

  function setStatus(status, patch = {}) {
    if (!runtime || typeof runtime.updatePreviewBridgeStatus !== 'function') {
      return;
    }

    runtime.updatePreviewBridgeStatus({
      status,
      serviceBaseUrl,
      sessionId: patch.sessionId,
      callbackAddress: patch.callbackAddress,
      statusMessage: patch.statusMessage,
      lastError: patch.lastError,
      connectedAt: patch.connectedAt,
      lastUpdatedAt: patch.lastUpdatedAt || nowIso()
    });
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void ensureConnected();
    }, reconnectIntervalMs);
  }

  async function negotiate(baseUrlWithSessionId) {
    const response = await fetch(baseUrlWithSessionId, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        KnownProtocolVersions: ['V1']
      })
    });

    return parseResponse(response);
  }

  async function register(baseUrlWithSessionId, authHeaderValue) {
    const response = await fetch(`${baseUrlWithSessionId}/previewtools`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeaderValue
      },
      body: JSON.stringify(buildPreviewRegistrationRequest({
        previewToolId,
        previewToolName,
        previewToolDescription
      }))
    });

    return parseResponse(response);
  }

  async function requestPreviewPartIds(baseUrlWithSessionId, authHeaderValue) {
    const response = await fetch(`${baseUrlWithSessionId}/previewtools/${previewToolId}/previewpartids`, {
      method: 'POST',
      headers: {
        Authorization: authHeaderValue
      }
    });

    return parseResponse(response);
  }

  async function requestContentUpdate(baseUrlWithSessionId, authHeaderValue, previewPartIds = []) {
    if (!previewPartIds.length) {
      return {};
    }

    const response = await fetch(`${baseUrlWithSessionId}/previewtools/${previewToolId}/content`, {
      method: 'POST',
      headers: {
        Authorization: authHeaderValue,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        PreviewPartIds: previewPartIds
      })
    });

    return parseResponse(response);
  }

  function closeCallbackServer() {
    if (!callbackServer) {
      return Promise.resolve();
    }

    const activeServer = callbackServer;
    callbackServer = null;
    return new Promise((resolve) => {
      activeServer.close(() => resolve());
    });
  }

  function getMultipartKey(req) {
    const correlationId = normalizeText(req.headers['message-correlation-id']);
    if (!correlationId) {
      return '';
    }

    return `${correlationId}:${req.url}`;
  }

  async function readRequestBody(req) {
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }

    const body = Buffer.concat(chunks).toString('utf8');
    const key = getMultipartKey(req);
    const totalParts = Number(req.headers['number-of-message-parts']);
    const isMultipart = key && Number.isFinite(totalParts) && totalParts > 1;
    const isLastMessage = String(req.headers['last-message'] || '').trim().toLowerCase() === 'true';

    if (!isMultipart) {
      return body;
    }

    multipartBodies.set(key, `${multipartBodies.get(key) || ''}${body}`);
    if (!isLastMessage) {
      return null;
    }

    const combined = multipartBodies.get(key) || '';
    multipartBodies.delete(key);
    return combined;
  }

  async function handleCallbackRequest(req, res) {
    const normalizedPath = normalizeText(req.url || '').replace(/\/+$/, '') || '/';
    const prefix = callbackRoutePrefix.replace(/\/+$/, '') || '/';
    const pingPath = prefix;
    const contentPath = `${prefix}/content`.replace(/\/+/g, '/');
    const highlightPath = `${prefix}/highlight`.replace(/\/+/g, '/');
    const previewPartIdsPath = `${prefix}/previewpartids`.replace(/\/+/g, '/');

    try {
      if (req.method === 'GET' && normalizedPath === pingPath) {
        res.writeHead(200);
        res.end('OK');
        return;
      }

      const rawBody = await readRequestBody(req);
      if (rawBody === null) {
        res.writeHead(200);
        res.end('OK');
        return;
      }

      const payload = safeJsonParse(rawBody) || {};

      if (req.method === 'POST' && normalizedPath === contentPath) {
        runtime.ingestPreviewContentUpdate(payload);
        res.writeHead(200);
        res.end('OK');
        return;
      }

      if (req.method === 'POST' && normalizedPath === highlightPath) {
        runtime.ingestPreviewHighlight(payload);
        res.writeHead(200);
        res.end('OK');
        return;
      }

      if (req.method === 'POST' && normalizedPath === previewPartIdsPath) {
        runtime.ingestPreviewPartIds(payload);
        const previewPartIds = Array.isArray(payload?.PreviewPartIds || payload?.previewPartIds)
          ? (payload.PreviewPartIds || payload.previewPartIds).map((item) => normalizeText(item)).filter(Boolean)
          : [];
        if (previewPartIds.length && connectionKey) {
          const sessionId = getCurrentSessionId();
          const baseUrlWithSessionId = `${serviceBaseUrl.replace(/\/+$/, '')}/${sessionId}`;
          void requestContentUpdate(baseUrlWithSessionId, buildAuthHeader(connectionKey), previewPartIds).catch((error) => {
            setStatus('error', {
              lastError: error.message,
              statusMessage: 'Preview content refresh failed.'
            });
          });
        }
        res.writeHead(200);
        res.end('OK');
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    } catch (error) {
      setStatus('error', {
        lastError: error.message,
        statusMessage: 'Preview callback handling failed.'
      });
      res.writeHead(500);
      res.end('Error');
    }
  }

  async function ensureCallbackServer(nextCallbackAddress) {
    const parsed = new URL(nextCallbackAddress);
    const nextPrefix = parsed.pathname.replace(/\/+$/, '') || '/';

    if (callbackServer && callbackAddress === nextCallbackAddress) {
      return;
    }

    await closeCallbackServer();
    callbackAddress = nextCallbackAddress;
    callbackRoutePrefix = nextPrefix;

    callbackServer = http.createServer((req, res) => {
      void handleCallbackRequest(req, res);
    });

    await new Promise((resolve, reject) => {
      callbackServer.once('error', reject);
      callbackServer.listen(Number(parsed.port || 80), parsed.hostname, () => {
        callbackServer.removeListener('error', reject);
        resolve();
      });
    });
  }

  async function ensureConnected() {
    if (stopped || starting) {
      return;
    }

    starting = true;
    const sessionId = getCurrentSessionId();
    const baseUrlWithSessionId = `${serviceBaseUrl.replace(/\/+$/, '')}/${sessionId}`;

    setStatus('connecting', {
      sessionId,
      statusMessage: 'Connecting to memoQ Preview SDK…'
    });

    try {
      const negotiation = await negotiate(baseUrlWithSessionId);
      connectionKey = normalizeText(negotiation?.ConnectionKey || negotiation?.connectionKey);
      if (!connectionKey) {
        throw new Error('memoQ Preview negotiation did not return a connection key.');
      }

      const registration = await register(baseUrlWithSessionId, buildAuthHeader(connectionKey));
      const nextCallbackAddress = normalizeText(registration?.CallbackAddress || registration?.callbackAddress);
      if (!nextCallbackAddress) {
        throw new Error('memoQ Preview registration did not return a callback address.');
      }

      await ensureCallbackServer(nextCallbackAddress);
      await wait(50);
      await requestPreviewPartIds(baseUrlWithSessionId, buildAuthHeader(connectionKey));

      setStatus('connected', {
        sessionId,
        callbackAddress: nextCallbackAddress,
        connectedAt: nowIso(),
        statusMessage: 'Preview bridge connected.'
      });
    } catch (error) {
      setStatus('error', {
        sessionId,
        lastError: error.message,
        statusMessage: 'Preview bridge is not connected.'
      });
      scheduleReconnect();
    } finally {
      starting = false;
    }
  }

  return {
    async start() {
      stopped = false;
      await ensureConnected();
    },
    async stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      await closeCallbackServer();
    }
  };
}

module.exports = {
  DEFAULT_PREVIEW_TOOL_DESCRIPTION,
  DEFAULT_PREVIEW_TOOL_NAME,
  PREVIEW_TOOL_CONTRACT,
  buildPreviewRegistrationRequest,
  createMemoQPreviewBridge,
  getCurrentSessionId
};
