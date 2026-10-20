import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:4179";
const url = `${origin}/offline/categories/index.html?companyId=9`;
const grantKey = "lumiere:offline-category-grant-v1";
test.beforeEach(async ({ context, request }) => {
  await request.get(`${origin}/fixture/status?value=200`);
  await request.get(`${origin}/fixture/delay?value=false`);
  await request.get(`${origin}/fixture/actor?value=actor-a`);
  await request.get(`${origin}/fixture/sw-generation?value=initial`);
  await request.get(`${origin}/fixture/missing-asset?value=false`);
  await request.get(`${origin}/fixture/grants?enabled=true`);
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
test("valid pinned signed grant admits private saved categories on cold offline reload and replays on reconnect", async ({
  page,
  context,
}) => {
  await ready(page);
  expect(
    await page.evaluate((key) => !!localStorage.getItem(key), grantKey),
  ).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#status")).toContainText(
    "Offline access verified",
  );
  await expect(page.locator("#rows")).toContainText("Produce");
  await context.setOffline(false);
  await expect(page.locator("#rows")).toContainText("Grain");
  await expect(page.locator("#status")).toHaveText(
    "Saved categories are up to date.",
  );
});
test("a saved grant cannot admit a different selected company", async ({
  page,
  context,
}) => {
  await ready(page);
  await context.setOffline(true);
  await page.goto(`${origin}/offline/categories/index.html?companyId=10`);
  await expect(page.locator("#status")).toContainText(
    "Offline access is unavailable or expired",
  );
  await expect(page.locator("#table")).toBeHidden();
});
test("tampered lease metadata refuses cold offline admission", async ({
  page,
  context,
}) => {
  await ready(page);
  await page.evaluate((key) => {
    const record = JSON.parse(localStorage.getItem(key)!);
    const claims = JSON.parse(
      atob(record.grant.payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    claims.scope.actorId = "forged-actor";
    record.grant.payload = btoa(JSON.stringify(claims))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    localStorage.setItem(key, JSON.stringify(record));
  }, grantKey);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#table")).toBeHidden();
  await expect(page.locator("#status")).toContainText(
    "Offline access is unavailable or expired",
  );
});
test("expiry while open hides private rows and removes admission metadata", async ({
  page,
  context,
  request,
}) => {
  await request.get(`${origin}/fixture/grants?enabled=true&ttl=10`);
  await ready(page);
  await context.setOffline(true);
  await page.clock.install();
  await page.clock.fastForward(12_000);
  await expect(page.locator("#status")).toContainText(
    "Offline access expired or changed",
  );
  await expect(page.locator("#table")).toBeHidden();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), grantKey),
  ).toBeNull();
});
test("expired lease cannot authorize a fresh offline launch", async ({
  page,
  context,
}) => {
  await ready(page);
  await context.setOffline(true);
  await context.addInitScript(() => {
    const now = Date.now.bind(Date);
    Date.now = () => now() + 3_601_000;
  });
  await page.reload();
  await expect(page.locator("#status")).toContainText(
    "Offline access is unavailable or expired",
  );
  await expect(page.locator("#table")).toBeHidden();
});
test("observed clock rollback fails cold admission", async ({
  page,
  context,
}) => {
  await ready(page);
  await context.setOffline(true);
  await context.addInitScript(() => {
    const now = Date.now.bind(Date);
    Date.now = () => now() - 60_000;
  });
  await page.reload();
  await expect(page.locator("#status")).toContainText(
    "Offline access is unavailable or expired",
  );
  await expect(page.locator("#table")).toBeHidden();
});
test("sign-out in another tab revokes the lease and prevents an offline restart", async ({
  page,
  context,
}) => {
  await ready(page);
  const other = await context.newPage();
  await other.goto(origin);
  await other.evaluate(async () =>
    (
      await import(new URL("/offline-lifecycle.js", location.href).href)
    ).revokeOfflineReaders(),
  );
  await expect(page.locator("#table")).toBeHidden();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), grantKey),
  ).toBeNull();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#status")).toContainText(
    "Offline access is unavailable or expired",
  );
});
test("live denial on reconnect overrides a still-valid offline lease and clears its scoped rows", async ({
  page,
  context,
  request,
}) => {
  await ready(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#rows")).toContainText("Produce");
  await request.get(`${origin}/fixture/status?value=403`);
  await context.setOffline(false);
  await expect(page.locator("#status")).toContainText("Access changed");
  await expect(page.locator("#table")).toBeHidden();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), grantKey),
  ).toBeNull();
  await request.get(`${origin}/fixture/status?value=200`);
  await page.locator("#refresh").click();
  await expect(page.locator("#rows")).toContainText("Produce");
});
test("an actor change on reconnect never reuses the old actor's grant", async ({
  page,
  context,
  request,
}) => {
  await ready(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#rows")).toContainText("Produce");
  await request.get(`${origin}/fixture/actor?value=actor-b`);
  await context.setOffline(false);
  await expect(page.locator("#status")).toContainText(
    "session or company changed",
  );
  await expect(page.locator("#table")).toBeHidden();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), grantKey),
  ).toBeNull();
  await page.locator("#refresh").click();
  await expect(page.locator("#rows")).toContainText("Produce");
  const actor = await page.evaluate((key) => {
    const grant = JSON.parse(localStorage.getItem(key)!).grant;
    return JSON.parse(atob(grant.payload.replace(/-/g, "+").replace(/_/g, "/")))
      .scope.actorId;
  }, grantKey);
  expect(actor).toBe("actor-b");
});
test("failed issuance preserves online reading but provides no cold offline admission", async ({
  page,
  context,
  request,
}) => {
  await request.get(`${origin}/fixture/grants?enabled=true&status=404`);
  await ready(page);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), grantKey),
  ).toBeNull();
  await expect(page.locator("#rows")).toContainText("Produce");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#table")).toBeHidden();
  await expect(page.locator("#status")).toContainText(
    "Offline access is unavailable or expired",
  );
});
