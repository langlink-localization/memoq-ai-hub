// Lightweight shape validation for gateway POST payloads. The gateway is the
// plugin-facing wire boundary: rejected shapes must fail fast with a typed
// error before reaching runtime services, which stay permissive for internal
// (IPC) callers. Validation is deliberately shallow — it pins the fields the
// plugin always sends and the runtime depends on, and ignores unknown fields.

const REQUIRED_LANGUAGE_FIELDS = ['sourceLanguage', 'targetLanguage'];

/** @typedef {Record<string, unknown>} GatewayPayload */

/** @type {Record<string, (payload: GatewayPayload) => string | null>} */
const ROUTE_VALIDATORS = {
  mtTranslate: validateTranslatePayload,
  mtTranslateAggregate: validateTranslatePayload,
  mtTranslateAggregateResult: validateAggregateResultPayload,
  mtStoreTranslations: validateStoreTranslationsPayload
};

/**
 * @param {unknown} value
 * @returns {value is GatewayPayload}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {Array<() => string | null>} rules
 * @returns {string | null}
 */
function firstProblem(rules) {
  for (const rule of rules) {
    const problem = rule();
    if (problem) {
      return problem;
    }
  }
  return null;
}

/**
 * @param {GatewayPayload} payload
 * @returns {string | null}
 */
function validateTranslatePayload(payload) {
  return firstProblem([
    () => (Array.isArray(payload.segments) ? null : 'segments must be an array of segment objects.'),
    () => REQUIRED_LANGUAGE_FIELDS
      .map((field) => (isNonEmptyString(payload[field]) ? null : `${field} must be a non-empty string.`))
      .find(Boolean) || null
  ]);
}

/**
 * @param {GatewayPayload} payload
 * @returns {string | null}
 */
function validateAggregateResultPayload(payload) {
  return isNonEmptyString(payload.jobRequestId)
    ? null
    : 'jobRequestId must be a non-empty string.';
}

/**
 * @param {GatewayPayload} payload
 * @returns {string | null}
 */
function validateStoreTranslationsPayload(payload) {
  return firstProblem([
    () => REQUIRED_LANGUAGE_FIELDS
      .map((field) => (isNonEmptyString(payload[field]) ? null : `${field} must be a non-empty string.`))
      .find(Boolean) || null,
    () => (Array.isArray(payload.translations) ? null : 'translations must be an array of translation entries.')
  ]);
}

/**
 * @param {string} routeKey
 * @param {unknown} payload
 * @returns {string | null}
 */
function validateGatewayPayload(routeKey, payload) {
  if (!isPlainObject(payload)) {
    return 'The request body must be a JSON object.';
  }

  const validator = ROUTE_VALIDATORS[routeKey];
  return validator ? validator(payload) : null;
}

module.exports = {
  validateGatewayPayload
};
