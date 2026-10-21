import { test, expect } from "@playwright/test";
import { row } from "./fixture.ts";

test.beforeEach(async ({ page, request }) => {
  await request.get("http://127.0.0.1:4179/fixture/status?value=200");
  await request.get("http://127.0.0.1:4179/fixture/delay?value=false");
  await page.goto("http://127.0.0.1:4179");
});

test("real OPFS survives page reload and supports disconnected repository reads", async ({
  page,
  context,
}) => {
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    await client.open();
    await client.projection.sync();
    await client.projection.close();
  });
  await page.reload();
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    await client.open();
  });
  await context.setOffline(true);
  expect(
    await page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      return {
        cursor: await client.projection.checkpoint(),
        row: await client.projection.repository.get("18446744073709551615"),
      };
    }),
  ).toEqual({ cursor: "10", row });
});

test("reopening resumes whole-commit HTTP replay from the durable checkpoint", async ({
  page,
}) => {
  expect(
    await page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.open();
      await client.projection.sync();
      await client.projection.close();
      await client.open();
      const result = await client.projection.sync();
      return { result, rows: await client.projection.repository.list() };
    }),
  ).toEqual({
    result: { cursor: "11", changed: 2, hasMore: false },
    rows: [{ ...row, id: "2", name: "Grain" }],
  });
});

test("actual WASM SQLite rolls back row effects and checkpoint together, then retries", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    return client.probe("rollback");
  });
  expect(result).toMatchObject({
    rolledBack: {
      failure: expect.stringContaining("checkpoint fault"),
      cursor: "10",
      rows: [row],
    },
    cursor: "11",
    rows: [{ ...row, id: "2", name: "Grain" }],
  });
});

test("one worker can close and reopen the persistent pool without losing rows", async ({
  page,
}) => {
  expect(
    await page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      return client.probe("reopen");
    }),
  ).toEqual({ cursor: "10", row });
});

test("async transaction callbacks are refused and their initial effects roll back", async ({
  page,
}) => {
  expect(
    await page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      return client.probe("async");
    }),
  ).toEqual({
    failure: "SQLite transaction callback must be synchronous",
    rows: [],
  });
});

test("schema incompatibility refuses activation and preserves existing rows", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    await client.probe("drift");
  });
  await expect(
    page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.open();
    }),
  ).rejects.toThrow(/migration required/);
  expect(
    await page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      return client.probe("inspect-drift");
    }),
  ).toEqual([{ id: row.id, name: row.name }]);
});

test("a competing tab fails promptly; closing the owner allows handoff", async ({
  page,
  context,
}) => {
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    await client.open();
    await client.projection.sync();
  });
  const other = await context.newPage();
  await other.goto("http://127.0.0.1:4179");
  await expect(
    other.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.open();
    }),
  ).rejects.toThrow(/storage is in use/);
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    await client.projection.close();
  });
  expect(
    await other.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.open();
      return client.projection.repository.list();
    }),
  ).toEqual([row]);
});

test("actor and company scopes do not reuse another scope's cached rows", async ({
  page,
}) => {
  expect(
    await page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.open();
      await client.projection.sync();
      await client.projection.close();
      await client.open({ actorId: "actor-b" });
      const otherActor = await client.projection.repository.list();
      await client.projection.close();
      await client.open({ companyId: "8" });
      const otherCompany = await client.projection.repository.list();
      await client.projection.close();
      await client.open();
      return {
        otherActor,
        otherCompany,
        original: await client.projection.repository.list(),
      };
    }),
  ).toEqual({ otherActor: [], otherCompany: [], original: [row] });
});

test("clear aborts a delayed snapshot and invalidates the UI handle immediately", async ({
  page,
  request,
}) => {
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    await client.open();
  });
  await request.get("http://127.0.0.1:4179/fixture/delay?value=true");
  const started = page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith("/snapshot"),
  );
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    client.startSync();
  });
  await started;
  expect(
    await page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      const clearing = client.projection.clear();
      let denied = "";
      try {
        await client.projection.repository.list();
      } catch (error) {
        denied = (error as Error).message;
      }
      await clearing;
      const outcome = await client.outcome;
      await client.projection.close();
      await client.open();
      return {
        denied,
        outcome,
        rows: await client.projection.repository.list(),
        cursor: await client.projection.checkpoint(),
      };
    }),
  ).toMatchObject({
    denied: expect.stringContaining("cleared"),
    outcome: expect.stringContaining("closed or cleared"),
    rows: [],
    cursor: null,
  });
});

test("cancellation aborts worker transport without changing saved rows or cursor", async ({
  page,
  request,
}) => {
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    await client.open();
    await client.projection.sync();
  });
  await request.get("http://127.0.0.1:4179/fixture/delay?value=true");
  const started = page.waitForRequest((request) =>
    request.url().includes("/pull?"),
  );
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    client.startSync();
  });
  await started;
  expect(
    await page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      client.abortSync();
      return {
        outcome: await client.outcome,
        rows: await client.projection.repository.list(),
        cursor: await client.projection.checkpoint(),
      };
    }),
  ).toMatchObject({
    outcome: expect.stringContaining("cancelled"),
    rows: [row],
    cursor: "10",
  });
});

test("a server authorization reset clears the durable browser projection", async ({
  page,
  request,
}) => {
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    await client.open();
    await client.projection.sync();
  });
  await request.get("http://127.0.0.1:4179/fixture/status?value=403");
  await expect(
    page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.projection.sync();
    }),
  ).rejects.toThrow(/authorization or replay history changed/);
  await expect(
    page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.projection.repository.list();
    }),
  ).rejects.toThrow(/cleared/);
  expect(
    await page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.projection.close();
      await client.open();
      return {
        rows: await client.projection.repository.list(),
        cursor: await client.projection.checkpoint(),
      };
    }),
  ).toEqual({ rows: [], cursor: null });
});

test("an HTTP outage preserves usable browser rows", async ({
  page,
  request,
}) => {
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    await client.open();
    await client.projection.sync();
  });
  await request.get("http://127.0.0.1:4179/fixture/status?value=503");
  await expect(
    page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.projection.sync();
    }),
  ).rejects.toThrow(/503/);
  expect(
    await page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      return client.projection.repository.list();
    }),
  ).toEqual([row]);
});

test("credentials stay on the host and refresh for each worker sync", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    await client.open();
    await client.projection.sync();
    client.expireCredential();
  });
  await expect(
    page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.projection.sync();
    }),
  ).rejects.toThrow(/authorization or replay history changed/);
});

test("missing WASM fails closed, releases ownership and preserves stored data", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    await client.open();
    await client.projection.sync();
    await client.projection.close();
  });
  await expect(
    page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.open({}, { wasmUrl: "/missing.wasm" });
    }),
  ).rejects.toThrow();
  expect(
    await page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.open();
      return client.projection.repository.list();
    }),
  ).toEqual([row]);
});

test("unsafe filenames and cross-origin assets cannot activate storage", async ({
  page,
}) => {
  await expect(
    page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.open({}, { filename: "/../other.sqlite3" });
    }),
  ).rejects.toThrow(/Invalid browser database filename/);
  await expect(
    page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.open({}, { wasmUrl: "https://other.invalid/sqlite3.wasm" });
    }),
  ).rejects.toThrow(/this origin/);
});

test("unavailable OPFS is reported without substituting ephemeral storage", async ({
  page,
}) => {
  await expect(
    page.evaluate(async () => {
      Object.defineProperty(navigator.storage, "getDirectory", {
        value: undefined,
      });
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.open();
    }),
  ).rejects.toThrow(/unavailable/);
});

test("close cancels a delayed snapshot and allows a fresh owner without stale rows", async ({
  page,
  request,
}) => {
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    await client.open();
  });
  await request.get("http://127.0.0.1:4179/fixture/delay?value=true");
  const started = page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith("/snapshot"),
  );
  await page.evaluate(async () => {
    const client: typeof import("./client.ts") = await import(
      new URL("/client.js", location.href).href
    );
    client.startSync();
  });
  await started;
  expect(
    await page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.projection.close();
      const outcome = await client.outcome;
      await client.open();
      return {
        outcome,
        rows: await client.projection.repository.list(),
        cursor: await client.projection.checkpoint(),
      };
    }),
  ).toMatchObject({
    outcome: expect.stringContaining("closed"),
    rows: [],
    cursor: null,
  });
});

test("concurrent UI callers share one synchronization request", async ({
  page,
}) => {
  expect(
    await page.evaluate(async () => {
      const client: typeof import("./client.ts") = await import(
        new URL("/client.js", location.href).href
      );
      await client.open();
      const first = client.projection.sync();
      const second = client.projection.sync();
      const same = first === second;
      const result = await first;
      await second;
      return { same, result, rows: await client.projection.repository.list() };
    }),
  ).toEqual({
    same: true,
    result: { cursor: "10", changed: 1, hasMore: false },
    rows: [row],
  });
});
