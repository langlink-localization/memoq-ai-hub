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

export function resolveProviderConnectionStatus({
  provider = null,
  draftEntry = null,
  hasDraftChanges = false,
  testState = DEFAULT_PROVIDER_TEST_STATE,
  fingerprint = '',
  invalidatingFields = CONNECTION_INVALIDATING_PROVIDER_FIELDS
} = {}) {
  if (!provider) {
    return 'not_tested';
  }

  if (draftEntry && hasDraftChanges) {
    if (testState.fingerprint === fingerprint) {
      return normalizeProviderStatus(testState.status);
    }

    const invalidatesConnection = (draftEntry.dirtyFields || []).some((field) => invalidatingFields.has(field));
    if (invalidatesConnection) {
      return 'not_tested';
    }

    if (testState.status && testState.status !== 'not_tested') {
      return normalizeProviderStatus(testState.status);
    }
  }

  return normalizeProviderStatus(provider.status);
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
    return {
      ...provider,
      status: resolveProviderConnectionStatus({
        provider,
        draftEntry,
        hasDraftChanges: providerId ? hasDraftChanges(draftsById, providerId) : false,
        testState,
        fingerprint: buildFingerprint(provider),
        invalidatingFields
      })
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
