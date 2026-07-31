import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DASHBOARD_STATUS_KEYS,
  getDashboardStatusSnapshot,
  resetDashboardStatusStore,
  setDashboardStatusSnapshot,
  subscribeDashboardStatus
} from '../src/renderer/src/pages/dashboard/dashboardStatusStore.mjs';

function createStatusState(overrides = {}) {
  return {
    startup: { status: 'ready' },
    dashboard: { runtimeStatus: { connectionStatus: 'Connected' }, notices: [] },
    integration: { status: 'installed' },
    previewBridge: { status: 'connected' },
    updateCenter: { updateStatus: 'up-to-date' },
    historyExplorer: { items: [] },
    ...overrides
  };
}

test('dashboard status store isolates polling commits from unrelated page state', () => {
  resetDashboardStatusStore();
  let dashboardRenderSignals = 0;
  const unsubscribe = subscribeDashboardStatus(() => {
    dashboardRenderSignals += 1;
  });

  const initialState = createStatusState();
  assert.equal(setDashboardStatusSnapshot(initialState), true);
  assert.equal(dashboardRenderSignals, 1);
  assert.deepEqual(Object.keys(getDashboardStatusSnapshot()), DASHBOARD_STATUS_KEYS);

  const stableSnapshot = getDashboardStatusSnapshot();
  assert.equal(setDashboardStatusSnapshot({
    ...initialState,
    historyExplorer: { items: [{ id: 'history-only-change' }] }
  }), false);
  assert.equal(getDashboardStatusSnapshot(), stableSnapshot);
  assert.equal(dashboardRenderSignals, 1);

  assert.equal(setDashboardStatusSnapshot(createStatusState({
    dashboard: { runtimeStatus: { connectionStatus: 'Disconnected' }, notices: [] }
  })), true);
  assert.equal(dashboardRenderSignals, 2);

  unsubscribe();
  setDashboardStatusSnapshot(createStatusState({ startup: { status: 'starting' } }));
  assert.equal(dashboardRenderSignals, 2);
  resetDashboardStatusStore();
});
