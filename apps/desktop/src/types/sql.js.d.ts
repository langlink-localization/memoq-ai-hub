// sql.js ships JavaScript without bundled types. The database module only
// needs the module to resolve under checkJs; call sites stay locally typed.
declare module 'sql.js';
