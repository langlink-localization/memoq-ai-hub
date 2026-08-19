'use strict';

const {
  createPresetId,
  normalizePromptPreset,
  restoreBuiltinPromptPreset
} = require('../shared/promptPresets');

function createRuntimePromptPresetStore(options = {}) {
  const { loadState, saveState } = options;
  const timestamp = options.nowIso || (() => new Date().toISOString());

  if (typeof loadState !== 'function' || typeof saveState !== 'function') {
    throw new TypeError('Prompt preset state accessors are required.');
  }

  function save(preset = {}) {
    const state = loadState();
    const existing = state.promptPresets.find((item) => item.id === String(preset.id || '')) || null;
    const next = normalizePromptPreset({
      ...preset,
      id: String(preset.id || '').trim() || createPresetId(),
      builtin: existing?.builtin === true,
      updatedAt: timestamp()
    }, existing || {});
    const index = state.promptPresets.findIndex((item) => item.id === next.id);
    if (index >= 0) state.promptPresets[index] = next;
    else state.promptPresets.push(next);
    saveState(state);
    return next;
  }

  function remove(presetId) {
    const state = loadState();
    const preset = state.promptPresets.find((item) => item.id === String(presetId || ''));
    if (!preset) return { ok: true, deleted: false };
    if (preset.builtin) throw new Error('Built-in prompt presets cannot be deleted; restore the default instead.');
    state.promptPresets = state.promptPresets.filter((item) => item.id !== preset.id);
    saveState(state);
    return { ok: true, deleted: true };
  }

  function restoreBuiltin(presetId) {
    const state = loadState();
    const restored = restoreBuiltinPromptPreset(presetId);
    const index = state.promptPresets.findIndex((item) => item.id === restored.id);
    if (index >= 0) state.promptPresets[index] = restored;
    else state.promptPresets.push(restored);
    saveState(state);
    return restored;
  }

  return { save, remove, restoreBuiltin };
}

module.exports = { createRuntimePromptPresetStore };
