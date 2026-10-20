import { expect, test } from "@playwright/test";
import { scope } from "./fixture.ts";

const origin = "http://127.0.0.1:4179";
const url = `${origin}/offline/categories/index.html?companyId=9`;
test.beforeEach(async ({ context, request }) => {
  await request.get(`${origin}/fixture/grants?enabled=false`);
  await request.get(`${origin}/fixture/status?value=200`);
  await request.get(`${origin}/fixture/delay?value=false`);
  await request.get(`${origin}/fixture/actor?value=actor-a`);
  await request.get(`${origin}/fixture/sw-generation?value=initial`);
  await request.get(`${origin}/fixture/missing-asset?value=false`);
  await context.addCookies([
    { name: "stdb_token", value: "current", url: origin, httpOnly: true },
  ]);
});
async function ready(page: import("@playwright/test").Page) {
  await page.goto(url);
  await expect(page.locator("#status")).toHaveText(
    "Saved categories are up to date.",
  );
  await expect(page.locator("#cache-status")).toContainText(
    "Offline startup ready.",
  );
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
}

test("read-only app displays exact IDs, searches saved rows and reconnects through durable replay", async ({
  page,
  context,
}) => {
  await ready(page);
  await expect(page.locator("#rows")).toContainText("18446744073709551615");
  await context.setOffline(true);
  await expect(page.locator("#status")).toContainText("Offline.");
  await page.locator("#search").fill("produce");
  await expect(page.locator("#rows tr")).toHaveCount(1);
  await page.locator("#search").fill("absent");
  await expect(page.locator("#rows tr")).toHaveCount(0);
  await page.locator("#search").fill("");
  await context.setOffline(false);
  await expect(page.locator("#rows")).toContainText("Grain");
  await expect(page.locator("#rows")).not.toContainText("Produce");
});

test("cold offline reload serves the public shell, JS, worker and real WASM but requires live admission for rows", async ({
  page,
  context,
  request,
}) => {
  const assets = await (await request.get(`${origin}/fixture/app`)).json();
  await ready(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Product categories");
  await expect(page.locator("#status")).toContainText(
    "Reconnect to verify your session",
  );
  await expect(page.locator("#table")).toBeHidden();
  // Exercise the emitted worker and SQLite initialization offline with a test-only scope.
  // The production reader never supplies that scope before live admission.
  await page.evaluate(
    async ({ workerUrl, wasmUrl, scope }) => {
      const worker = new Worker(workerUrl, { type: "module" });
      const channel = new MessageChannel();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Offline worker timed out")),
          15_000,
        );
        worker.onerror = () => reject(new Error("Offline worker failed"));
        worker.onmessage = ({ data }) => {
          if (!data.ok) {
            clearTimeout(timer);
            worker.terminate();
            reject(new Error(data.error.message));
          } else if (data.id === 1)
            worker.postMessage({ id: 2, type: "close" });
          else {
            clearTimeout(timer);
            worker.terminate();
            channel.port1.close();
            resolve();
          }
        };
        worker.postMessage(
          { id: 1, type: "init", scope, wasmUrl, port: channel.port2 },
          [channel.port2],
        );
      });
    },
    {
      workerUrl: assets.worker,
      wasmUrl: new URL(assets.wasm, origin).href,
      scope,
    },
  );
  await context.setOffline(false);
  await expect(page.locator("#rows")).toContainText("Grain");
});

test("asset cache contains only the explicit public generation, with no API, cookie or session responses", async ({
  page,
  request,
}) => {
  const assets = await (await request.get(`${origin}/fixture/app`)).json();
  await ready(page);
  await page.locator("#refresh").click();
  await expect(page.locator("#rows")).toContainText("Grain");
  const cached = await page.evaluate(async () => {
    const keys = (await caches.keys()).filter((key) =>
      key.startsWith("lumiere-category-shell-"),
    );
    return (
      await Promise.all(
        keys.map(async (key) =>
          (await (await caches.open(key)).keys()).map((request) => request.url),
        ),
      )
    )
      .flat()
      .sort();
  });
  expect(cached).toEqual(
    assets.urls.map((path: string) => origin + path).sort(),
  );
});

test("company change in another tab hides and clears the current projection and checkpoint", async ({
  page,
  context,
}) => {
  await ready(page);
  await page.locator("#refresh").click();
  await expect(page.locator("#rows")).toContainText("Grain");
  const other = await context.newPage();
  await other.goto(origin);
  await other.evaluate(() =>
    localStorage.setItem(
      "lumiere:active-company",
      JSON.stringify({ organizationId: 7, companyId: 10 }),
    ),
  );
  await expect(page.locator("#table")).toBeHidden();
  await expect(page.locator("#status")).toContainText(
    "Session or company changed",
  );
  await page.locator("#refresh").click();
  await expect(page.locator("#rows")).toContainText("Produce");
});

test("sign-out broadcast cancels a pending snapshot and no late reply restores rows", async ({
  page,
  context,
  request,
}) => {
  await request.get(`${origin}/fixture/delay?value=true`);
  await page.goto(url);
  await expect(page.locator("#scope")).toContainText("Organization 7");
  const other = await context.newPage();
  await other.goto(origin);
  await other.evaluate(async () => {
    const lifecycle = await import(
      new URL("/offline-lifecycle.js", location.href).href
    );
    lifecycle.revokeOfflineReaders();
  });
  await expect(page.locator("#table")).toBeHidden();
  await request.get(`${origin}/fixture/delay?value=false`);
  await expect(page.locator("#status")).toContainText(
    "Session or company changed",
  );
  await expect(page.locator("#rows tr")).toHaveCount(0);
});

test("an actor change clears the old view before a fresh scoped download", async ({
  page,
  request,
}) => {
  await ready(page);
  await request.get(`${origin}/fixture/actor?value=actor-b`);
  await page.locator("#refresh").click();
  await expect(page.locator("#table")).toBeHidden();
  await expect(page.locator("#status")).toContainText(
    "session or company changed",
  );
  await page.locator("#refresh").click();
  await expect(page.locator("#rows")).toContainText("Produce");
});

test("denied live scope clears rows; an outage retains rows only in an admitted open session", async ({
  page,
  request,
}) => {
  await ready(page);
  await request.get(`${origin}/fixture/status?value=503`);
  await page.locator("#refresh").click();
  await expect(page.locator("#status")).toContainText(
    "Showing saved categories",
  );
  await expect(page.locator("#rows")).toContainText("Produce");
  await request.get(`${origin}/fixture/status?value=403`);
  await page.locator("#refresh").click();
  await expect(page.locator("#table")).toBeHidden();
  await expect(page.locator("#status")).toContainText("Access changed");
  await request.get(`${origin}/fixture/status?value=200`);
  await page.locator("#refresh").click();
  await expect(page.locator("#rows")).toContainText("Produce");
});

test("explicit clearing removes the durable replay checkpoint", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#refresh").click();
  await expect(page.locator("#rows")).toContainText("Grain");
  await page.locator("#clear").click();
  await expect(page.locator("#table")).toBeHidden();
  await page.locator("#refresh").click();
  await expect(page.locator("#rows")).toContainText("Produce");
});

test("access denied during replay clears rows and closes the invalidated worker handle", async ({
  page,
}) => {
  await ready(page);
  await page.route("**/api/offline/product-categories/pull?*", (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: "{}" }),
  );
  await page.locator("#refresh").click();
  await expect(page.locator("#table")).toBeHidden();
  await expect(page.locator("#status")).toHaveText(
    "Access changed. Reconnect to verify your session.",
  );
  await page.unrouteAll();
  await page.locator("#refresh").click();
  await expect(page.locator("#rows")).toContainText("Produce");
});

test("updated shell waits for old clients, then removes only prior category asset caches", async ({
  page,
  context,
  request,
}) => {
  await ready(page);
  const probe = await context.newPage();
  await probe.goto(origin);
  await probe.evaluate(() => caches.open("unrelated-product-cache"));
  await request.get(`${origin}/fixture/sw-generation?value=updated`);
  await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistration())!.update(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          !!(await navigator.serviceWorker.getRegistration())?.waiting,
      ),
    )
    .toBe(true);
  await expect(page.locator("#cache-status")).toContainText(
    "An update is ready",
  );
  const before = await probe.evaluate(() => caches.keys());
  expect(
    before.filter((key) => key.startsWith("lumiere-category-shell-")),
  ).toHaveLength(2);
  await page.close();
  await expect
    .poll(async () =>
      (await probe.evaluate(() => caches.keys())).filter((key) =>
        key.startsWith("lumiere-category-shell-"),
      ),
    )
    .toEqual([before.find((key) => key.endsWith("-updated"))]);
  expect(await probe.evaluate(() => caches.keys())).toContain(
    "unrelated-product-cache",
  );
});

test("failed precache is discarded and never reports offline readiness", async ({
  page,
  request,
}) => {
  await request.get(`${origin}/fixture/missing-asset?value=true`);
  await page.goto(url);
  await expect(page.locator("#cache-status")).toContainText(
    "Offline startup is unavailable",
    { timeout: 15_000 },
  );
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  await request.get(`${origin}/fixture/missing-asset?value=false`);
  await ready(page);
});
