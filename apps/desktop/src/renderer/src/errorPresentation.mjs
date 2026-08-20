export function getLocalizedDesktopError(error, t, fallback) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');

  if (
    code === 'OS_SECRET_STORAGE_UNAVAILABLE'
    || message.includes('Windows secure credential storage is unavailable')
  ) {
    return t('feedback.secretStorageUnavailable');
  }

  if (
    code === 'DESKTOP_WORKER_REQUEST_TIMEOUT'
    || message.includes('Desktop worker request timed out')
  ) {
    return t('feedback.workerRequestTimeout');
  }

  return message || fallback || t('feedback.actionFailed');
}
