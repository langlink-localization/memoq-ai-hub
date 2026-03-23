const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const helperPath = path.join(__dirname, '..', 'src', 'renderer', 'src', 'editorDrafts.mjs');

async function loadHelpers() {
  return import(pathToFileURL(helperPath).href);
}

function fingerprint(record = {}) {
  return JSON.stringify(record);
}

test('editor drafts resolve saved draft records ahead of remote snapshot', async () => {
  const {
    createDraftEntry,
    getResolvedRecords
  } = await loadHelpers();

  const draftsById = {
    provider_1: createDraftEntry({
      id: 'provider_1',
      name: 'Renamed OpenAI',
      type: 'openai'
    }, fingerprint, { dirtyFields: ['name'] })
  };

  const resolved = getResolvedRecords([
    { id: 'provider_1', name: 'OpenAI', type: 'openai' }
  ], draftsById);

  assert.equal(resolved[0].name, 'Renamed OpenAI');
});

test('editor drafts keep unsaved new drafts during refresh rebase', async () => {
  const {
    createDraftEntry,
    getResolvedRecords,
    rebaseDraftEntries
  } = await loadHelpers();

  const draftsById = {
    draft_provider_1: createDraftEntry({
      id: 'draft_provider_1',
      name: 'Draft Provider',
      type: 'openai-compatible'
    }, fingerprint, { isNew: true, dirtyFields: ['name', 'type'] })
  };

  const { draftsById: rebased, removedIds } = rebaseDraftEntries(draftsById, [
    { id: 'provider_1', name: 'OpenAI', type: 'openai' }
  ], fingerprint);
  const resolved = getResolvedRecords([
    { id: 'provider_1', name: 'OpenAI', type: 'openai' }
  ], rebased);

  assert.deepEqual(removedIds, []);
  assert.equal(resolved[0].id, 'draft_provider_1');
  assert.equal(resolved[0].name, 'Draft Provider');
});

test('editor drafts rebase untouched fields from remote while keeping dirty fields', async () => {
  const {
    createDraftEntry,
    rebaseDraftEntries
  } = await loadHelpers();

  const draftsById = {
    provider_1: createDraftEntry({
      id: 'provider_1',
      name: 'Renamed OpenAI',
      type: 'openai',
      baseUrl: 'https://old.example.com/v1'
    }, fingerprint, { dirtyFields: ['name'] })
  };

  const { draftsById: rebased } = rebaseDraftEntries(draftsById, [
    { id: 'provider_1', name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1' }
  ], fingerprint);

  assert.equal(rebased.provider_1.draft.name, 'Renamed OpenAI');
  assert.equal(rebased.provider_1.draft.baseUrl, 'https://api.openai.com/v1');
});

test('editor drafts can discard a targeted draft without affecting others', async () => {
  const {
    createDraftEntry,
    discardDraftEntry
  } = await loadHelpers();

  const draftsById = {
    provider_1: createDraftEntry({ id: 'provider_1', name: 'One' }, fingerprint, { dirtyFields: ['name'] }),
    provider_2: createDraftEntry({ id: 'provider_2', name: 'Two' }, fingerprint, { dirtyFields: ['name'] })
  };

  const nextDrafts = discardDraftEntry(draftsById, 'provider_1');

  assert.equal(Boolean(nextDrafts.provider_1), false);
  assert.equal(Boolean(nextDrafts.provider_2), true);
});
