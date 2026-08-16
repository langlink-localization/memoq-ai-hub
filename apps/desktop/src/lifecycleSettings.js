const fs = require('fs');
const path = require('path');

const DEFAULT_LIFECYCLE_SETTINGS = {
  closeToTray: true,
  launchAtLogin: false
};

function createLifecycleSettings(options = {}) {
  const settingsPath = String(options.settingsPath
    || path.join(process.env.APPDATA || process.cwd(), 'memoq-ai-hub', 'lifecycle-settings.json'));
  const fsImpl = options.fs || fs;

  function read() {
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(settingsPath, 'utf8'));
      return {
        closeToTray: typeof parsed.closeToTray === 'boolean' ? parsed.closeToTray : DEFAULT_LIFECYCLE_SETTINGS.closeToTray,
        launchAtLogin: typeof parsed.launchAtLogin === 'boolean' ? parsed.launchAtLogin : DEFAULT_LIFECYCLE_SETTINGS.launchAtLogin
      };
    } catch {
      return { ...DEFAULT_LIFECYCLE_SETTINGS };
    }
  }

  function write(settings) {
    const next = {
      closeToTray: typeof settings?.closeToTray === 'boolean' ? settings.closeToTray : DEFAULT_LIFECYCLE_SETTINGS.closeToTray,
      launchAtLogin: typeof settings?.launchAtLogin === 'boolean' ? settings.launchAtLogin : DEFAULT_LIFECYCLE_SETTINGS.launchAtLogin
    };
    fsImpl.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fsImpl.writeFileSync(settingsPath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  return {
    settingsPath,
    read,
    write
  };
}

module.exports = {
  createLifecycleSettings,
  DEFAULT_LIFECYCLE_SETTINGS
};
