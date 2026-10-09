import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describeBindingChanges, snapshotAssetBindings } from '../src/renderer/src/pages/assets/assetManagement.mjs';
const require = createRequire(import.meta.url);
const { createRuntimeAssetService } = require('../src/runtime/runtimeAssetService');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-assets-manage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storedPath = path.join(dir, 'terms.csv'); fs.writeFileSync(storedPath, 'en,ja\nsave,保存する');
  let state = { assets: [{ id: 'a', name: 'Terms', fileName: 'terms.csv', type: 'glossary', storedPath, sha256: 'hash' }],
    profiles: [
      { id: 'p1', name: 'One', useUploadedGlossary: false, prompt: 'keep this prompt', customSetting: { nested: true },
        assetBindings: [{ assetId: 'old', purpose: 'glossary' }, { assetId: 'tm', purpose: 'custom_tm' }],
        assetSelections: { glossaryAssetId: 'old', customTmAssetId: 'tm' } },
      { id: 'p2', name: 'Two', assetBindings: [{ assetId: 'a', purpose: 'glossary' }], assetSelections: { glossaryAssetId: 'a' } }
    ] };
  let saves = 0;
  const cache = new Map([['a:hash:smart:config', {}], ['a:hash:fallback:config', {}], ['other:hash', {}]]);
  const service = createRuntimeAssetService({ loadState: () => state, saveState: (next) => { saves += 1; state = next; },
    assetsDir: dir, parsedAssetCache: cache, createId: () => 'new', nowIso: () => 'now' });
  return { service, cache, state: () => state, saves: () => saves,
    payload: () => ({ assetId: 'a', name: 'Renamed', expectedName: state.assets[0].name,
      profileIds: ['p1'], expectedBindings: snapshotAssetBindings(state.profiles, 'glossary') }) };
}

test('asset rename and binding replacement/detach use one write and preserve other configuration', (t) => {
  const h = setup(t);
  const originalFile = { ...h.state().assets[0] };
  h.service.saveAssetDetails(h.payload());
  assert.equal(h.saves(), 1);
  const [one, two] = h.state().profiles;
  assert.deepEqual(one.assetBindings, [{ assetId: 'tm', purpose: 'custom_tm' }, { assetId: 'a', purpose: 'glossary' }]);
  assert.deepEqual(one.assetSelections, { glossaryAssetId: 'a', customTmAssetId: 'tm' });
  assert.equal(one.useUploadedGlossary, false);
  assert.equal(one.prompt, 'keep this prompt');
  assert.deepEqual(one.customSetting, { nested: true });
  assert.deepEqual(two.assetBindings, []);
  assert.deepEqual(two.assetSelections, {});
  assert.deepEqual(h.state().assets[0], { ...originalFile, name: 'Renamed' });
  assert.equal(fs.readFileSync(originalFile.storedPath, 'utf8'), 'en,ja\nsave,保存する');
});

test('enablement is explicit and concurrent binding edits fail before any state changes', (t) => {
  const h = setup(t);
  const stale = h.payload();
  h.state().profiles[0].assetBindings[0].assetId = 'newer';
  assert.throws(() => h.service.saveAssetDetails(stale), /changed/);
  assert.equal(h.saves(), 0);
  assert.equal(h.state().assets[0].name, 'Terms');
  h.service.saveAssetDetails({ ...h.payload(), enableBindings: true });
  assert.equal(h.state().profiles[0].useUploadedGlossary, true);
});

test('rename-only preserves legacy multiple bindings and disabled feature flags', (t) => {
  const h = setup(t);
  h.state().profiles[1].assetBindings.push({ assetId: 'legacy', purpose: 'glossary' });
  const before = structuredClone(h.state().profiles);
  h.service.saveAssetDetails({ ...h.payload(), profileIds: ['p2'] });
  assert.deepEqual(h.state().profiles, before);
});

test('missing profiles, blank names and changed asset names cannot partially save', (t) => {
  const h = setup(t);
  assert.throws(() => h.service.saveAssetDetails({ ...h.payload(), profileIds: ['missing'] }), /no longer exists/);
  assert.throws(() => h.service.saveAssetDetails({ ...h.payload(), name: ' ' }), /name/);
  assert.throws(() => h.service.saveAssetDetails({ ...h.payload(), expectedName: 'outdated' }), /changed/);
  assert.equal(h.saves(), 0);
});

test('a newly added reference cannot be silently removed by a stale editor', (t) => {
  const h = setup(t);
  const payload = h.payload();
  h.state().profiles.push({ id: 'p3', assetBindings: [{ assetId: 'a', purpose: 'glossary' }] });
  assert.throws(() => h.service.saveAssetDetails(payload), /changed/);
  assert.equal(h.saves(), 0);
});

test('delete remains blocked while used and clears all asset cache variants after unbinding', (t) => {
  const h = setup(t);
  assert.throws(() => h.service.deleteAsset('a'), /Two/);
  assert.equal(fs.existsSync(h.state().assets[0].storedPath), true);
  h.service.saveAssetDetails({ ...h.payload(), profileIds: [] });
  const file = h.state().assets[0].storedPath;
  h.cache.set('a:hash:smart:config', {}); h.cache.set('a:hash:fallback:config', {}); h.cache.set('other:hash', {});
  h.service.deleteAsset('a');
  assert.equal(fs.existsSync(file), false);
  assert.equal(h.state().assets.length, 0);
  assert.deepEqual([...h.cache.keys()], ['other:hash']);
});

test('change preview explicitly distinguishes attach, replace, detach and enable', () => {
  const snapshot = [{ profileId: 'empty', assetIds: [], enabled: true },
    { profileId: 'other', assetIds: ['old'], enabled: true },
    { profileId: 'removed', assetIds: ['a'], enabled: true },
    { profileId: 'off', assetIds: ['a'], enabled: false }];
  const changes = describeBindingChanges('a', ['empty', 'other', 'off'], snapshot, true);
  assert.deepEqual(changes.map((change) => change.action), ['attach', 'replace', 'detach', 'enable']);
  assert.deepEqual(changes[1].assetIds, ['old']);
  assert.deepEqual(describeBindingChanges('a', ['removed', 'off'], snapshot), []);
});

test('runtime persists asset management across reopen and deletion retains the original source file', async (t) => {
  const { createRuntime } = require('../src/runtime/runtime');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-asset-management-runtime-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.csv');
  fs.writeFileSync(source, 'en,ja\nsave,保存する');
  let runtime = await createRuntime({ appDataRoot: path.join(dir, 'app'), secretStore: new Map() });
  try {
    const asset = runtime.importAssetFromPath('glossary', source);
    const profile = runtime.saveProfile({ name: 'Asset workflow', useUploadedGlossary: false, userPrompt: '{{source-text}}' });
    const initialProfiles = runtime.getAppState().contextBuilder.profiles;
    runtime.saveAssetDetails({ assetId: asset.id, name: 'Shared terminology', expectedName: asset.name,
      profileIds: [profile.id], expectedBindings: snapshotAssetBindings(initialProfiles, 'glossary'), enableBindings: true });
    runtime.dispose();
    runtime = await createRuntime({ appDataRoot: path.join(dir, 'app'), secretStore: new Map() });
    const view = runtime.getAppState().contextBuilder;
    assert.equal(view.assets.find((item) => item.id === asset.id).name, 'Shared terminology');
    const reloaded = view.profiles.find((item) => item.id === profile.id);
    assert.equal(reloaded.assetSelections.glossaryAssetId, asset.id);
    assert.equal(reloaded.useUploadedGlossary, true);
    assert.throws(() => runtime.deleteAsset(asset.id), /Asset workflow/);
    runtime.saveAssetDetails({ assetId: asset.id, name: 'Shared terminology', expectedName: 'Shared terminology',
      profileIds: [], expectedBindings: snapshotAssetBindings(view.profiles, 'glossary') });
    runtime.deleteAsset(asset.id);
    assert.equal(fs.existsSync(source), true);
    assert.equal(fs.existsSync(asset.storedPath), false);
    assert.equal(runtime.getAppState().contextBuilder.assets.some((item) => item.id === asset.id), false);
  } finally { runtime.dispose(); }
});
