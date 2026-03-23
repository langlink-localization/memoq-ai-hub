import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APP_SECTIONS,
  buildAdvancedModelRows,
  buildAssetLibraryEntries,
  buildCollapsiblePanelEntries,
  buildDefaultPresetProfile,
  DEFAULT_PRESET_BATCH_USER_PROMPT,
  DEFAULT_PRESET_SINGLE_USER_PROMPT,
  buildHistoryPromptItems,
  getHistoryRenderedUserPrompt,
  shouldShowHistoryActualSentContent,
  buildPromptResources,
  buildProviderModelTableRows,
  getPanelColumnSpan
} from '../src/renderer/src/appShell.mjs';

test('app sections expose assets as a first-class top-level module', () => {
  assert.deepEqual(
    APP_SECTIONS.map((item) => item.key),
    ['dashboard', 'builder', 'assets', 'providers', 'history']
  );
});

test('buildDefaultPresetProfile enables advanced context toggles with source-first preview defaults', () => {
  const profile = buildDefaultPresetProfile();

  assert.equal(profile.profilePresetId, 'default-translation-ops');
  assert.equal(profile.isPresetDerived, true);
  assert.equal(profile.useBestFuzzyTm, true);
  assert.equal(profile.useUploadedGlossary, true);
  assert.equal(profile.useCustomTm, true);
  assert.equal(profile.useBrief, true);
  assert.equal(profile.usePreviewContext, true);
  assert.equal(profile.usePreviewFullText, false);
  assert.equal(profile.usePreviewSummary, true);
  assert.equal(profile.usePreviewAboveBelow, true);
  assert.equal(profile.usePreviewTargetText, true);
  assert.match(profile.translationStyle, /natural, concise/i);
  assert.equal(profile.previewAboveIncludeSource, true);
  assert.equal(profile.previewAboveIncludeTarget, false);
  assert.equal(profile.previewBelowIncludeSource, true);
  assert.equal(profile.previewBelowIncludeTarget, false);
  assert.equal('promptTemplates' in profile, false);
  assert.equal('systemPrompt' in profile, false);
  assert.equal('userPrompt' in profile, false);
});

test('default prompt templates keep volatile terminology and TM details out of freeform prompt text', () => {
  const single = DEFAULT_PRESET_SINGLE_USER_PROMPT;
  const batch = DEFAULT_PRESET_BATCH_USER_PROMPT;

  assert.ok(single.indexOf('Source segment:') < single.indexOf('[Current target text:'));
  assert.ok(single.indexOf('[Current target text:') < single.indexOf('[Above source context:'));
  assert.ok(single.indexOf('[Above source context:') < single.indexOf('[Below source context:'));

  assert.match(single, /segment payload fields for matched terminology, TM hints, and neighboring context/i);
  assert.match(batch, /segment payload fields for matched terminology and TM hints/i);
  assert.ok(batch.indexOf('Source segment:') >= 0);
  assert.equal(single.includes('[Required terminology:'), false);
  assert.equal(single.includes('[Best memoQ TM match:'), false);
  assert.equal(batch.includes('[Required terminology:'), false);
  assert.equal(batch.includes('[Best memoQ TM match:'), false);
  assert.doesNotMatch(single, /\[memoQ TM match:/);
  assert.doesNotMatch(single, /\[Uploaded custom TM:/);
  assert.doesNotMatch(single, /\[Terminology rules:/);
  assert.doesNotMatch(batch, /\[memoQ TM match:/);
  assert.doesNotMatch(batch, /\[Uploaded custom TM:/);
  assert.doesNotMatch(batch, /\[Terminology rules:/);
  assert.doesNotMatch(single, /\[Custom TM reference:/);
  assert.doesNotMatch(batch, /\[Custom TM reference:/);
  assert.doesNotMatch(single, /\[Project brief:/);
  assert.doesNotMatch(batch, /\[Project brief:/);
  assert.doesNotMatch(single, /\[Document summary:/);
  assert.doesNotMatch(batch, /\[Document summary:/);
});

test('buildPromptResources projects prompt content out of profiles', () => {
  const resources = buildPromptResources([
    {
      id: 'profile-1',
      name: 'Legal EN->DE',
      systemPrompt: 'System text',
      userPrompt: 'User text'
    }
  ]);

  assert.equal(resources.length, 1);
  assert.equal(resources[0].id, 'prompt:profile-1');
  assert.equal(resources[0].profileId, 'profile-1');
  assert.equal(resources[0].name, 'Legal EN->DE');
  assert.equal(resources[0].systemPrompt, 'System text');
  assert.equal(resources[0].userPrompt, 'User text');
});

test('buildAssetLibraryEntries annotates asset usage by bound profile', () => {
  const entries = buildAssetLibraryEntries(
    [
      { id: 'asset-1', name: 'Core Glossary', type: 'glossary' },
      { id: 'asset-2', name: 'Retail Brief', type: 'brief' }
    ],
    [
      {
        id: 'profile-1',
        name: 'Retail',
        assetBindings: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }]
      },
      {
        id: 'profile-2',
        name: 'Support',
        assetBindings: [{ assetId: 'asset-1' }]
      }
    ]
  );

  assert.deepEqual(entries[0].boundProfileNames, ['Retail', 'Support']);
  assert.equal(entries[0].usageCount, 2);
  assert.deepEqual(entries[1].boundProfileNames, ['Retail']);
  assert.equal(entries[1].usageCount, 1);
});

test('buildAdvancedModelRows flattens provider model tuning away from the provider model table', () => {
  const rows = buildAdvancedModelRows([
    {
      id: 'provider-1',
      name: 'OpenAI',
      models: [
        {
          id: 'model-1',
          modelName: 'gpt-5.4-mini',
          concurrencyLimit: 3,
          retryEnabled: true,
          retryAttempts: 2,
          promptCacheEnabled: true,
          promptCacheTtlHint: '5m',
          rateLimitHint: '120 rpm',
          notes: 'Primary route'
        }
      ]
    }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].providerName, 'OpenAI');
  assert.equal(rows[0].modelName, 'gpt-5.4-mini');
  assert.equal(rows[0].concurrencyLimit, 3);
  assert.equal(rows[0].promptCacheEnabled, true);
  assert.equal(rows[0].notes, 'Primary route');
});

test('buildCollapsiblePanelEntries exposes compact avatars and accessibility labels for collapsed side panels', () => {
  const entries = buildCollapsiblePanelEntries(
    [
      { id: 'profile-1', name: 'Legal Review' },
      { id: 'profile-2', name: 'Support' }
    ],
    {
      selectedId: 'profile-1',
      emptyLabel: 'Untitled Profile'
    }
  );

  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, 'profile-1');
  assert.equal(entries[0].label, 'Legal Review');
  assert.equal(entries[0].avatarLabel, 'LR');
  assert.equal(entries[0].isSelected, true);
  assert.equal(entries[1].avatarLabel, 'S');
});

test('buildProviderModelTableRows marks the default model outside of the actions column', () => {
  const rows = buildProviderModelTableRows({
    defaultModelId: 'model-2',
    models: [
      { id: 'model-1', modelName: 'gpt-4.1-mini', enabled: true },
      { id: 'model-2', modelName: 'gpt-5.4-mini', enabled: true }
    ]
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].isDefault, false);
  assert.equal(rows[1].isDefault, true);
});

test('getPanelColumnSpan narrows collapsed module sidebars without hiding them', () => {
  assert.equal(getPanelColumnSpan(false), 6);
  assert.equal(getPanelColumnSpan(true), 4);
});

test('getHistoryRenderedUserPrompt prefers single promptView content', () => {
  assert.equal(
    getHistoryRenderedUserPrompt({
      promptView: {
        single: {
          userPrompt: 'Source:\nHello world'
        }
      }
    }),
    'Source:\nHello world'
  );
});

test('getHistoryRenderedUserPrompt prefers the captured batch JSON payload when available', () => {
  assert.equal(
    getHistoryRenderedUserPrompt({
      promptView: {
        batch: {
          userPrompt: '{"schemaVersion":"structured-v2"}',
          items: [
            { userPrompt: 'Segment One' },
            { userPrompt: 'Segment Two' }
          ]
        }
      }
    }),
    '{"schemaVersion":"structured-v2"}'
  );
});

test('getHistoryRenderedUserPrompt summarizes batch promptView items when the full payload is unavailable', () => {
  assert.equal(
    getHistoryRenderedUserPrompt({
      promptView: {
        batch: {
          items: [
            { userPrompt: 'Segment One' },
            { userPrompt: 'Segment Two' }
          ]
        }
      }
    }),
    'Per-segment prompt instructions are shown below for batch requests.'
  );
});

test('buildHistoryPromptItems prefers promptView content for single records and preserves legacy fallback behavior', () => {
  assert.deepEqual(
    buildHistoryPromptItems({
      promptView: {
        single: {
          sourceText: 'Hello world',
          userPrompt: 'Source:\nHello world'
        }
      },
      segments: [
        {
          segmentIndex: 0,
          sourceText: 'Hello world'
        }
      ]
    }),
    [
      {
        key: 'single-0',
        segmentIndex: 0,
        sourceText: 'Hello world',
        promptInstructions: 'Source:\nHello world'
      }
    ]
  );

  assert.deepEqual(
    buildHistoryPromptItems({
      segments: [
        {
          segmentIndex: 0,
          sourceText: 'Legacy source'
        }
      ]
    }),
    [
      {
        key: 'segment-0',
        segmentIndex: 0,
        sourceText: 'Legacy source',
        promptInstructions: ''
      }
    ]
  );
});

test('buildHistoryPromptItems uses batch promptView items for sent prompt instructions', () => {
  assert.deepEqual(
    buildHistoryPromptItems({
      promptView: {
        batch: {
          items: [
            { index: 0, sourceText: 'One', userPrompt: 'Segment One' },
            { index: 1, sourceText: 'Two', userPrompt: 'Segment Two' }
          ]
        }
      }
    }),
    [
      {
        key: 'batch-0',
        segmentIndex: 0,
        sourceText: 'One',
        promptInstructions: 'Segment One'
      },
      {
        key: 'batch-1',
        segmentIndex: 1,
        sourceText: 'Two',
        promptInstructions: 'Segment Two'
      }
    ]
  );
});

test('shouldShowHistoryActualSentContent hides single payloads and keeps batch payloads', () => {
  assert.equal(
    shouldShowHistoryActualSentContent(
      {
        requestMode: 'single',
        promptView: {
          single: {
            sourceText: 'One',
            userPrompt: 'Prompt One'
          }
        }
      },
      [{ segmentIndex: 0, sourceText: 'One' }]
    ),
    false
  );

  assert.equal(
    shouldShowHistoryActualSentContent(
      {
        requestMode: 'batch',
        promptView: {
          batch: {
            items: [
              { index: 0, sourceText: 'One', userPrompt: 'Prompt One' },
              { index: 1, sourceText: 'Two', userPrompt: 'Prompt Two' }
            ]
          }
        }
      },
      [{ segmentIndex: 0, sourceText: 'One' }, { segmentIndex: 1, sourceText: 'Two' }]
    ),
    true
  );
});
