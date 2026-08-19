export const ASSET_CATEGORIES = [
  { id: 'all', assetType: '', translationKey: 'context.assetCategoryAll' },
  { id: 'glossary', assetType: 'glossary', translationKey: 'context.assetType.glossary' },
  { id: 'custom_tm', assetType: 'custom_tm', translationKey: 'context.assetType.custom_tm' }
];

export function buildAssetUsageMap(profileItems = [], fallbackLabel = '-') {
  return profileItems.reduce((usageMap, profile) => {
    for (const binding of profile?.assetBindings || []) {
      const existing = usageMap.get(binding.assetId) || [];
      usageMap.set(binding.assetId, [...existing, profile.name || fallbackLabel]);
    }
    return usageMap;
  }, new Map());
}

export function buildAssetPreviewRows(preview) {
  if (!Array.isArray(preview?.rows)) {
    return [];
  }

  return preview.rows.map((row, index) => ({ key: row?.id || `row-${index}`, ...row }));
}

export function formatAssetPreviewMapping(mapping = {}) {
  return Object.entries(mapping).map(([role, meta]) => ({
    key: role,
    role,
    columnName: meta?.columnName || '-',
    confidence: meta?.confidence || 'low'
  }));
}

export function getAssetPreviewConfidenceLabel(t, confidence = {}) {
  const level = String(confidence?.level || 'low');
  return t(`context.assetPreviewConfidence.${level}`);
}

export function hasTbStructurePreview(preview = {}) {
  return preview?.assetType === 'glossary' && preview?.tbStructureAvailable === true;
}

export function canApplyTbStructurePreview(preview = {}) {
  return hasTbStructurePreview(preview)
    && preview?.tbStructureApplied !== true
    && String(preview?.tbStructuringMode || '').trim() !== 'manual_mapping';
}
