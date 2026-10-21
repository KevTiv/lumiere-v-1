import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type {
  ProjectionScope,
  ProjectionTransport,
  PullBatch,
  Snapshot,
} from "./contracts.ts";
import {
  projectionSchemaHash,
  type ProductCategory,
} from "./generated/product-category.ts";
import { openNodeSqlite } from "./node-sqlite.ts";
import { ProjectionStore } from "./projection-store.ts";
import { SyncEngine } from "./sync-engine.ts";

const scope: ProjectionScope = {
  environmentId: "test-stdb",
  actorId: "actor-a",
  organizationId: "7",
  companyId: "9",
  authorizationVersion: "auth-1",
};

function row(
  id = "18446744073709551615",
  extra: Partial<ProductCategory> = {},
): ProductCategory {
  return {
    id,
    organization_id: "7",
    company_id: "9",
    name: "Produce",
    parent_id: null,
    sequence: 0,
    ...extra,
  };
}

function snapshot(rows: unknown[] = [row()], cursor = "10"): Snapshot {
  return {
    kind: "snapshot",
    scope,
    schemaHash: projectionSchemaHash,
    cursor,
    rows,
  };
}

function pull(
  changes: PullBatch["changes"],
  fromCursor = "10",
  nextCursor = "12",
): PullBatch {
  return {
    kind: "pull",
    scope,
    schemaHash: projectionSchemaHash,
    fromCursor,
    nextCursor,
    changes,
    hasMore: false,
  };
}

function setup(t: TestContext, transport?: ProjectionTransport) {
  const connection = openNodeSqlite(":memory:");
  t.after(() => connection.close());
  const store = new ProjectionStore(connection, scope);
  const notifications: string[] = [];
  const source = transport ?? {
    snapshot: async () => snapshot(),
    pull: async () => pull([]),
  };
  const engine = new SyncEngine(store, source, (resource) =>
    notifications.push(resource),
  );
  return { connection, store, engine, notifications };
}

test("snapshot persists exact u64 IDs and read-only Drizzle repository rows", async (t) => {
  const { store, engine, notifications } = setup(t);
  assert.equal((await engine.sync()).cursor, "10");
  assert.deepEqual(await store.repository.get(row().id), row());
  assert.deepEqual(await store.repository.list(), [row()]);
  assert.equal(store.checkpoint(), "10");
  assert.deepEqual(notifications, ["product-categories"]);
  assert.deepEqual(Object.keys(store.repository), ["get", "list"]);
});

test("ordered pull updates rows, deletes rows, and advances one durable checkpoint", async (t) => {
  const { store, engine } = setup(t, {
    snapshot: async () => snapshot(),
    pull: async () =>
      pull([
        {
          sequence: "11",
          operation: "upsert",
          row: row("2", { name: "Grain" }),
        },
        { sequence: "12", operation: "delete", id: row().id },
      ]),
  });
  await engine.sync();
  assert.deepEqual(await engine.sync(), {
    cursor: "12",
    changed: 2,
    hasMore: false,
  });
  assert.deepEqual(await store.repository.list(), [
    row("2", { name: "Grain" }),
  ]);
});

test("row writes and cursor rollback together on a real SQLite failure; retry applies once", async (t) => {
  const { store, connection, engine, notifications } = setup(t, {
    snapshot: async () => snapshot(),
    pull: async () =>
      pull([{ sequence: "11", operation: "upsert", row: row("2") }]),
  });
  await engine.sync();
  connection.exec(
    "CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON _lumiere_sync_checkpoint BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
  );
  await assert.rejects(engine.sync(), /injected failure/);
  assert.equal(store.checkpoint(), "10");
  assert.equal(await store.repository.get("2"), null);
  assert.equal(notifications.length, 1);
  connection.exec("DROP TRIGGER fail_checkpoint");
  await engine.sync();
  assert.equal(store.checkpoint(), "12");
  assert.equal((await store.repository.list()).length, 2);
});

test("file-backed restart reads offline and resumes from saved cursor without another snapshot", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "lumiere-offline-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "projection.sqlite");
  const first = openNodeSqlite(path);
  const initial = new ProjectionStore(first, scope);
  await new SyncEngine(initial, {
    snapshot: async () => snapshot(),
    pull: async () => {
      throw new Error("not used");
    },
  }).sync();
  first.close();
  const second = openNodeSqlite(path);
  t.after(() => second.close());
  const reopened = new ProjectionStore(second, scope);
  assert.deepEqual(await reopened.repository.get(row().id), row());
  await new SyncEngine(reopened, {
    snapshot: async () => {
      throw new Error("must resume");
    },
    pull: async (_scope, cursor) => {
      assert.equal(cursor, "10");
      return pull([]);
    },
  }).sync();
  assert.equal(reopened.checkpoint(), "12");
});

for (const [name, response] of [
  ["foreign organization", snapshot([row("1", { organization_id: "8" })])],
  ["foreign company", snapshot([row("1", { company_id: "8" })])],
  [
    "actor mismatch",
    { ...snapshot(), scope: { ...scope, actorId: "actor-b" } },
  ],
  [
    "environment mismatch",
    { ...snapshot(), scope: { ...scope, environmentId: "other-stdb" } },
  ],
  [
    "authorization mismatch",
    { ...snapshot(), scope: { ...scope, authorizationVersion: "auth-2" } },
  ],
  ["schema mismatch", { ...snapshot(), schemaHash: "sha256:wrong" }],
  [
    "unsafe numeric ID",
    snapshot([{ ...row(), id: Number.MAX_SAFE_INTEGER + 1 }]),
  ],
  ["noncanonical ID", snapshot([{ ...row(), id: "01" }])],
  ["u64 overflow", snapshot([{ ...row(), id: "18446744073709551616" }])],
  ["missing field", snapshot([{ id: "1", organization_id: "7" }])],
  ["unreviewed field", snapshot([{ ...row(), metadata: "secret" }])],
  ["duplicate row", snapshot([row(), row()])],
  [
    "oversized batch",
    snapshot(Array.from({ length: 1001 }, (_, i) => row(String(i)))),
  ],
] as const) {
  test(`rejects ${name} before any snapshot effect`, async (t) => {
    const { store, engine, notifications } = setup(t, {
      snapshot: async () => response,
      pull: async () => pull([]),
    });
    await assert.rejects(engine.sync());
    assert.equal(store.checkpoint(), null);
    assert.deepEqual(await store.repository.list(), []);
    assert.deepEqual(notifications, []);
  });
}

for (const [name, response] of [
  ["stale response", pull([], "9", "12")],
  ["cursor regression", pull([], "10", "9")],
  [
    "out-of-order changes",
    pull([
      { sequence: "12", operation: "delete", id: "1" },
      { sequence: "11", operation: "delete", id: "2" },
    ]),
  ],
  [
    "sequence at or before the checkpoint",
    pull([
      { sequence: "10", operation: "delete", id: "1" },
      { sequence: "10", operation: "delete", id: "2" },
    ]),
  ],
  [
    "change beyond watermark",
    pull([{ sequence: "13", operation: "delete", id: "1" }]),
  ],
  ["nonprogress page", { ...pull([], "10", "10"), hasMore: true }],
  [
    "unknown operation",
    pull([
      {
        sequence: "11",
        operation: "execute",
        id: "1",
      } as unknown as PullBatch["changes"][number],
    ]),
  ],
] as const) {
  test(`rejects ${name} without changing rows or cursor`, async (t) => {
    const { store, engine } = setup(t, {
      snapshot: async () => snapshot(),
      pull: async () => response,
    });
    await engine.sync();
    await assert.rejects(engine.sync());
    assert.equal(store.checkpoint(), "10");
    assert.deepEqual(await store.repository.list(), [row()]);
  });
}

test("org-wide categories are visible within the granted company projection", async (t) => {
  const { store, engine } = setup(t, {
    snapshot: async () => snapshot([row("1", { company_id: null })]),
    pull: async () => pull([]),
  });
  await engine.sync();
  assert.equal((await store.repository.list())[0].company_id, null);
});

test("actor, company, environment and policy caches are isolated", async (t) => {
  const { connection, engine } = setup(t);
  await engine.sync();
  for (const alternate of [
    { ...scope, actorId: "actor-b" },
    { ...scope, companyId: "8" },
    { ...scope, environmentId: "other-stdb" },
    { ...scope, authorizationVersion: "auth-2" },
  ]) {
    const store = new ProjectionStore(connection, alternate);
    assert.equal(store.checkpoint(), null);
    assert.deepEqual(await store.repository.list(), []);
  }
});

test("concurrent callers share one transport request", async (t) => {
  let requests = 0;
  const { engine } = setup(t, {
    snapshot: async () => {
      requests += 1;
      return snapshot();
    },
    pull: async () => pull([]),
  });
  await Promise.all([engine.sync(), engine.sync(), engine.sync()]);
  assert.equal(requests, 1);
});

test("competing engines cannot overwrite a newer checkpoint", async (t) => {
  const { store, engine } = setup(t);
  let release!: (value: unknown) => void;
  const delayed = new SyncEngine(store, {
    snapshot: async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    pull: async () => pull([]),
  });
  const pending = delayed.sync();
  await engine.sync();
  release(snapshot([row("2")], "9"));
  await assert.rejects(pending, /Checkpoint changed/);
  assert.equal(store.checkpoint(), "10");
  assert.deepEqual(await store.repository.list(), [row()]);
});

test("clearing invalidates in-flight snapshots and existing read handles across connections", async (t) => {
  const { store, connection } = setup(t);
  const other = new ProjectionStore(connection, scope);
  let release!: (value: unknown) => void;
  const engine = new SyncEngine(store, {
    snapshot: async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    pull: async () => pull([]),
  });
  const pending = engine.sync();
  other.clear();
  release(snapshot());
  await assert.rejects(pending, /scope was cleared/);
  await assert.rejects(store.repository.list(), /scope was cleared/);
  const reopened = new ProjectionStore(connection, scope);
  assert.equal(reopened.checkpoint(), null);
  assert.deepEqual(await reopened.repository.list(), []);
});

test("network failure keeps the offline projection usable", async (t) => {
  const { store, engine } = setup(t, {
    snapshot: async () => snapshot(),
    pull: async () => {
      throw new Error("offline");
    },
  });
  await engine.sync();
  await assert.rejects(engine.sync(), /offline/);
  assert.deepEqual(await store.repository.list(), [row()]);
  assert.equal(store.checkpoint(), "10");
});

test("cancellation after transport response cannot write a snapshot", async (t) => {
  const controller = new AbortController();
  const { store, engine } = setup(t, {
    snapshot: async () => {
      controller.abort();
      return snapshot();
    },
    pull: async () => pull([]),
  });
  await assert.rejects(engine.sync(controller.signal));
  assert.equal(store.checkpoint(), null);
});

test("schema incompatibility refuses opening rather than destroying cached data", async (t) => {
  const { connection, engine } = setup(t);
  await engine.sync();
  connection.run("UPDATE _lumiere_projection_schema SET schema_hash = ?", [
    "old-schema",
  ]);
  assert.throws(
    () => new ProjectionStore(connection, scope),
    /migration required/,
  );
  assert.equal(connection.all("SELECT id FROM product_category", []).length, 1);
});

test("initial snapshot failure rolls back inserted rows and checkpoint", async (t) => {
  const { store, connection, engine } = setup(t);
  connection.exec(
    "CREATE TRIGGER fail_initial_checkpoint BEFORE INSERT ON _lumiere_sync_checkpoint BEGIN SELECT RAISE(ABORT, 'snapshot failure'); END;",
  );
  await assert.rejects(engine.sync(), /snapshot failure/);
  assert.equal(store.checkpoint(), null);
  assert.deepEqual(await store.repository.list(), []);
  connection.exec("DROP TRIGGER fail_initial_checkpoint");
  await engine.sync();
  assert.deepEqual(await store.repository.list(), [row()]);
});

test("a denied row later in a pull batch prevents all earlier row effects", async (t) => {
  const { store, engine } = setup(t, {
    snapshot: async () => snapshot(),
    pull: async () =>
      pull([
        { sequence: "11", operation: "upsert", row: row("2") },
        {
          sequence: "12",
          operation: "upsert",
          row: row("3", { company_id: "8" }),
        },
      ]),
  });
  await engine.sync();
  await assert.rejects(engine.sync(), /outside projection scope/);
  assert.deepEqual(await store.repository.list(), [row()]);
  assert.equal(store.checkpoint(), "10");
});

test("scope clearing on another file connection blocks a delayed reply", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "lumiere-offline-race-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "projection.sqlite");
  const first = openNodeSqlite(path);
  const second = openNodeSqlite(path);
  t.after(() => {
    second.close();
    first.close();
  });
  const initial = new ProjectionStore(first, scope);
  const competing = new ProjectionStore(second, scope);
  let release!: (value: unknown) => void;
  const engine = new SyncEngine(initial, {
    snapshot: async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    pull: async () => pull([]),
  });
  const pending = engine.sync();
  competing.clear();
  release(snapshot());
  await assert.rejects(pending, /scope was cleared/);
  assert.equal(second.all("SELECT id FROM product_category", []).length, 0);
  assert.equal(
    second.all("SELECT cursor FROM _lumiere_sync_checkpoint", []).length,
    0,
  );
});

test("snapshot and scope cleanup preserve unrelated pending intent tables", async (t) => {
  const { store, connection, engine } = setup(t);
  connection.exec(
    "CREATE TABLE _lumiere_change_set_test (id TEXT PRIMARY KEY); INSERT INTO _lumiere_change_set_test VALUES ('pending-intent');",
  );
  await engine.sync();
  store.clear();
  assert.deepEqual(
    connection
      .all("SELECT id FROM _lumiere_change_set_test", [])
      .map((item) => item.id),
    ["pending-intent"],
  );
});

test("notification failure reports the committed checkpoint without false sync failure", async (t) => {
  const { store } = setup(t);
  const error = new Error("UI observer failed");
  const engine = new SyncEngine(
    store,
    { snapshot: async () => snapshot(), pull: async () => pull([]) },
    () => {
      throw error;
    },
  );
  const result = await engine.sync();
  assert.equal(result.cursor, "10");
  assert.equal(result.notificationError, error);
  assert.equal(store.checkpoint(), "10");
  assert.deepEqual(await store.repository.list(), [row()]);
});
