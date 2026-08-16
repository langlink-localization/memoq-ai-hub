const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createLifecycleSettings,
  DEFAULT_LIFECYCLE_SETTINGS
} = require('../src/lifecycleSettings');
const { buildTrayMenuTemplate, trayStatusLabel, TRAY_ICON_PNG_BASE64 } = require('../src/desktopTray');

function createTempSettingsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'memoq-lifecycle-')), 'lifecycle-settings.json');
}

test('lifecycle settings read defaults and round-trip persisted values', () => {
  const settingsPath = createTempSettingsPath();
  test.after(() => fs.rmSync(path.dirname(settingsPath), { recursive: true, force: true }));

  const settings = createLifecycleSettings({ settingsPath });
  assert.deepEqual(settings.read(), { ...DEFAULT_LIFECYCLE_SETTINGS });
  assert.equal(DEFAULT_LIFECYCLE_SETTINGS.closeToTray, true, 'close-to-tray is the default lifecycle mode');

  settings.write({ closeToTray: false, launchAtLogin: true });
  assert.deepEqual(settings.read(), { closeToTray: false, launchAtLogin: true });
});

test('lifecycle settings ignore corrupt files and normalize partial values', () => {
  const settingsPath = createTempSettingsPath();
  test.after(() => fs.rmSync(path.dirname(settingsPath), { recursive: true, force: true }));

  fs.writeFileSync(settingsPath, '{not-json', 'utf8');
  const settings = createLifecycleSettings({ settingsPath });
  assert.deepEqual(settings.read(), { ...DEFAULT_LIFECYCLE_SETTINGS });

  settings.write({ launchAtLogin: true });
  assert.deepEqual(settings.read(), { closeToTray: true, launchAtLogin: true });
});

test('tray menu template wires lifecycle toggles and actions', () => {
  const calls = [];
  const template = buildTrayMenuTemplate({
    productName: 'memoQ AI Hub',
    settings: { closeToTray: false, launchAtLogin: true },
    statusLabel: 'Ready',
    callbacks: {
      showMainWindow: () => { calls.push('show'); },
      openAssistantWindow: () => { calls.push('assistant'); },
      setCloseToTray: (enabled) => calls.push(['closeToTray', enabled]),
      setLaunchAtLogin: (enabled) => calls.push(['launchAtLogin', enabled]),
      quitApp: () => { calls.push('quit'); }
    }
  });

  const byLabel = (label) => template.find((item) => item.label === label);
  byLabel('Show memoQ AI Hub').click();
  byLabel('Open assistant window').click();
  byLabel('Quit').click();

  const closeToggle = byLabel('Keep running in the tray when closing');
  assert.equal(closeToggle.type, 'checkbox');
  assert.equal(closeToggle.checked, false);
  closeToggle.click({ checked: true });

  const loginToggle = byLabel('Launch at login');
  assert.equal(loginToggle.checked, true);
  loginToggle.click({ checked: false });

  assert.equal(byLabel('Status: Ready').enabled, false);
  assert.deepEqual(calls, ['show', 'assistant', 'quit', ['closeToTray', true], ['launchAtLogin', false]]);
});

test('tray icon placeholder and status labels stay stable', () => {
  assert.match(TRAY_ICON_PNG_BASE64, /^iVBOR/);
  assert.equal(trayStatusLabel('ready'), 'Ready');
  assert.equal(trayStatusLabel('restarting'), 'Restarting');
  assert.equal(trayStatusLabel('error'), 'Error');
  assert.equal(trayStatusLabel('starting'), 'Starting');
  assert.equal(trayStatusLabel(undefined), 'Starting');
});

test('main process wires tray residency, hidden startup, and login item settings', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(source, /new Tray\(/);
  assert.match(source, /setLoginItemSettings\(/);
  assert.match(source, /args: enabled \? \['--hidden'\] : \[\]/);
  assert.match(source, /process\.argv\.includes\('--hidden'\)/);
  assert.match(source, /event\.preventDefault\(\);\s*\n\s*mainWindow\.hide\(\)/);
  assert.match(source, /displayBalloon/);
  assert.match(source, /app\.requestSingleInstanceLock\(\)/);
});
