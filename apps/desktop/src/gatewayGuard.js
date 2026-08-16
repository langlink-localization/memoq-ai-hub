const { DEFAULT_HOST, DEFAULT_PORT } = require('./shared/desktopContract');

function createGatewayGuard(options = {}) {
  const host = String(options.host || DEFAULT_HOST);
  const port = Number(options.port || DEFAULT_PORT);
  const logger = options.logger || null;

  const allowedHostHeaders = new Set([
    `${host}:${port}`.toLowerCase(),
    `localhost:${port}`.toLowerCase(),
    `127.0.0.1:${port}`.toLowerCase()
  ]);
  const allowedOrigins = new Set([
    `http://${host}:${port}`.toLowerCase(),
    `http://localhost:${port}`.toLowerCase(),
    `http://127.0.0.1:${port}`.toLowerCase()
  ]);

  function reject(res, code, message, logEvent, details) {
    logger?.warn(logEvent, message, details);
    const body = {
      success: false,
      error: { code, message }
    };
    if (typeof res.status === 'function' && typeof res.json === 'function') {
      res.status(403).json(body);
      return;
    }
    res.statusCode = 403;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  }

  return function gatewayGuard(req, res, next) {
    const hostHeader = String(req.headers.host || '').toLowerCase();
    if (!allowedHostHeaders.has(hostHeader)) {
      reject(
        res,
        'GATEWAY_HOST_REJECTED',
        'Rejected request host.',
        'gateway-host-rejected',
        { hostHeader, path: req.path || req.url }
      );
      return;
    }

    const origin = String(req.headers.origin || '').toLowerCase();
    if (origin && !allowedOrigins.has(origin)) {
      reject(
        res,
        'GATEWAY_ORIGIN_REJECTED',
        'Rejected request origin.',
        'gateway-origin-rejected',
        { origin, path: req.path || req.url }
      );
      return;
    }

    next();
  };
}

module.exports = {
  createGatewayGuard
};
