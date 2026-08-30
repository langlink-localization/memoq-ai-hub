import { useMemo, useState } from 'react';
import {
  discardDraftEntry,
  getResolvedRecords,
  hasDraftChanges,
  resolveSelectedRecordId,
  updateDraftEntry
} from '../editorDrafts.mjs';
import { getPreferredProviderModel } from '../providerDraftState.mjs';
import {
  applyProfileExecutionSelection,
  applyProfileProviderId,
  buildAssetBindingsFromSelections,
  buildAssetSelectionsFromBindings,
  buildExecutionOptionValue,
  buildProfileFingerprint,
  createBlankProfile,
  createEmptyProfileDraft,
  getProfileExecutionSelection,
  getProfileProviderId,
  isSelectableProfileProvider
} from '../profileDraftState.mjs';

// Owns the profile domain: draft records and dirty tracking, execution-route
// patching, asset binding toggles, save/duplicate/create/delete flows, default
// selection, and the translation-cache bypass arm/clear actions. Provider
// items arrive as a dependency for execution-route validation; the app shell
// keeps navigation and the cross-domain save-and-continue flow.
export function useProfileController({ api, t, message, modal, notifyError, refresh, beginPendingOperation, requestNavigation, state, providerItems }) {
  const [profileId, setProfileId] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [duplicatingProfile, setDuplicatingProfile] = useState(false);
  const [creatingProfileKind, setCreatingProfileKind] = useState('');
  const [profileDraftsById, setProfileDraftsById] = useState({});

  const profileItems = useMemo(
    () => getResolvedRecords(state?.contextBuilder?.profiles || [], profileDraftsById),
    [state?.contextBuilder?.profiles, profileDraftsById],
  );
  const defaultProfileId = String(state?.contextBuilder?.defaultProfileId || '').trim();
  const currentProfile = useMemo(
    () => profileItems.find((item) => item.id === resolveSelectedRecordId(profileItems, profileId, defaultProfileId)) || null,
    [defaultProfileId, profileItems, profileId],
  );
  const translationCacheBypassProfileIds = useMemo(
    () => new Set(state?.contextBuilder?.translationCacheBypassProfileIds || []),
    [state?.contextBuilder?.translationCacheBypassProfileIds],
  );
  const currentProfileTranslationCacheBypassPending = currentProfile
    ? translationCacheBypassProfileIds.has(currentProfile.id)
    : false;
  const currentProfileDirty = Boolean(currentProfile?.id && hasDraftChanges(profileDraftsById, currentProfile.id));

  async function patchCurrentProfile(field, value) {
    let nextProfile;
    let dirtyFields = [field];
    if (field === 'providerId') {
      const provider = providerItems.find((item) => item.id === value && isSelectableProfileProvider(item));
      if (!provider) {
        message.error(t('context.executionProviderUnavailable'));
        return;
      }
      const preferredModel = getPreferredProviderModel(provider);
      nextProfile = applyProfileExecutionSelection(currentProfile, buildExecutionOptionValue(value, preferredModel?.id || ''));
      dirtyFields = ['providerId', 'interactiveProviderId', 'interactiveModelId', 'pretranslateProviderId', 'pretranslateModelId', 'fallbackProviderId', 'fallbackModelId'];
    } else if (field === 'executionSelection') {
      nextProfile = applyProfileExecutionSelection(currentProfile, value);
      dirtyFields = ['providerId', 'interactiveProviderId', 'interactiveModelId', 'pretranslateProviderId', 'pretranslateModelId', 'fallbackProviderId', 'fallbackModelId'];
    } else if (['interactiveProviderId', 'pretranslateProviderId', 'fallbackProviderId'].includes(field)) {
      const provider = providerItems.find((item) => item.id === value && isSelectableProfileProvider(item));
      if (!provider) {
        message.error(t('context.executionProviderUnavailable'));
        return;
      }

      const routeModelField = field === 'interactiveProviderId'
        ? 'interactiveModelId'
        : field === 'pretranslateProviderId'
          ? 'pretranslateModelId'
          : 'fallbackModelId';
      const preferredModel = getPreferredProviderModel(provider, currentProfile?.[routeModelField]);
      nextProfile = {
        ...currentProfile,
        [field]: value,
        [routeModelField]: preferredModel?.id || '',
        ...(field === 'interactiveProviderId' || !currentProfile?.providerId ? { providerId: String(value || '').trim() } : {})
      };
      dirtyFields = [field, routeModelField, ...(field === 'interactiveProviderId' || !currentProfile?.providerId ? ['providerId'] : [])];
    } else if (['interactiveModelId', 'pretranslateModelId', 'fallbackModelId'].includes(field)) {
      nextProfile = {
        ...currentProfile,
        [field]: value,
        ...(field === 'interactiveModelId' && currentProfile?.interactiveProviderId ? { providerId: currentProfile.interactiveProviderId } : {})
      };
      dirtyFields = [field, ...(field === 'interactiveModelId' && currentProfile?.interactiveProviderId ? ['providerId'] : [])];
    } else if (field === 'assetBindings') {
      const nextBindings = Array.isArray(value) ? value : [];
      nextProfile = {
        ...currentProfile,
        assetBindings: nextBindings,
        assetSelections: buildAssetSelectionsFromBindings(nextBindings)
      };
      dirtyFields = ['assetBindings', 'assetSelections'];
    } else if (field === 'assetSelections') {
      const nextSelections = value && typeof value === 'object' ? value : {};
      nextProfile = {
        ...currentProfile,
        assetSelections: nextSelections,
        assetBindings: buildAssetBindingsFromSelections(nextSelections)
      };
      dirtyFields = ['assetSelections', 'assetBindings'];
    } else {
      nextProfile = { ...currentProfile, [field]: value };
    }

    setProfileDraftsById((current) => updateDraftEntry(
      current,
      currentProfile,
      () => nextProfile,
      { fingerprintFn: buildProfileFingerprint, dirtyFields }
    ));
  }

  async function saveCurrentProfile() {
    if (!currentProfile) return false;
    const endPending = beginPendingOperation('profile-save', setSavingProfile);
    if (!endPending) return false;
    try {
      const selectedProvider = providerItems.find((provider) => (
        provider.id === getProfileProviderId(currentProfile) && isSelectableProfileProvider(provider)
      ));
      if (getProfileProviderId(currentProfile) && !selectedProvider) {
        throw new Error(t('context.executionProviderUnavailable'));
      }
      const preferredModel = getPreferredProviderModel(selectedProvider);
      const currentExecutionSelection = getProfileExecutionSelection(currentProfile);
      const executionModelId = String(currentExecutionSelection?.split('::')[1] || '').trim();
      const hasValidExecutionModel = selectedProvider && (selectedProvider.models || []).some((model) => model.id === executionModelId && model.enabled !== false);
      const profileToSave = ((!currentExecutionSelection || !hasValidExecutionModel) && selectedProvider && preferredModel)
        ? applyProfileExecutionSelection(currentProfile, buildExecutionOptionValue(selectedProvider.id, preferredModel.id))
        : currentProfile;
      await api.saveProfile(applyProfileProviderId(profileToSave, getProfileProviderId(profileToSave)));
      setProfileDraftsById((current) => discardDraftEntry(current, currentProfile.id));
      message.success(t('feedback.actionSucceeded'));
      await refresh();
      return true;
    } catch (saveError) {
      notifyError(saveError);
      return false;
    } finally {
      endPending();
    }
  }

  function discardCurrentProfileChangesNow() {
    if (!currentProfile) return;
    setProfileDraftsById((current) => discardDraftEntry(current, currentProfile.id));
  }

  function confirmDiscardCurrentProfileChanges() {
    if (!currentProfile || !currentProfileDirty) return;
    modal.confirm({
      title: t('navigation.discardProfileTitle'),
      content: t('navigation.discardProfileDescription', { name: currentProfile.name || t('context.unnamedProfile') }),
      okText: t('context.discardChanges'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: discardCurrentProfileChangesNow
    });
  }

  async function duplicateCurrentProfile() {
    if (!currentProfile) return;
    const endPending = beginPendingOperation('profile-duplicate', setDuplicatingProfile);
    if (!endPending) return;
    try {
      await api.duplicateProfile(currentProfile.id);
      await refresh();
    } catch (duplicateError) {
      notifyError(duplicateError);
    } finally {
      endPending();
    }
  }

  async function setCurrentProfileAsDefault() {
    if (!currentProfile || !api?.setDefaultProfile) return;
    try {
      await api.setDefaultProfile(currentProfile.id);
      await refresh();
      setProfileId(currentProfile.id);
      message.success(t('feedback.actionSucceeded'));
    } catch (setDefaultError) {
      notifyError(setDefaultError);
    }
  }

  async function bypassTranslationCacheForCurrentProfileOnce() {
    if (!currentProfile || typeof api?.bypassTranslationCacheOnce !== 'function') {
      return;
    }

    try {
      await api.bypassTranslationCacheOnce(currentProfile.id);
      message.success(t('context.translationCacheBypassArmed'));
      await refresh();
    } catch (bypassError) {
      notifyError(bypassError);
    }
  }

  function confirmClearTranslationCache() {
    if (typeof api?.clearTranslationCache !== 'function') {
      return;
    }

    modal.confirm({
      title: t('context.clearTranslationCacheTitle'),
      content: t('context.clearTranslationCacheConfirm'),
      okText: t('context.clearTranslationCacheAction'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const result = await api.clearTranslationCache();
          message.success(t('context.clearTranslationCacheSuccess', { count: Number(result?.clearedCount || 0) }));
          await refresh();
        } catch (clearError) {
          notifyError(clearError);
        }
      }
    });
  }

  function toggleAssetBinding(asset, checked) {
    if (!currentProfile || !asset?.id) {
      return;
    }

    const existing = Array.isArray(currentProfile.assetBindings) ? currentProfile.assetBindings : [];
    const nextBindings = checked
      ? [...existing.filter((binding) => binding.assetId !== asset.id), { assetId: asset.id, purpose: asset.type }]
      : existing.filter((binding) => binding.assetId !== asset.id);

    void patchCurrentProfile('assetBindings', nextBindings);
  }

  async function createNewProfile() {
    const endPending = beginPendingOperation('profile-create', setCreatingProfileKind, 'preset');
    if (!endPending) return;
    try {
      const created = await api.saveProfile(createBlankProfile(t));
      await refresh();
      requestNavigation('profile', created.id);
      message.success(t('feedback.profileCreatedFromPreset'));
    } catch (createError) {
      notifyError(createError);
    } finally {
      endPending();
    }
  }

  async function createEmptyProfile() {
    const endPending = beginPendingOperation('profile-create', setCreatingProfileKind, 'blank');
    if (!endPending) return;
    try {
      const created = await api.saveProfile(createEmptyProfileDraft(t));
      await refresh();
      requestNavigation('profile', created.id);
      message.success(t('feedback.actionSucceeded'));
    } catch (createError) {
      notifyError(createError);
    } finally {
      endPending();
    }
  }

  function confirmDeleteProfile() {
    if (!currentProfile) return;
    modal.confirm({
      title: t('context.deleteProfile'),
      content: t('context.confirmDeleteProfile', { name: currentProfile.name }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.deleteProfile(currentProfile.id);
          message.success(t('context.profileDeleted'));
          await refresh();
        } catch (deleteError) {
          notifyError(deleteError, t('feedback.blockedDelete'));
        }
      }
    });
  }

  return {
    profileId,
    setProfileId,
    profileDraftsById,
    setProfileDraftsById,
    profileItems,
    defaultProfileId,
    currentProfile,
    currentProfileDirty,
    savingProfile,
    duplicatingProfile,
    creatingProfileKind,
    translationCacheBypassPending: currentProfileTranslationCacheBypassPending,
    patchCurrentProfile,
    saveCurrentProfile,
    discardCurrentProfileChangesNow,
    confirmDiscardCurrentProfileChanges,
    duplicateCurrentProfile,
    setCurrentProfileAsDefault,
    bypassTranslationCacheForCurrentProfileOnce,
    confirmClearTranslationCache,
    toggleAssetBinding,
    createNewProfile,
    createEmptyProfile,
    confirmDeleteProfile
  };
}
