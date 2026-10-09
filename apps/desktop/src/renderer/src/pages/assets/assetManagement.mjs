export function snapshotAssetBindings(profiles, type) {
  const field = type === 'glossary' ? 'useUploadedGlossary' : 'useCustomTm';
  return profiles.map((profile) => ({ profileId: profile.id, enabled: profile[field] !== false,
    assetIds: (profile.assetBindings || []).filter((binding) => binding.purpose === type).map((binding) => binding.assetId).sort() }));
}

export function describeBindingChanges(assetId, selectedIds, snapshot, enableBindings = false) {
  const selected = new Set(selectedIds);
  return snapshot.flatMap((entry) => {
    const before = entry.assetIds.includes(assetId);
    if (selected.has(entry.profileId) && !before) return [{ ...entry, action: entry.assetIds.length ? 'replace' : 'attach' }];
    if (!selected.has(entry.profileId) && before) return [{ ...entry, action: 'detach' }];
    if (selected.has(entry.profileId) && enableBindings && !entry.enabled) return [{ ...entry, action: 'enable' }];
    return [];
  });
}
