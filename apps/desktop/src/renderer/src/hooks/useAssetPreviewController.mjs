import { useRef, useState } from 'react';
import { runLatestRequest } from '../requestLifecycle.mjs';
import { useRequestLifecycle } from './useRequestLifecycle.mjs';

// Owns the asset preview drawer state: open/close, preview loading, the manual
// TB mapping draft, and the apply/save TB-structure actions. The drawer JSX
// lives in components/AssetPreviewDrawer.jsx and consumes the returned
// controller object.
export function useAssetPreviewController({ api, t, message, notifyError, refresh, assets }) {
  const previewLifecycle = useRequestLifecycle();
  const savingRef = useRef(false);
  const [assetPreviewOpen, setAssetPreviewOpen] = useState(false);
  const [assetPreviewLoading, setAssetPreviewLoading] = useState(false);
  const [assetPreviewRecord, setAssetPreviewRecord] = useState(null);
  const [assetPreviewData, setAssetPreviewData] = useState(null);
  const [assetPreviewManualDraft, setAssetPreviewManualDraft] = useState({
    srcColumn: '',
    tgtColumn: '',
    sourceLanguage: '',
    targetLanguage: ''
  });
  const [assetPreviewSaving, setAssetPreviewSaving] = useState(false);

  function closeAssetPreview() {
    if (savingRef.current) return;
    previewLifecycle.invalidate();
    setAssetPreviewLoading(false);
    setAssetPreviewOpen(false);
    setAssetPreviewData(null);
    setAssetPreviewRecord(null);
  }

  async function openAssetPreview(assetId, options = {}) {
    const normalizedAssetId = String(assetId || '').trim();
    if (!normalizedAssetId || savingRef.current) {
      return;
    }

    const fallbackAsset = options.fallbackAsset || assets.find((asset) => asset.id === normalizedAssetId) || null;
    setAssetPreviewOpen(true);
    setAssetPreviewRecord(fallbackAsset);
    setAssetPreviewData(null);
    setAssetPreviewManualDraft({
      srcColumn: '',
      tgtColumn: '',
      sourceLanguage: '',
      targetLanguage: ''
    });

    previewLifecycle.invalidate();
    setAssetPreviewLoading(false);
    if (typeof api?.getAssetPreview !== 'function') {
      setAssetPreviewData({ unsupported: true });
      return;
    }

    setAssetPreviewLoading(true);
    return runLatestRequest(previewLifecycle, {
      load: () => api.getAssetPreview(normalizedAssetId),
      resolve: (preview) => {
        setAssetPreviewData(preview || {});
        setAssetPreviewManualDraft({
          srcColumn: String(preview?.manualMapping?.srcColumn || ''),
          tgtColumn: String(preview?.manualMapping?.tgtColumn || ''),
          sourceLanguage: String(preview?.languagePair?.source || ''),
          targetLanguage: String(preview?.languagePair?.target || '')
        });
      },
      reject: (previewError) => {
        setAssetPreviewData({ error: String(previewError?.message || t('feedback.actionFailed')) });
      },
      settle: () => setAssetPreviewLoading(false)
    });
  }

  async function saveAssetPreviewTbConfig() {
    if (!assetPreviewRecord?.id || typeof api?.saveAssetTbConfig !== 'function') {
      return;
    }

    if (savingRef.current || assetPreviewLoading) return;
    savingRef.current = true;
    setAssetPreviewSaving(true);
    try {
      await api.saveAssetTbConfig(assetPreviewRecord.id, {
        manualMapping: {
          srcColumn: assetPreviewManualDraft.srcColumn,
          tgtColumn: assetPreviewManualDraft.tgtColumn
        },
        languagePair: {
          source: assetPreviewManualDraft.sourceLanguage,
          target: assetPreviewManualDraft.targetLanguage
        }
      });
      message.success(t('feedback.actionSucceeded'));
      await refresh();
      savingRef.current = false;
      await openAssetPreview(assetPreviewRecord.id, { fallbackAsset: assetPreviewRecord });
    } catch (saveError) {
      notifyError(saveError);
    } finally {
      savingRef.current = false;
      setAssetPreviewSaving(false);
    }
  }

  async function applyDetectedAssetPreviewTbStructure() {
    if (!assetPreviewRecord?.id || typeof api?.applyAssetTbStructure !== 'function' || !assetPreviewData?.tbStructure) {
      return;
    }

    if (savingRef.current || assetPreviewLoading) return;
    savingRef.current = true;
    setAssetPreviewSaving(true);
    try {
      await api.applyAssetTbStructure(assetPreviewRecord.id, {
        tbStructure: assetPreviewData.tbStructure,
        tbStructureFingerprint: assetPreviewData.tbStructureFingerprint,
        tbStructureSummary: assetPreviewData.tbStructureSummary,
        tbStructureSource: assetPreviewData.tbStructureSource,
        languagePair: assetPreviewData.languagePair,
        tbStructureConfidence: assetPreviewData.tbStructureConfidence
      });
      message.success(t('feedback.actionSucceeded'));
      await refresh();
      savingRef.current = false;
      await openAssetPreview(assetPreviewRecord.id, { fallbackAsset: assetPreviewRecord });
    } catch (saveError) {
      notifyError(saveError);
    } finally {
      savingRef.current = false;
      setAssetPreviewSaving(false);
    }
  }

  return {
    assetPreviewOpen,
    assetPreviewLoading,
    assetPreviewRecord,
    assetPreviewData,
    assetPreviewManualDraft,
    assetPreviewSaving,
    retryAssetPreview: () => openAssetPreview(assetPreviewRecord?.id, { fallbackAsset: assetPreviewRecord }),
    setAssetPreviewManualDraft,
    closeAssetPreview,
    openAssetPreview,
    saveAssetPreviewTbConfig,
    applyDetectedAssetPreviewTbStructure
  };
}
