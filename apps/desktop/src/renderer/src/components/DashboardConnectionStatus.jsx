import { useSyncExternalStore } from 'react';
import { Tag } from 'antd';
import {
  getDashboardStatusSnapshot,
  subscribeDashboardStatus
} from '../pages/dashboard/dashboardStatusStore.mjs';
import {
  getRuntimeConnectionColor,
  getRuntimeConnectionLabel
} from '../pages/dashboard/dashboardPresentation.mjs';

export default function DashboardConnectionStatus({ initialState, t }) {
  const dashboardStatus = useSyncExternalStore(
    subscribeDashboardStatus,
    getDashboardStatusSnapshot,
    getDashboardStatusSnapshot
  ) || initialState;
  const connectionStatus = dashboardStatus?.dashboard?.runtimeStatus?.connectionStatus || '';

  return (
    <Tag color={getRuntimeConnectionColor(connectionStatus)}>
      {getRuntimeConnectionLabel(connectionStatus, t)}
    </Tag>
  );
}
