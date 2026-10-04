// The subset of sql.js used by the desktop database. The package has no
// bundled types; this declaration types the handle without pulling in the
// full library surface.

declare module 'sql.js' {
  interface SqlStatement {
    bind(values?: Record<string, unknown> | unknown[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, any>;
    run(values?: Record<string, unknown> | unknown[]): void;
    free(): boolean;
  }

  interface SqlDatabase {
    exec(sql: string): Array<{ columns: string[]; values: any[][] }>;
    prepare(sql: string): SqlStatement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  interface SqlJsStatic {
    Database: new (data?: Buffer | Uint8Array | null) => SqlDatabase;
  }

  function initSqlJs(options?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
  export = initSqlJs;
}
