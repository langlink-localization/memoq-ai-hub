export function normalizeLogStatePayload(data = {}) {
  return {
    ok: data.ok !== false,
    logsDir: String(data.logsDir || ''),
    policy: {
      maxFileBytes: Number(data.policy?.maxFileBytes || 0),
      maxFiles: Number(data.policy?.maxFiles || 0),
      retentionDays: Number(data.policy?.retentionDays || 0)
    },
    totalSizeBytes: Number(data.totalSizeBytes || 0),
    latestUpdatedAt: String(data.latestUpdatedAt || ''),
    groups: Array.isArray(data.groups) ? data.groups : []
  };
}

export function buildLogDiagnosticText(logState = {}, appState = {}, t = (key) => key) {
  const groups = (logState.groups || [])
    .map((group) => t('logs.diagnosticGroup', {
      source: group.source,
      files: (group.files || []).length,
      bytes: group.totalSizeBytes || 0
    }))
    .join('\n');

  return [
    t('logs.diagnosticsTitle', { product: appState.productName || 'memoQ AI Hub' }),
    t('logs.diagnosticContract', { value: appState.contractVersion || '-' }),
    t('logs.diagnosticGateway', { value: appState.gatewayBaseUrl || '-' }),
    t('logs.diagnosticStartup', { value: appState.startup?.status || 'ready' }),
    t('logs.diagnosticDirectory', { value: logState.logsDir || '-' }),
    t('logs.diagnosticTotalSize', { value: logState.totalSizeBytes || 0 }),
    t('logs.diagnosticLatestUpdate', { value: logState.latestUpdatedAt || '-' }),
    '',
    groups || t('logs.noFilesFound')
  ].join('\n');
}

export function formatLogBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function flattenLogFiles(logState = {}) {
  return (logState.groups || []).flatMap((group) => (
    (group.files || []).map((file) => ({
      key: file.path || `${group.source}-${file.name}`,
      source: group.source,
      ...file
    }))
  ));
}
