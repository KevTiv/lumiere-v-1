/** Synchronous ports ensure a transaction cannot span unrelated async work. */
export type SqlValue = string | number | null;

export interface SqliteConnection {
  exec(sql: string): void;
  run(sql: string, parameters: readonly SqlValue[]): void;
  all(sql: string, parameters: readonly SqlValue[]): Record<string, SqlValue>[];
  transaction<T>(work: () => T): T;
}

/** Both runtimes use the same transaction boundary; async callbacks cannot commit early. */
export function sqliteTransaction<T>(
  exec: (sql: string) => void,
  work: () => T,
): T {
  exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    if (
      result &&
      (typeof result === "object" || typeof result === "function") &&
      "then" in result &&
      typeof result.then === "function"
    )
      throw new Error("SQLite transaction callback must be synchronous");
    exec("COMMIT");
    return result;
  } catch (error) {
    exec("ROLLBACK");
    throw error;
  }
}
