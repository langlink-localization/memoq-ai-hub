export const APP_PAGE_KEYS = ['dashboard', 'providers', 'assets', 'builder', 'history', 'logs'];
export const SHELL_STORAGE_KEY = 'memoq-ai-hub.shell';
export const SHELL_BREAKPOINTS = Object.freeze({
  expandedMin: 1200,
  drawerMax: 768
});

const CHECKLIST_PRESENTATION = {
  'install-plugin': {
    titleKey: 'dashboard.checklistInstallTitle',
    actionKey: 'dashboard.checklistInstallAction',
    emptyKey: 'dashboard.checklistInstallMissing',
    countKey: 'dashboard.checklistInstallReady'
  },
  'provider-hub': {
    titleKey: 'dashboard.checklistProviderTitle',
    actionKey: 'dashboard.checklistProviderAction',
    emptyKey: 'dashboard.checklistProviderMissing',
    countKey: 'dashboard.checklistProviderCount'
  },
  'asset-hub': {
    titleKey: 'dashboard.checklistAssetsTitle',
    actionKey: 'dashboard.checklistAssetsAction',
    emptyKey: 'dashboard.checklistAssetsOptional',
    countKey: 'dashboard.checklistAssetsCount'
  },
  'context-builder': {
    titleKey: 'dashboard.checklistProfileTitle',
    actionKey: 'dashboard.checklistProfileAction',
    emptyKey: 'dashboard.checklistProfileMissing',
    countKey: 'dashboard.checklistProfileCount'
  },
  history: {
    titleKey: 'dashboard.checklistHistoryTitle',
    actionKey: 'dashboard.checklistHistoryAction',
    emptyKey: 'dashboard.checklistHistoryMissing',
    countKey: 'dashboard.checklistHistoryCount'
  }
};

export function normalizePageKey(value, fallback = 'dashboard') {
  const normalized = String(value || '').trim();
  return APP_PAGE_KEYS.includes(normalized) ? normalized : fallback;
}

export function normalizePageScrollPositions(value = {}) {
  const candidate = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(APP_PAGE_KEYS.flatMap((pageKey) => {
    const scrollTop = Number(candidate[pageKey]);
    return Number.isFinite(scrollTop) && scrollTop >= 0
      ? [[pageKey, Math.round(scrollTop)]]
      : [];
  }));
}

export function getPageScrollPosition(value, pageKey) {
  const normalizedKey = String(pageKey || '').trim();
  if (!APP_PAGE_KEYS.includes(normalizedKey)) {
    return 0;
  }
  return normalizePageScrollPositions(value)[normalizedKey] || 0;
}

export function updatePageScrollPosition(value, pageKey, scrollTop) {
  const positions = normalizePageScrollPositions(value);
  const normalizedKey = String(pageKey || '').trim();
  const normalizedScrollTop = Number(scrollTop);
  if (!APP_PAGE_KEYS.includes(normalizedKey) || !Number.isFinite(normalizedScrollTop)) {
    return positions;
  }
  return {
    ...positions,
    [normalizedKey]: Math.max(0, Math.round(normalizedScrollTop))
  };
}

export function normalizeShellState(value = {}) {
  const candidate = value && typeof value === 'object' ? value : {};
  return {
    activePage: normalizePageKey(candidate.activePage),
    navCollapsed: candidate.navCollapsed === true,
    pageScrollPositions: normalizePageScrollPositions(candidate.pageScrollPositions)
  };
}

export function readShellState(storage) {
  try {
    const rawValue = storage?.getItem?.(SHELL_STORAGE_KEY);
    return normalizeShellState(rawValue ? JSON.parse(rawValue) : {});
  } catch {
    return normalizeShellState();
  }
}

export function writeShellState(storage, value) {
  const normalized = normalizeShellState(value);
  try {
    storage?.setItem?.(SHELL_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
  }
  return normalized;
}

export function getShellNavigationMode(viewportWidth) {
  const width = Number(viewportWidth);
  if (!Number.isFinite(width) || width >= SHELL_BREAKPOINTS.expandedMin) {
    return 'expanded';
  }
  return width <= SHELL_BREAKPOINTS.drawerMax ? 'drawer' : 'compact';
}

export function createPendingOperationRegistry() {
  const activeOperations = new Set();
  return {
    begin(key) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey || activeOperations.has(normalizedKey)) {
        return null;
      }
      activeOperations.add(normalizedKey);
      return () => activeOperations.delete(normalizedKey);
    },
    isPending(key) {
      return activeOperations.has(String(key || '').trim());
    }
  };
}

export function mergeChangedStateSlices(currentState, incomingState, keys = []) {
  if (!currentState) return incomingState;
  if (!incomingState) return currentState;

  let changed = false;
  const nextState = { ...currentState };
  for (const key of keys) {
    if (JSON.stringify(currentState[key]) === JSON.stringify(incomingState[key])) continue;
    nextState[key] = incomingState[key];
    changed = true;
  }
  return changed ? nextState : currentState;
}

export function activateOnKeyboard(event, onActivate) {
  if (!event || !['Enter', ' ', 'Spacebar'].includes(event.key)) {
    return false;
  }
  event.preventDefault?.();
  onActivate?.();
  return true;
}

export function resolveDirtyNavigationKind({
  activePage,
  navigationKind,
  currentProviderDirty,
  currentProfileDirty
} = {}) {
  if (navigationKind === 'provider') {
    return currentProviderDirty ? 'provider' : '';
  }
  if (navigationKind === 'profile') {
    return currentProfileDirty ? 'profile' : '';
  }
  if (navigationKind === 'page' && activePage === 'providers' && currentProviderDirty) {
    return 'provider';
  }
  if (navigationKind === 'page' && activePage === 'builder' && currentProfileDirty) {
    return 'profile';
  }
  return '';
}

export function buildDashboardChecklist(items = [], t = (key) => key) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const presentation = CHECKLIST_PRESENTATION[item?.key];
    if (!presentation) {
      return item;
    }
    const count = Number(item?.count || 0);
    return {
      ...item,
      title: t(presentation.titleKey, { step: index + 1 }),
      subtitle: count > 0 || item?.completed === true
        ? t(presentation.countKey, { count })
        : t(presentation.emptyKey),
      actionLabel: t(presentation.actionKey)
    };
  });
}
