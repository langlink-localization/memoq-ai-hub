import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssetLanguageOptions, getAssetColumnDetails, getConfiguredAssetLanguages, matchesAssetSearch, isValidLanguageColumnDraft } from '../src/renderer/src/pages/assets/assetLanguages.mjs';

test('language picker exposes names and searchable codes and keeps selected regional languages', () => {
  const options = buildAssetLanguageOptions('zh-CN', ['fr-BE']);
  assert.match(options.find((option) => option.value === 'ja').label, /日语/);
  assert.match(options.find((option) => option.value === 'en-US').searchLabel, /English/);
  assert.ok(options.find((option) => option.value === 'fr-BE'));
});

test('mapping save requires two different languages on different columns', () => {
  assert.equal(isValidLanguageColumnDraft([]), false);
  assert.equal(isValidLanguageColumnDraft([{ columnIndex: 0, language: 'en' }]), false);
  assert.equal(isValidLanguageColumnDraft([{ columnIndex: 0, language: 'en' }, { columnIndex: 1, language: 'en' }]), false);
  assert.equal(isValidLanguageColumnDraft([{ columnIndex: 0, language: 'en' }, { columnIndex: 0, language: 'ja' }]), false);
  assert.equal(isValidLanguageColumnDraft([{ columnIndex: 0, language: 'en' }, { columnIndex: 1, language: 'ja' }]), true);
});


test('header checkbox changes samples without removing the first data row', () => {
  const preview = { rawColumnDetails: [{ columnIndex: 0, columnName: 'save', samples: ['open', 'close', 'quit'] }] };
  assert.deepEqual(getAssetColumnDetails(preview, false)[0], { columnIndex: 0, columnName: '', samples: ['save', 'open', 'close'] });
  assert.deepEqual(getAssetColumnDetails(preview, true), preview.rawColumnDetails);
});

test('asset search combines file, localized type, language, and bound profile terms', () => {
  const asset = { name: 'UI.csv', type: 'glossary', tbLanguageColumns: [{ language: 'en' }, { language: 'ja' }] };
  assert.deepEqual(getConfiguredAssetLanguages(asset), ['en', 'ja']);
  assert.equal(matchesAssetSearch(asset, '日语 产品', ['产品界面'], ['Japanese 日语 ja'], '术语表'), true);
  assert.equal(matchesAssetSearch(asset, '术语 UI', [], [], '术语表'), true);
  assert.equal(matchesAssetSearch(asset, 'French', ['产品界面'], ['Japanese 日语 ja']), false);
  assert.deepEqual(getConfiguredAssetLanguages({ tbLanguagePair: { source: 'en', target: 'zh' } }), ['en', 'zh']);
  assert.deepEqual(getConfiguredAssetLanguages({}), []);
});

test('preview and save validation use canonical languages including exported regional names', async () => {
  const { normalizeLanguageColumnDraft, normalizeRuleLanguagePair, getLanguageColumnIssues } = await import('../src/renderer/src/pages/assets/assetLanguages.mjs');
  const columns = [{ columnIndex: 0, language: 'en_US' }, { columnIndex: 1, language: 'pt_br' }];
  assert.deepEqual(normalizeLanguageColumnDraft(columns), [{ columnIndex: 0, language: 'en-US' }, { columnIndex: 1, language: 'pt-BR' }]);
  assert.deepEqual(normalizeRuleLanguagePair({ source: 'en_US', target: 'pt_br' }), { source: 'en-US', target: 'pt-BR' });
  assert.equal(isValidLanguageColumnDraft(columns), true);
  const duplicate = [...columns, { columnIndex: 2, language: 'pt-BR' }];
  assert.equal(isValidLanguageColumnDraft(duplicate), false);
  assert.deepEqual(getLanguageColumnIssues(duplicate), [{ kind: 'duplicate', columnIndex: 2, otherColumnIndex: 1, language: 'pt-BR' }]);
  assert.equal(isValidLanguageColumnDraft([{ columnIndex: 0, language: 'en' }, { columnIndex: 1, language: 'Reviewer Notes' }]), false);
  assert.equal(buildAssetLanguageOptions('en', ['pt_br']).filter((option) => option.value === 'pt-BR').length, 1);
  assert.equal(buildAssetLanguageOptions('en', ['pt_br']).some((option) => option.value === 'pt_br'), false);
});
