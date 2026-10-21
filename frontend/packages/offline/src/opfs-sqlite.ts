import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import {
  sqliteTransaction,
  type SqliteConnection,
  type SqlValue,
} from "./sqlite.ts";

export const browserStorageLock = "lumiere-offline-opfs-sahpool-v1";

/** Worker-only, persistent SQLite. Refuses unavailable storage or a competing owner. */
export async function openOpfsSqlite(options: {
  wasmUrl: string;
  filename?: string;
}): Promise<SqliteConnection & { close(): Promise<void> }> {
  if (
    !("importScripts" in globalThis) ||
    "document" in globalThis ||
    !globalThis.isSecureContext ||
    !navigator.storage?.getDirectory ||
    !navigator.locks
  )
    throw new Error(
      "Persistent browser SQLite requires a secure worker with OPFS and Web Locks",
    );
  const filename = options.filename ?? "/lumiere-categories.sqlite3";
  if (!/^\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.sqlite3$/.test(filename))
    throw new Error("Invalid browser database filename");
  const wasmUrl = new URL(options.wasmUrl, location.href);
  if (wasmUrl.origin !== location.origin)
    throw new Error("SQLite WASM must be hosted on this origin");

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired!: () => void;
  let denied!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    acquired = resolve;
    denied = reject;
  });
  const lease = navigator.locks.request(
    browserStorageLock,
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error("Browser storage is in use by another tab or worker");
      acquired();
      await held;
    },
  );
  void lease.catch(denied);
  await ready;
  try {
    // Upstream's declaration omits Emscripten's supported module configuration.
    const initialize = sqlite3InitModule as (configuration: {
      locateFile(): string;
    }) => ReturnType<typeof sqlite3InitModule>;
    const sqlite = await initialize({ locateFile: () => wasmUrl.href });
    const pool = await sqlite.installOpfsSAHPoolVfs({
      name: "lumiere-offline-sahpool",
      directory: "/.lumiere-offline-sahpool",
      initialCapacity: 6,
    });
    if (pool.isPaused()) await pool.unpauseVfs();
    try {
      const db = new pool.OpfsSAHPoolDb(filename);
      let closed = false;
      const exec = (sql: string) => {
        if (closed) throw new Error("Browser SQLite connection is closed");
        db.exec(sql);
      };
      try {
        exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;");
      } catch (error) {
        db.close();
        throw error;
      }
      return {
        exec,
        run: (sql, parameters) => {
          execChecked();
          db.exec({ sql, bind: [...parameters] });
        },
        all: (sql, parameters) => {
          execChecked();
          const rows = db.exec({
            sql,
            bind: [...parameters],
            rowMode: "object",
            returnValue: "resultRows",
          });
          return rows.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([key, value]) => {
                if (
                  value !== null &&
                  typeof value !== "string" &&
                  typeof value !== "number"
                )
                  throw new Error("Unsupported SQLite projection value");
                return [key, value as SqlValue];
              }),
            ),
          );
        },
        transaction: (work) => sqliteTransaction(exec, work),
        close: async () => {
          if (closed) return;
          closed = true;
          try {
            db.close();
            pool.pauseVfs();
          } finally {
            release();
            await lease;
          }
        },
      };
      function execChecked() {
        if (closed) throw new Error("Browser SQLite connection is closed");
      }
    } catch (error) {
      pool.pauseVfs();
      throw error;
    }
  } catch (error) {
    release();
    await lease;
    throw error;
  }
}
