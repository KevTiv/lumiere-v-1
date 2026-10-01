import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import {
  connectCategoryTransport,
  ProjectionResetError,
  ProjectionUnavailableError,
} from "./http-transport.ts";
import { openNodeSqlite } from "./node-sqlite.ts";
import { ProjectionStore } from "./projection-store.ts";
import { SyncEngine } from "./sync-engine.ts";
import { projectionSchemaHash } from "./generated/product-category.ts";

test("transport bounds UTF-8 response bytes before decoding envelopes", async () => {
  await assert.rejects(
    connectCategoryTransport({
      apiUrl: "https://fixture.local/v1",
      fetch: async () => new Response("€".repeat(1_500_000)),
    }),
    /byte limit/,
  );
});

test("only actual network/server outage is eligible for signed offline fallback", async () => {
  const connect = (fetch: typeof globalThis.fetch, signal?: AbortSignal) =>
    connectCategoryTransport(
      { apiUrl: "https://fixture.local/v1", fetch },
      signal,
    );
  await assert.rejects(
    connect(async () => {
      throw new TypeError("network failed");
    }),
    ProjectionUnavailableError,
  );
  await assert.rejects(
    connect(async () => new Response("{}", { status: 503 })),
    ProjectionUnavailableError,
  );
  await assert.rejects(
    connect(
      async () =>
        new Response(null, { status: 302, headers: { Location: "/sign-in" } }),
    ),
    ProjectionResetError,
  );
  await assert.rejects(
    connect(async () => new Response("{}", { status: 400 })),
    (error) => !(error instanceof ProjectionUnavailableError),
  );
  await assert.rejects(
    connect(async () => new Response("malformed")),
    (error) => !(error instanceof ProjectionUnavailableError),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    connect(async () => {
      throw new TypeError("cancelled request");
    }, controller.signal),
    (error) => !(error instanceof ProjectionUnavailableError),
  );
});

test("grant request keeps authorization version/company on the existing cookie-aware transport", async () => {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const connected = await connectCategoryTransport({
    apiUrl: "https://fixture.local/v1",
    headers: () => ({ Authorization: "Bearer online-session" }),
    fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      return new Response(
        JSON.stringify(
          url.pathname.endsWith("/scope")
            ? { scope, schemaHash: projectionSchemaHash }
            : { signed: "fixture" },
        ),
      );
    },
  });
  await connected.grant();
  assert.equal(calls[1].url.pathname, "/v1/offline/product-categories/grant");
  assert.equal(
    calls[1].url.searchParams.get("authorizationVersion"),
    scope.authorizationVersion,
  );
  assert.equal(calls[1].url.searchParams.get("companyId"), scope.companyId);
  assert.equal(calls[1].init?.credentials, "include");
  assert.equal(calls[1].init?.cache, "no-store");
  assert.equal(calls[1].init?.redirect, "manual");
  assert.deepEqual(calls[1].init?.headers, {
    Authorization: "Bearer online-session",
  });
});

const scope = {
  environmentId: "fixture-server",
  actorId: "actor-a",
  organizationId: "7",
  companyId: "9",
  authorizationVersion: "auth-1",
};
const row = {
  id: "1",
  organization_id: "7",
  company_id: "9",
  name: "Produce",
  parent_id: null,
  sequence: 1,
};

async function fixture(t: TestContext) {
  const state = {
    status: 200,
    requests: [] as URL[],
    authorization: [] as (string | undefined)[],
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.local");
    state.requests.push(url);
    state.authorization.push(request.headers.authorization);
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    if (
      request.headers.authorization !== "Bearer current" ||
      state.status !== 200
    ) {
      response.writeHead(
        request.headers.authorization !== "Bearer current" ? 401 : state.status,
      );
      response.end(JSON.stringify({ error: "denied or unavailable" }));
      return;
    }
    const common = { scope, schemaHash: projectionSchemaHash };
    if (url.pathname.endsWith("/scope")) response.end(JSON.stringify(common));
    else if (url.pathname.endsWith("/snapshot"))
      response.end(
        JSON.stringify({
          ...common,
          kind: "snapshot",
          cursor: "10",
          rows: [row],
        }),
      );
    else
      response.end(
        JSON.stringify({
          ...common,
          kind: "pull",
          fromCursor: "10",
          nextCursor: "11",
          hasMore: false,
          changes: [
            {
              sequence: "11",
              operation: "upsert",
              row: { ...row, id: "2", name: "Grain" },
            },
            { sequence: "11", operation: "delete", id: "1" },
          ],
        }),
      );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture port");
  const options = {
    apiUrl: `http://127.0.0.1:${address.port}/v1`,
    companyId: "9",
    headers: () => ({ Authorization: "Bearer current" }),
  };
  return { state, options };
}

test("authenticated HTTP discovery, snapshot and whole-commit replay reach real SQLite", async (t) => {
  const { state, options } = await fixture(t);
  const connected = await connectCategoryTransport(options);
  assert.deepEqual(connected.scope, scope);
  const connection = openNodeSqlite(":memory:");
  t.after(() => connection.close());
  const store = new ProjectionStore(connection, connected.scope);
  const engine = new SyncEngine(store, connected.transport);
  await engine.sync();
  await engine.sync();
  assert.equal(store.checkpoint(), "11");
  assert.deepEqual(await store.repository.list(), [
    { ...row, id: "2", name: "Grain" },
  ]);
  assert.equal(
    state.requests[0].pathname,
    "/v1/offline/product-categories/scope",
  );
  assert.equal(state.requests[0].searchParams.get("companyId"), "9");
  assert.equal(
    state.requests[1].searchParams.get("authorizationVersion"),
    "auth-1",
  );
  assert.equal(state.requests[2].searchParams.get("cursor"), "10");
  for (const request of state.requests) {
    assert.equal(request.searchParams.has("organizationId"), false);
    assert.equal(request.searchParams.has("actorId"), false);
  }
  assert.deepEqual(state.authorization, [
    "Bearer current",
    "Bearer current",
    "Bearer current",
  ]);
});

for (const status of [401, 403, 409, 410]) {
  test(`HTTP ${status} clears rows/checkpoint and invalidates already-open handles`, async (t) => {
    const { state, options } = await fixture(t);
    const { scope, transport } = await connectCategoryTransport(options);
    const connection = openNodeSqlite(":memory:");
    t.after(() => connection.close());
    const store = new ProjectionStore(connection, scope);
    const engine = new SyncEngine(store, transport);
    await engine.sync();
    state.status = status;
    await assert.rejects(
      engine.sync(),
      (error: unknown) =>
        error instanceof ProjectionResetError && error.status === status,
    );
    await assert.rejects(store.repository.list(), /scope was cleared/);
    const reopened = new ProjectionStore(connection, scope);
    assert.equal(reopened.checkpoint(), null);
    assert.deepEqual(await reopened.repository.list(), []);
  });
}

test("HTTP outage retains usable offline rows and checkpoint", async (t) => {
  const { state, options } = await fixture(t);
  const { scope, transport } = await connectCategoryTransport(options);
  const connection = openNodeSqlite(":memory:");
  t.after(() => connection.close());
  const store = new ProjectionStore(connection, scope);
  const engine = new SyncEngine(store, transport);
  await engine.sync();
  state.status = 503;
  await assert.rejects(engine.sync(), /503/);
  assert.equal(store.checkpoint(), "10");
  assert.deepEqual(await store.repository.list(), [row]);
});

test("transport resolves fresh credentials per request", async (t) => {
  const { state, options } = await fixture(t);
  let credential = "Bearer current";
  const { scope, transport } = await connectCategoryTransport({
    ...options,
    headers: () => ({ Authorization: credential }),
  });
  credential = "Bearer expired";
  await assert.rejects(transport.snapshot(scope), ProjectionResetError);
  assert.deepEqual(state.authorization, ["Bearer current", "Bearer expired"]);
});

test("a transport cannot be reused with another actor scope", async (t) => {
  const { state, options } = await fixture(t);
  const { scope, transport } = await connectCategoryTransport(options);
  assert.throws(
    () => transport.snapshot({ ...scope, actorId: "actor-b" }),
    ProjectionResetError,
  );
  assert.equal(state.requests.length, 1);
});
