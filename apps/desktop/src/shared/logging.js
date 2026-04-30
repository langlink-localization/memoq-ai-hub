const fs = require('fs');
const path = require('path');

const DEFAULT_LOG_POLICY = Object.freeze({
  maxFileBytes: 5 * 1024 * 1024,
  maxFiles: 6,
  retentionDays: 14
});

const REDACTED = '[redacted]';
const SENSITIVE_KEY_PATTERN = /(?:api[-_ ]?key|authorization|bearer|token|secret|password|credential)/i;
const CONTENT_KEY_PATTERN = /(?:sourceText|targetText|prompt|systemPrompt|userPrompt|assembledPrompt|translations|segments|payload|input|output|body)$/i;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizePolicy(policy = {}) {
  return {
    maxFileBytes: Math.max(1024, Number(policy.maxFileBytes || DEFAULT_LOG_POLICY.maxFileBytes)),
    maxFiles: Math.max(1, Number(policy.maxFiles || DEFAULT_LOG_POLICY.maxFiles)),
    retentionDays: Math.max(1, Number(policy.retentionDays || DEFAULT_LOG_POLICY.retentionDays))
  };
}

function sanitizeSource(source = 'app') {
  return String(source || 'app')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app';
}

function toIsoTimestamp(now = new Date()) {
  return new Date(now).toISOString();
}

function toFileTimestamp(now = new Date()) {
  return toIsoTimestamp(now).replace(/[:.]/g, '-');
}

function redactString(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(Authorization\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/(api[-_ ]?key\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]');
}

function redactValue(value, key = '', depth = 0) {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED;
  }
  if (CONTENT_KEY_PATTERN.test(key)) {
    return '[omitted]';
  }
  if (value == null) {
    return value;
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      code: value.code || '',
      statusCode: Number.isFinite(Number(value.statusCode)) ? Number(value.statusCode) : undefined,
      stack: value.stack ? redactString(value.stack).split(/\r?\n/).slice(0, 8).join('\n') : ''
    };
  }
  if (depth >= 4) {
    return '[omitted]';
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactValue(item, key, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey, depth + 1)
      ])
    );
  }
  return String(value);
}

function safeSerialize(payload) {
  try {
    return JSON.stringify(redactValue(payload));
  } catch (error) {
    return JSON.stringify({ serializationError: redactString(error?.message || String(error)) });
  }
}

function getCurrentLogPath(logsDir, source) {
  return path.join(logsDir, `${sanitizeSource(source)}.log`);
}

function parseLogSource(fileName) {
  const normalized = String(fileName || '').replace(/\.log$/i, '');
  return normalized.replace(/\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/i, '');
}

function getLogFiles(logsDir) {
  if (!fs.existsSync(logsDir)) {
    return [];
  }

  return fs.readdirSync(logsDir)
    .filter((fileName) => fileName.toLowerCase().endsWith('.log'))
    .map((fileName) => {
      const filePath = path.join(logsDir, fileName);
      const stats = fs.statSync(filePath);
      return {
        name: fileName,
        path: filePath,
        source: parseLogSource(fileName),
        sizeBytes: stats.size,
        updatedAtMs: stats.mtimeMs,
        updatedAt: stats.mtime.toISOString(),
        isCurrent: !/\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.log$/i.test(fileName)
      };
    })
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

function deleteFileQuietly(filePath) {
  try {
    const sizeBytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    fs.unlinkSync(filePath);
    return sizeBytes;
  } catch {
    return 0;
  }
}

function pruneLogs(logsDir, policy = DEFAULT_LOG_POLICY, options = {}) {
  const normalizedPolicy = normalizePolicy(policy);
  ensureDir(logsDir);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const retentionMs = normalizedPolicy.retentionDays * 24 * 60 * 60 * 1000;
  const deletedFiles = [];
  let reclaimedBytes = 0;

  for (const file of getLogFiles(logsDir)) {
    if (nowMs - file.updatedAtMs > retentionMs) {
      const bytes = deleteFileQuietly(file.path);
      if (bytes > 0) {
        reclaimedBytes += bytes;
        deletedFiles.push(file.path);
      }
    }
  }

  const remainingBySource = new Map();
  for (const file of getLogFiles(logsDir)) {
    if (!remainingBySource.has(file.source)) {
      remainingBySource.set(file.source, []);
    }
    remainingBySource.get(file.source).push(file);
  }

  for (const files of remainingBySource.values()) {
    const sorted = [...files].sort((left, right) => right.updatedAtMs - left.updatedAtMs);
    for (const stale of sorted.slice(normalizedPolicy.maxFiles)) {
      const bytes = deleteFileQuietly(stale.path);
      if (bytes > 0) {
        reclaimedBytes += bytes;
        deletedFiles.push(stale.path);
      }
    }
  }

  return {
    ok: true,
    logsDir,
    policy: normalizedPolicy,
    deletedFiles,
    deletedCount: deletedFiles.length,
    reclaimedBytes
  };
}

function rotateLogIfNeeded(logsDir, source, nextBytes, policy = DEFAULT_LOG_POLICY, now = new Date()) {
  const normalizedPolicy = normalizePolicy(policy);
  const currentPath = getCurrentLogPath(logsDir, source);
  if (!fs.existsSync(currentPath)) {
    return;
  }
  const currentSize = fs.statSync(currentPath).size;
  if (currentSize + nextBytes <= normalizedPolicy.maxFileBytes) {
    return;
  }

  const rotatedPath = path.join(logsDir, `${sanitizeSource(source)}.${toFileTimestamp(now)}.log`);
  try {
    fs.renameSync(currentPath, rotatedPath);
  } catch {
    const fallbackPath = path.join(logsDir, `${sanitizeSource(source)}.${toFileTimestamp(now)}-${process.pid}.log`);
    fs.renameSync(currentPath, fallbackPath);
  }
}

function writeLogEntry(logsDir, entry, policy = DEFAULT_LOG_POLICY, options = {}) {
  const normalizedPolicy = normalizePolicy(policy);
  const now = options.now || new Date();
  const source = sanitizeSource(entry.source);
  ensureDir(logsDir);
  const line = `${safeSerialize({
    timestamp: toIsoTimestamp(now),
    level: entry.level || 'info',
    source,
    event: entry.event || 'event',
    message: entry.message || '',
    data: entry.data || {}
  })}\n`;

  rotateLogIfNeeded(logsDir, source, Buffer.byteLength(line), normalizedPolicy, now);
  fs.appendFileSync(getCurrentLogPath(logsDir, source), line, 'utf8');
  pruneLogs(logsDir, normalizedPolicy, { nowMs: now.getTime() });
}

function createLogger(options = {}) {
  const source = sanitizeSource(options.source || 'app');
  const logsDir = String(options.logsDir || '').trim();
  const policy = normalizePolicy(options.policy);
  const mirrorToConsole = options.mirrorToConsole === true;

  function write(level, event, message, data) {
    if (logsDir) {
      try {
        writeLogEntry(logsDir, { source, level, event, message, data }, policy);
      } catch {
      }
    }
    if (mirrorToConsole) {
      const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      console[consoleMethod](`[${source}] ${event}: ${message}`);
    }
  }

  return {
    source,
    logsDir,
    policy,
    debug(event, message = '', data = {}) {
      write('debug', event, message, data);
    },
    info(event, message = '', data = {}) {
      write('info', event, message, data);
    },
    warn(event, message = '', data = {}) {
      write('warn', event, message, data);
    },
    error(event, message = '', data = {}) {
      write('error', event, message, data);
    }
  };
}

function getLogState(logsDir, policy = DEFAULT_LOG_POLICY) {
  const normalizedPolicy = normalizePolicy(policy);
  ensureDir(logsDir);
  const files = getLogFiles(logsDir);
  const groupsBySource = new Map();
  let totalSizeBytes = 0;
  let latestUpdatedAtMs = 0;

  for (const file of files) {
    totalSizeBytes += file.sizeBytes;
    latestUpdatedAtMs = Math.max(latestUpdatedAtMs, file.updatedAtMs);
    if (!groupsBySource.has(file.source)) {
      groupsBySource.set(file.source, []);
    }
    groupsBySource.get(file.source).push(file);
  }

  const groups = Array.from(groupsBySource.entries()).map(([source, sourceFiles]) => {
    const groupSizeBytes = sourceFiles.reduce((sum, file) => sum + file.sizeBytes, 0);
    const groupUpdatedAtMs = sourceFiles.reduce((max, file) => Math.max(max, file.updatedAtMs), 0);
    return {
      source,
      totalSizeBytes: groupSizeBytes,
      latestUpdatedAt: groupUpdatedAtMs ? new Date(groupUpdatedAtMs).toISOString() : '',
      files: sourceFiles.map((file) => ({
        name: file.name,
        path: file.path,
        sizeBytes: file.sizeBytes,
        updatedAt: file.updatedAt,
        isCurrent: file.isCurrent
      }))
    };
  }).sort((left, right) => String(left.source).localeCompare(String(right.source)));

  return {
    ok: true,
    logsDir,
    policy: normalizedPolicy,
    totalSizeBytes,
    latestUpdatedAt: latestUpdatedAtMs ? new Date(latestUpdatedAtMs).toISOString() : '',
    groups
  };
}

module.exports = {
  DEFAULT_LOG_POLICY,
  createLogger,
  getCurrentLogPath,
  getLogState,
  pruneLogs,
  redactValue,
  safeSerialize,
  writeLogEntry
};
