function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_prompt_blocks (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, block_type TEXT NOT NULL, content TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_assets (profile_id TEXT NOT NULL, asset_id TEXT NOT NULL, purpose TEXT NOT NULL, PRIMARY KEY (profile_id, asset_id));
    CREATE TABLE IF NOT EXISTS mapping_rules (id TEXT PRIMARY KEY, rule_name TEXT NOT NULL, profile_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS provider_models (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS translation_history (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, project_id TEXT DEFAULT '', subject TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS translation_history_segments (id TEXT PRIMARY KEY, history_id TEXT NOT NULL, segment_index INTEGER DEFAULT 0);
  `);
}

function createInitialState() {
  return {
    profiles: [],
    defaultProfileId: '',
    assets: [],
    mappingRules: [],
    providers: [],
    history: [],
    translationCache: [],
    promptResponseCache: [],
    documentSummaryCache: [],
    integrationPreferences: {
      memoqVersion: '11',
      customInstallDir: '',
      selectedInstallDir: ''
    }
  };
}

module.exports = {
  createSchema,
  createInitialState
};
