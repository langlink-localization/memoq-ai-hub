// Ambient augmentation for Electron-only process fields referenced by shared
// modules that also load in plain Node (where the field is simply undefined).
declare namespace NodeJS {
  interface Process {
    resourcesPath?: string;
  }
}
