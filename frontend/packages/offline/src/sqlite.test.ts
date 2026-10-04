import assert from "node:assert/strict";
import { test } from "node:test";
import { openNodeSqlite } from "./node-sqlite.ts";

test("shared transaction boundary refuses an async result and rolls back initial writes", (t) => {
  const connection = openNodeSqlite(":memory:");
  t.after(() => connection.close());
  connection.exec("CREATE TABLE guard (id INTEGER)");
  assert.throws(
    () =>
      connection.transaction(() => {
        connection.exec("INSERT INTO guard VALUES (1)");
        return Promise.resolve();
      }),
    /must be synchronous/,
  );
  assert.deepEqual(connection.all("SELECT * FROM guard", []), []);
  connection.transaction(() => connection.exec("INSERT INTO guard VALUES (2)"));
  const rows = connection.all("SELECT * FROM guard", []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 2);
});
