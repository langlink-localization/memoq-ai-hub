function isSharedOnlyPreviewRequest(payload, incomingSegments = []) {
  const useCase = String(payload?.profileResolution?.useCase || '').trim().toLowerCase();
  const requestType = String(payload?.requestType || '').trim().toLowerCase();
  return incomingSegments.length > 1
    || useCase === 'pretranslate'
    || requestType.includes('pretranslate')
    || requestType.includes('batch');
}

function normalizeHelperWarmupState(status = {}) {
  if (status.available === false || String(status.state || '').trim().toLowerCase() === 'missing') {
    return 'missing';
  }
  if (status.connected === true) {
    return 'connected';
  }
  const state = String(status.state || status.status || '').trim().toLowerCase();
  return state || 'disconnected';
}

function looksLikePreviewStartupTimeout(status = {}, normalizedStatus = '') {
  if (status.available === false || status.connected === true) {
    return false;
  }

  const state = String(normalizedStatus || status.state || status.status || '').trim().toLowerCase();
  if (state !== 'error' && state !== 'connecting') {
    return false;
  }

  if (String(status.lastConnectedAt || '').trim()) {
    return false;
  }

  const lastError = String(status.lastError || '').trim().toLowerCase();
  return lastError.includes('timeout')
    || lastError.includes('timed out')
    || lastError.includes('操作已超时');
}

module.exports = {
  isSharedOnlyPreviewRequest,
  normalizeHelperWarmupState,
  looksLikePreviewStartupTimeout
};
