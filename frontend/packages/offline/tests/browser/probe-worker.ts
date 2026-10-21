// Test-only access to fault injection. The production worker exposes no SQL command.
import { openOpfsSqlite } from "../../src/opfs-sqlite.ts";
import { ProjectionStore } from "../../src/projection-store.ts";
import { SyncEngine } from "../../src/sync-engine.ts";
import { scope, row, snapshot, pull } from "./fixture.ts";

globalThis.onmessage = async ({
  data,
}: MessageEvent<{ operation: string }>) => {
  let connection: Awaited<ReturnType<typeof openOpfsSqlite>> | undefined;
  try {
    connection = await openOpfsSqlite({ wasmUrl: "/sqlite3.wasm" });
    if (data.operation === "inspect-drift") {
      const value = connection.all("SELECT id, name FROM product_category", []);
      await connection.close();
      connection = undefined;
      globalThis.postMessage({ ok: true, value });
      return;
    }
    const store = new ProjectionStore(connection, scope);
    const engine = new SyncEngine(store, {
      snapshot: async () => snapshot,
      pull: async () => pull,
    });
    let value: unknown;
    if (data.operation === "rollback") {
      await engine.sync();
      connection.exec(
        "CREATE TEMP TRIGGER fail_checkpoint BEFORE UPDATE ON _lumiere_sync_checkpoint BEGIN SELECT RAISE(ABORT, 'checkpoint fault'); END;",
      );
      let failure = "";
      try {
        await engine.sync();
      } catch (error) {
        failure = (error as Error).message;
      }
      const rolledBack = {
        failure,
        cursor: store.checkpoint(),
        rows: await store.repository.list(),
      };
      connection.exec("DROP TRIGGER fail_checkpoint;");
      await engine.sync();
      value = {
        rolledBack,
        cursor: store.checkpoint(),
        rows: await store.repository.list(),
      };
    } else if (data.operation === "drift") {
      await engine.sync();
      connection.run("UPDATE _lumiere_projection_schema SET schema_hash = ?", [
        "incompatible",
      ]);
      value = {
        cursor: store.checkpoint(),
        rows: await store.repository.list(),
      };
    } else if (data.operation === "async") {
      connection.exec("CREATE TABLE async_guard (id INTEGER);");
      let failure = "";
      try {
        connection.transaction(() => {
          connection!.exec("INSERT INTO async_guard VALUES (1)");
          return Promise.resolve();
        });
      } catch (error) {
        failure = (error as Error).message;
      }
      value = {
        failure,
        rows: connection.all("SELECT * FROM async_guard", []),
      };
    } else if (data.operation === "reopen") {
      await engine.sync();
      await connection.close();
      connection = await openOpfsSqlite({ wasmUrl: "/sqlite3.wasm" });
      const reopened = new ProjectionStore(connection, scope);
      value = {
        cursor: reopened.checkpoint(),
        row: await reopened.repository.get(row.id),
      };
    } else throw new Error("Unsupported probe");
    await connection.close();
    connection = undefined;
    globalThis.postMessage({ ok: true, value });
  } catch (error) {
    await connection?.close();
    globalThis.postMessage({ ok: false, error: (error as Error).message });
  }
};
