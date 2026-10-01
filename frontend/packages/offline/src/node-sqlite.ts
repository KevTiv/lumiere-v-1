import { DatabaseSync } from "node:sqlite";
import { sqliteTransaction, type SqliteConnection } from "./sqlite.ts";

/** Node 22.13+/24 file-backed adapter for local tools and integration tests.
 * Browser OPFS uses the same port; Tauri/native adapters remain later slices.
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
      return sqliteTransaction((sql) => database.exec(sql), work);
    },
    close: () => database.close(),
  };
}
