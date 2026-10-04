'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CONTRACT_VERSION } = require('../src/shared/desktopContract');
const { createRuntimeTranslationWriteback } = require('../src/runtime/runtimeTranslationWriteback');

function createWriteback() {
  const writes = [];
  const logs = [];
  const writeback = createRuntimeTranslationWriteback({
    persistence: {
      writeTranslationCache(key, text, storedAt) {
        writes.push({ key, text, storedAt });
      }
    },
    nowIso: () => '2026-10-04T03:00:00.000Z',
    createId: (prefix) => `${prefix}-generated`,
    runtimeLogger: {
      info(event, message, details) {
        logs.push({ event, message, details });
      }
    }
  });
  return { writeback, writes, logs };
}

test('translation writeback rejects a contract mismatch before writing cache rows', async () => {
  const { writeback, writes } = createWriteback();

  const result = await writeback.storeTranslations({
    contractVersion: '0',
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    translations: [{ sourceText: 'Hello', targetText: '你好' }]
  });

  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error.code, 'CONTRACT_VERSION_MISMATCH');
  assert.equal(writes.length, 0);
});

test('translation writeback stores complete pairs and skips blank rows', async () => {
  const { writeback, writes, logs } = createWriteback();

  const result = await writeback.storeTranslations({
    requestId: 'request-1',
    traceId: 'trace-1',
    contractVersion: CONTRACT_VERSION,
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    translations: [
      { sourceText: ' Hello ', targetText: ' 你好 ' },
      { sourceText: '   ', targetText: '跳过' }
    ]
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.storedCount, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].text, '你好');
  assert.equal(writes[0].storedAt, '2026-10-04T03:00:00.000Z');
  assert.equal(logs[0].details.storedCount, 1);
});

test('translation writeback requires both languages', async () => {
  const { writeback, writes } = createWriteback();

  const result = await writeback.storeTranslations({
    sourceLanguage: 'en',
    translations: [{ sourceText: 'Hello', targetText: '你好' }]
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.requestId, 'store-generated');
  assert.equal(writes.length, 0);
});
