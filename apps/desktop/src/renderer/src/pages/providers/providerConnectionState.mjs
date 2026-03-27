export const DEFAULT_PROVIDER_TEST_STATE = Object.freeze({
  fingerprint: '',
  status: 'not_tested',
  message: '',
  testedAt: '',
  latencyMs: null
});

export const CONNECTION_INVALIDATING_PROVIDER_FIELDS = new Set(['apiKey', 'baseUrl', 'requestPath', 'type', 'modelsConnection']);

export function normalizeProviderStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'connected' || normalized === 'failed' || normalized === 'testing' || normalized === 'not_tested') {
    return normalized;
  }
  if (normalized === 'healthy') return 'connected';
  if (normalized === 'needs_attention') return 'failed';
  if (normalized === 'idle') return 'not_tested';
  return 'not_tested';
}

export function resolveProviderConnectionSnapshot({
  provider = null,
  draftEntry = null,
  hasDraftChanges = false,
  testState = DEFAULT_PROVIDER_TEST_STATE,
  fingerprint = '',
  invalidatingFields = CONNECTION_INVALIDATING_PROVIDER_FIELDS
} = {}) {
  const providerStatus = normalizeProviderStatus(provider?.status);
  const previousTestedAt = String(testState?.testedAt || '').trim();
  const previousMessage = String(testState?.message || '').trim();
  const previousLatencyMs = Number.isFinite(testState?.latencyMs) ? testState.latencyMs : null;

  const baseSnapshot = {
    status: providerStatus,
    testedAt: String(provider?.lastCheckedAt || '').trim(),
    latencyMs: Number.isFinite(provider?.lastLatencyMs)
      ? provider.lastLatencyMs
      : (Number.isFinite(provider?.avgLatencyMs) ? provider.avgLatencyMs : null),
    message: providerStatus === 'failed' ? String(provider?.lastError || '').trim() : '',
    lastError: String(provider?.lastError || '').trim(),
    hasPreviousTest: Boolean(previousTestedAt)
  };

  if (!provider) {
    return {
      ...baseSnapshot,
      status: 'not_tested',
      testedAt: '',
      latencyMs: null,
      message: '',
      lastError: '',
      hasPreviousTest: false
    };
  }

  if (!(draftEntry && hasDraftChanges)) {
    return baseSnapshot;
  }

  if (testState.fingerprint === fingerprint) {
    const status = normalizeProviderStatus(testState.status);
    const message = status === 'failed' ? previousMessage : (status === 'connected' ? previousMessage : '');
    return {
      ...baseSnapshot,
      status,
      testedAt: previousTestedAt,
      latencyMs: previousLatencyMs,
      message,
      lastError: status === 'failed' ? previousMessage : ''
    };
  }

  const invalidatesConnection = (draftEntry.dirtyFields || []).some((field) => invalidatingFields.has(field));
  if (invalidatesConnection) {
    return {
      ...baseSnapshot,
      status: 'not_tested',
      message: '',
      lastError: '',
      hasPreviousTest: Boolean(previousTestedAt)
    };
  }

  if (testState.status && testState.status !== 'not_tested') {
    const status = normalizeProviderStatus(testState.status);
    const message = status === 'failed' ? previousMessage : (status === 'connected' ? previousMessage : '');
    return {
      ...baseSnapshot,
      status,
      testedAt: previousTestedAt,
      latencyMs: previousLatencyMs,
      message,
      lastError: status === 'failed' ? previousMessage : '',
      hasPreviousTest: Boolean(previousTestedAt)
    };
  }

  return baseSnapshot;
}

export function resolveProviderConnectionStatus({
  provider = null,
  draftEntry = null,
  hasDraftChanges = false,
  testState = DEFAULT_PROVIDER_TEST_STATE,
  fingerprint = '',
  invalidatingFields = CONNECTION_INVALIDATING_PROVIDER_FIELDS
} = {}) {
  return resolveProviderConnectionSnapshot({
    provider,
    draftEntry,
    hasDraftChanges,
    testState,
    fingerprint,
    invalidatingFields
  }).status;
}

export function decorateProvidersWithConnectionStatus({
  providers = [],
  draftsById = {},
  testStatesById = {},
  buildFingerprint = () => '',
  hasDraftChanges = () => false,
  invalidatingFields = CONNECTION_INVALIDATING_PROVIDER_FIELDS
} = {}) {
  return (providers || []).map((provider) => {
    const providerId = String(provider?.id || '').trim();
    const draftEntry = providerId ? draftsById[providerId] || null : null;
    const testState = providerId ? (testStatesById[providerId] || DEFAULT_PROVIDER_TEST_STATE) : DEFAULT_PROVIDER_TEST_STATE;
    const connectionSnapshot = resolveProviderConnectionSnapshot({
      provider,
      draftEntry,
      hasDraftChanges: providerId ? hasDraftChanges(draftsById, providerId) : false,
      testState,
      fingerprint: buildFingerprint(provider),
      invalidatingFields
    });
    return {
      ...provider,
      status: connectionSnapshot.status,
      connectionSnapshot
    };
  });
}

export function getProviderConnectionFeedback({
  status = 'not_tested',
  testState = DEFAULT_PROVIDER_TEST_STATE,
  messages = {}
} = {}) {
  const normalized = normalizeProviderStatus(status);
  if (normalized === 'testing') {
    return { tone: 'secondary', text: String(messages.testing || '').trim() };
  }
  if (normalized === 'connected') {
    const base = String(testState?.message || '').trim();
    const ready = String(messages.ready || '').trim();
    return { tone: 'success', text: [base, ready].filter(Boolean).join(' ') };
  }
  if (normalized === 'failed') {
    return { tone: 'danger', text: String(testState?.message || messages.failed || '').trim() };
  }
  if (String(testState?.testedAt || '').trim()) {
    return { tone: 'secondary', text: String(messages.retest || '').trim() };
  }
  return { tone: 'secondary', text: String(messages.test || '').trim() };
}
