const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAppPaths } = require('../src/shared/paths');
const {
  getLogState,
  pruneLogs,
  writeLogEntry
} = require('../src/shared/logging');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-ai-hub-logs-'));
}

test('logging redacts secrets and omits translation content', () => {
  const tempDir = createTempDir();
  try {
    writeLogEntry(tempDir, {
      source: 'desktop-main',
      level: 'info',
      event: 'redaction-test',
      message: 'Testing Authorization: Bearer super-secret-token',
      data: {
        apiKey: 'sk-secret',
        authorization: 'Bearer hidden-token',
        sourceText: 'Do not log this source',
        targetText: 'Do not log this target',
        safe: 'kept'
      }
    });

    const content = fs.readFileSync(path.join(tempDir, 'desktop-main.log'), 'utf8');
    assert.match(content, /redaction-test/);
    assert.match(content, /kept/);
    assert.doesNotMatch(content, /sk-secret/);
    assert.doesNotMatch(content, /super-secret-token/);
    assert.doesNotMatch(content, /hidden-token/);
    assert.doesNotMatch(content, /Do not log this/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('logging rotates by size and keeps the newest files per source', () => {
  const tempDir = createTempDir();
  const policy = { maxFileBytes: 240, maxFiles: 3, retentionDays: 14 };
  try {
    for (let index = 0; index < 8; index += 1) {
      writeLogEntry(tempDir, {
        source: 'runtime',
        level: 'info',
        event: `rotation-${index}`,
        message: 'x'.repeat(180),
        data: { index }
      }, policy, { now: new Date(Date.UTC(2026, 0, 1, 0, 0, index)) });
    }

    const files = fs.readdirSync(tempDir).filter((fileName) => fileName.startsWith('runtime') && fileName.endsWith('.log'));
    assert.ok(files.length <= policy.maxFiles);
    assert.ok(files.some((fileName) => fileName === 'runtime.log'));
    assert.ok(files.some((fileName) => /runtime\.\d{4}-/.test(fileName)));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('pruneLogs deletes files older than the retention window', () => {
  const tempDir = createTempDir();
  try {
    const oldPath = path.join(tempDir, 'runtime.2026-01-01T00-00-00-000Z.log');
    const newPath = path.join(tempDir, 'runtime.log');
    fs.writeFileSync(oldPath, 'old', 'utf8');
    fs.writeFileSync(newPath, 'new', 'utf8');
    fs.utimesSync(oldPath, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    fs.utimesSync(newPath, new Date('2026-01-10T00:00:00Z'), new Date('2026-01-10T00:00:00Z'));

    const result = pruneLogs(tempDir, { maxFileBytes: 1024, maxFiles: 6, retentionDays: 7 }, {
      nowMs: Date.parse('2026-01-10T00:00:00Z')
    });

    assert.equal(result.deletedCount, 1);
    assert.equal(fs.existsSync(oldPath), false);
    assert.equal(fs.existsSync(newPath), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('getLogState groups files and reports totals', () => {
  const tempDir = createTempDir();
  try {
    writeLogEntry(tempDir, {
      source: 'gateway',
      level: 'info',
      event: 'state-test',
      message: 'hello'
    });

    const state = getLogState(tempDir);
    assert.equal(state.ok, true);
    assert.equal(state.logsDir, tempDir);
    assert.equal(state.groups.length, 1);
    assert.equal(state.groups[0].source, 'gateway');
    assert.equal(state.groups[0].files.length, 1);
    assert.ok(state.totalSizeBytes > 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createAppPaths keeps test logs under MEMOQ_AI_DESKTOP_DATA_DIR', () => {
  const tempDir = createTempDir();
  const previousDataDir = process.env.MEMOQ_AI_DESKTOP_DATA_DIR;
  const previousLogsDir = process.env.MEMOQ_AI_DESKTOP_LOGS_DIR;
  try {
    process.env.MEMOQ_AI_DESKTOP_DATA_DIR = tempDir;
    delete process.env.MEMOQ_AI_DESKTOP_LOGS_DIR;
    const paths = createAppPaths();
    assert.equal(paths.logsDir, path.join(tempDir, 'logs'));
  } finally {
    if (previousDataDir == null) {
      delete process.env.MEMOQ_AI_DESKTOP_DATA_DIR;
    } else {
      process.env.MEMOQ_AI_DESKTOP_DATA_DIR = previousDataDir;
    }
    if (previousLogsDir == null) {
      delete process.env.MEMOQ_AI_DESKTOP_LOGS_DIR;
    } else {
      process.env.MEMOQ_AI_DESKTOP_LOGS_DIR = previousLogsDir;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
