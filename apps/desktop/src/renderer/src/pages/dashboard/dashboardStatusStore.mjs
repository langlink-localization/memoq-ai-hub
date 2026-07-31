import { mergeChangedStateSlices } from '../../uiBehavior.mjs';

export const DASHBOARD_STATUS_KEYS = ['startup', 'dashboard', 'integration', 'previewBridge', 'updateCenter'];

let dashboardStatusSnapshot = null;
const dashboardStatusListeners = new Set();

function selectDashboardStatus(state) {
  if (!state) return null;
  return Object.fromEntries(DASHBOARD_STATUS_KEYS.map((key) => [key, state[key]]));
}

export function getDashboardStatusSnapshot() {
  return dashboardStatusSnapshot;
}

export function setDashboardStatusSnapshot(state) {
  const incomingSnapshot = selectDashboardStatus(state);
  const nextSnapshot = mergeChangedStateSlices(
    dashboardStatusSnapshot,
    incomingSnapshot,
    DASHBOARD_STATUS_KEYS
  );

  if (nextSnapshot === dashboardStatusSnapshot) return false;

  dashboardStatusSnapshot = nextSnapshot;
  for (const listener of dashboardStatusListeners) listener();
  return true;
}

export function subscribeDashboardStatus(listener) {
  dashboardStatusListeners.add(listener);
  return () => dashboardStatusListeners.delete(listener);
}

export function resetDashboardStatusStore() {
  dashboardStatusSnapshot = null;
  dashboardStatusListeners.clear();
}
