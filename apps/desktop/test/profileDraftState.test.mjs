import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyProfileExecutionSelection,
  buildAssetBindingsFromSelections,
  buildAssetSelectionsFromBindings,
  buildExecutionOptionValue,
  buildProfileFingerprint,
  createEmptyProfileDraft,
  getProfileExecutionSelection,
  isSelectableProfileProvider
} from '../src/renderer/src/profileDraftState.mjs';

test('profile draft state aligns one execution selection across all runtime routes', () => {
  const selected = applyProfileExecutionSelection({}, buildExecutionOptionValue('provider-1', 'model-1'));

  assert.equal(selected.providerId, 'provider-1');
  assert.equal(selected.interactiveProviderId, 'provider-1');
  assert.equal(selected.pretranslateProviderId, 'provider-1');
  assert.equal(selected.fallbackProviderId, 'provider-1');
  assert.equal(selected.interactiveModelId, 'model-1');
  assert.equal(selected.pretranslateModelId, 'model-1');
  assert.equal(selected.fallbackModelId, 'model-1');
  assert.equal(getProfileExecutionSelection(selected), 'provider-1::model-1');
});

test('profile draft state round-trips glossary and custom TM selections', () => {
  const selections = {
    glossaryAssetId: 'asset-glossary',
    customTmAssetId: 'asset-tm'
  };
  const bindings = buildAssetBindingsFromSelections(selections);

  assert.deepEqual(bindings, [
    { assetId: 'asset-glossary', purpose: 'glossary' },
    { assetId: 'asset-tm', purpose: 'custom_tm' }
  ]);
  assert.deepEqual(buildAssetSelectionsFromBindings(bindings), selections);
});

test('profile draft defaults and fingerprints preserve editor change detection', () => {
  const t = (key) => key;
  const profile = createEmptyProfileDraft(t);

  assert.equal(profile.usePreviewContext, true);
  assert.equal(profile.previewAboveIncludeSource, true);
  assert.equal(isSelectableProfileProvider({ id: 'draft_provider_1' }), false);
  assert.equal(isSelectableProfileProvider({ id: 'provider-1' }), true);
  assert.equal(buildProfileFingerprint(profile), buildProfileFingerprint(structuredClone(profile)));
  assert.notEqual(buildProfileFingerprint(profile), buildProfileFingerprint({ ...profile, description: 'Changed' }));
});
