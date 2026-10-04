// Wrapper returned by createDatabase. Persistence talks to these methods,
// not to the raw sql.js handle.

export interface DesktopSqlRow {
  [column: string]: any;
}

export interface DesktopDatabase {
  db: {
    export(): Uint8Array;
    close(): void;
  };
  exec(sql: string): void;
  run(sql: string, params?: Record<string, unknown>): number;
  all(sql: string, params?: Record<string, unknown>): DesktopSqlRow[];
  get(sql: string, params?: Record<string, unknown>): DesktopSqlRow | null;
  persist(): void;
  transaction<T>(callback: () => T): T;
  close(): void;
  flush(): void;
  hasPendingPersist(): boolean;
}
