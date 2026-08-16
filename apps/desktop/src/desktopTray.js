// Placeholder tray icon (16x16 "M" monogram) embedded as PNG so the tray works
// before brand icon assets are added to build-resources/.
const TRAY_ICON_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOElEQVR4nGNQ9dvxnxLMMGoAbgNef/qPl4/XAJBiGMbGJ8kAdEySAchOJ9kAYsVpY8DgSAdDxwAAZEJStziJu6YAAAAASUVORK5CYII=';

function trayStatusLabel(workerStatus) {
  switch (String(workerStatus || '')) {
    case 'ready':
      return 'Ready';
    case 'restarting':
      return 'Restarting';
    case 'error':
      return 'Error';
    case 'stopped':
      return 'Stopped';
    default:
      return 'Starting';
  }
}

function buildTrayMenuTemplate({ productName, settings, statusLabel, callbacks }) {
  const name = String(productName || 'memoQ AI Hub');
  return [
    { label: `Show ${name}`, click: callbacks.showMainWindow },
    { label: 'Open assistant window', click: callbacks.openAssistantWindow },
    { type: 'separator' },
    {
      label: 'Keep running in the tray when closing',
      type: 'checkbox',
      checked: Boolean(settings?.closeToTray),
      click: (menuItem) => callbacks.setCloseToTray(Boolean(menuItem?.checked))
    },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: Boolean(settings?.launchAtLogin),
      click: (menuItem) => callbacks.setLaunchAtLogin(Boolean(menuItem?.checked))
    },
    { type: 'separator' },
    { label: `Status: ${statusLabel}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: callbacks.quitApp }
  ];
}

module.exports = {
  TRAY_ICON_PNG_BASE64,
  trayStatusLabel,
  buildTrayMenuTemplate
};
