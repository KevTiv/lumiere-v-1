import { DatabaseSync } from "node:sqlite";
import type { SqliteConnection } from "./sqlite.ts";

/** Node 22.13+/24 file-backed adapter for local tools and integration tests.
 * Browser OPFS and Tauri adapters implement the same port in later slices.
 */
export function openNodeSqlite(
  filename: string,
): SqliteConnection & { close(): void } {
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  return {
    exec: (sql) => database.exec(sql),
    run: (sql, parameters) => {
      database.prepare(sql).run(...parameters);
    },
    all: (sql, parameters) =>
      database.prepare(sql).all(...parameters) as Record<
        string,
        string | number | null
      >[],
    transaction<T>(work: () => T): T {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = work();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => database.close(),
  };
}
