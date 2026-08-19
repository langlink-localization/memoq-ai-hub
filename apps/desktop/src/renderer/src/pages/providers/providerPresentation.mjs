import { normalizeProviderStatus } from './providerConnectionState.mjs';

export function getStatusTagMeta(status, t) {
  const normalized = normalizeProviderStatus(status);
  switch (normalized) {
    case 'connected':
      return { color: 'green', label: t('providers.statusConnected') };
    case 'failed':
      return { color: 'red', label: t('providers.statusFailed') };
    case 'testing':
      return { color: 'gold', label: t('providers.statusTesting') };
    default:
      return { color: 'default', label: t('providers.statusNotTested') };
  }
}

export function getProviderTypeLabel(type, t) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'openai-compatible') return t('providers.typeOpenAICompatible');
  if (normalized === 'openai') return t('providers.typeOpenAI');
  return t('providers.typeCustom');
}

export function normalizeProviderFilterText(value) {
  return String(value || '').trim().toLowerCase();
}
