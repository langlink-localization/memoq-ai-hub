function shouldSuggestModelDiscovery(message = '') {
  const normalized = String(message || '').trim().toLowerCase();
  return normalized.includes('author') && normalized.includes('banned')
    || normalized.includes('model') && normalized.includes('banned')
    || normalized.includes('not allowed')
    || normalized.includes('forbidden');
}

function getEnabledModelCount(provider = {}) {
  return (Array.isArray(provider.models) ? provider.models : []).filter((model) => model?.enabled !== false).length;
}

function isProviderConnectionTestDisabled(provider = {}, testing = false) {
  if (testing) {
    return true;
  }
  return provider?.type === 'openai-compatible' && getEnabledModelCount(provider) < 1;
}

function getProviderConnectionHelperText({
  provider,
  status,
  statusLabel,
  message,
  hasPreviousTest,
  t
}) {
  if (status === 'testing') {
    return t('providers.testingDraft');
  }

  if (status === 'connected') {
    return `${statusLabel}. ${t('providers.connectionReady')}`;
  }

  if (getEnabledModelCount(provider) < 1) {
    return provider?.type === 'openai-compatible'
      ? t('providers.compatibleModelRequiredHint')
      : t('providers.modelRequiredHint');
  }

  const normalizedMessage = String(message || '').trim();
  if (status === 'failed' && normalizedMessage) {
    if (provider?.type === 'openai-compatible' && shouldSuggestModelDiscovery(normalizedMessage)) {
      return `${statusLabel}. ${normalizedMessage} ${t('providers.discoverModelsHint')}`;
    }
    return `${statusLabel}. ${normalizedMessage}`;
  }

  if (hasPreviousTest) {
    return t('providers.testAfterChangesHint');
  }

  return provider?.type === 'openai-compatible'
    ? t('providers.compatibleTestBeforeSaveHint')
    : t('providers.testBeforeSaveHint');
}

module.exports = {
  getEnabledModelCount,
  getProviderConnectionHelperText,
  isProviderConnectionTestDisabled,
  shouldSuggestModelDiscovery
};
