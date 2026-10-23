/** Synchronous ports ensure a transaction cannot span unrelated async work. */
export type SqlValue = string | number | null;

export interface SqliteConnection {
  exec(sql: string): void;
  run(sql: string, parameters: readonly SqlValue[]): void;
  all(sql: string, parameters: readonly SqlValue[]): Record<string, SqlValue>[];
  transaction<T>(work: () => T): T;
}
