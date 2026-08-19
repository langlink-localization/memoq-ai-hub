import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSET_CATEGORIES,
  buildAssetPreviewRows,
  buildAssetUsageMap,
  canApplyTbStructurePreview,
  formatAssetPreviewMapping,
  hasTbStructurePreview
} from '../src/renderer/src/pages/assets/assetPresentation.mjs';

test('asset presentation projects profile usage without mutating profile records', () => {
  const usage = buildAssetUsageMap([
    { name: 'Profile A', assetBindings: [{ assetId: 'asset-1' }] },
    { name: 'Profile B', assetBindings: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }] }
  ]);

  assert.deepEqual(usage.get('asset-1'), ['Profile A', 'Profile B']);
  assert.deepEqual(usage.get('asset-2'), ['Profile B']);
  assert.deepEqual(ASSET_CATEGORIES.map((item) => item.id), ['all', 'glossary', 'custom_tm']);
});

test('asset presentation assigns stable preview row keys and mapping defaults', () => {
  assert.deepEqual(buildAssetPreviewRows({ rows: [{ id: 'row-id', source: 'A' }, { source: 'B' }] }), [
    { key: 'row-id', id: 'row-id', source: 'A' },
    { key: 'row-1', source: 'B' }
  ]);
  assert.deepEqual(formatAssetPreviewMapping({ source: { columnName: 'Source' }, target: {} }), [
    { key: 'source', role: 'source', columnName: 'Source', confidence: 'low' },
    { key: 'target', role: 'target', columnName: '-', confidence: 'low' }
  ]);
});

test('asset presentation exposes explicit TB structure apply eligibility', () => {
  const preview = { assetType: 'glossary', tbStructureAvailable: true, tbStructureApplied: false };

  assert.equal(hasTbStructurePreview(preview), true);
  assert.equal(canApplyTbStructurePreview(preview), true);
  assert.equal(canApplyTbStructurePreview({ ...preview, tbStructuringMode: 'manual_mapping' }), false);
  assert.equal(canApplyTbStructurePreview({ ...preview, tbStructureApplied: true }), false);
});
