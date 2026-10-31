import { expect, test, type Locator, type Page } from "@playwright/test"

const firstActor = "ab".repeat(32)
const reason =
  "Confirmed the product values against the original farm register."

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    batch_id: "9007199254740993",
    item_id: "9007199254740995",
    revision: 2,
    source_file: "historic-shop.csv",
    source_row: 8,
    source_sha256: "a".repeat(64),
    row_basis: "source_line",
    decision_reason: reason,
    ...overrides,
  }
}

function product(
  name = "Reviewed farm product",
  metadata: unknown = JSON.stringify({ source_review: evidence() }),
) {
  return {
    id: "101",
    organizationId: 8001,
    companyId: 9001,
    name,
    defaultCode: "FARM-101",
    type: "product",
    listPrice: 4800,
    standardPrice: 3000,
    saleOk: true,
    purchaseOk: true,
    active: true,
    metadata,
  }
}

function location() {
  return {
    id: "201",
    organizationId: 8001,
    companyId: 9001,
    name: "Farm cold store",
    usage: "internal",
    active: true,
    // Imported locations can lack completeName. The production table must still let users open them.
    metadata: {
      some: JSON.stringify({
        source_review: evidence({
          source_file: "farm-locations-15.csv",
          source_row: 23,
          source_sha256: "b".repeat(64),
          item_id: "9007199254740996",
          revision: 3,
          row_basis: "import_row",
          decision_reason:
            "Confirmed this location mapping from the original register.",
        }),
      }),
    },
  }
}

async function mockRecords(page: Page, products = [product()]) {
  const reads: Array<{
    resource: string
    actor: string
    company: string | null
    organization: string
  }> = []
  let holdChangedScope = false
  let release = () => {}
  const changedScopeGate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/query/**", async (route) => {
    const url = new URL(route.request().url())
    const resource = url.pathname.split("/").at(-1)!
    if (resource !== "products" && resource !== "stock-locations")
      return route.fulfill({ json: { data: [] } })
    const actor = route.request().headers()["x-fixture-actor"] ?? ""
    const organization =
      route.request().headers()["x-fixture-organization"] ?? ""
    const company = url.searchParams.get("companyId")
    reads.push({ resource, actor, company, organization })
    const originalScope =
      actor === firstActor && company === "9001" && organization === "8001"
    if (holdChangedScope && !originalScope) await changedScopeGate
    const data = originalScope
      ? resource === "products"
        ? products
        : [location()]
      : resource === "products"
        ? []
        : [
            {
              id: "201",
              name: "Authorized location without source metadata",
              usage: "internal",
              active: true,
            },
          ]
    return route.fulfill({ json: { data } })
  })
  return {
    reads,
    holdChangedScope: () => {
      holdChangedScope = true
    },
    release,
  }
}

function sourcePanel(page: Page) {
  return page.getByRole("region", {
    name: "Recorded import source",
    exact: true,
  })
}

function sourceValue(panel: Locator, label: string) {
  return panel.getByText(label, { exact: true }).locator("..").locator("dd")
}

async function openRecord(page: Page, name: string) {
  await page.getByRole("cell", { name, exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
}

test("product details expose exact recorded source after a fresh authorized read", async ({
  page,
}, testInfo) => {
  const server = await mockRecords(page)
  await page.setViewportSize({ width: 1280, height: 1200 })
  await page.goto("/import-source-detail")
  for (const refreshed of [false, true]) {
    if (refreshed) await page.reload()
    await openRecord(page, "Reviewed farm product")
    const panel = sourcePanel(page)
    await expect(sourceValue(panel, "Original file")).toHaveText(
      "historic-shop.csv",
    )
    await expect(sourceValue(panel, "Source line")).toHaveText("8")
    await expect(sourceValue(panel, "Recorded file SHA-256")).toHaveText(
      "a".repeat(64),
    )
    await expect(sourceValue(panel, "Review batch")).toHaveText(
      "9007199254740993",
    )
    await expect(sourceValue(panel, "Review item")).toHaveText(
      "9007199254740995",
    )
    await expect(sourceValue(panel, "Review revision")).toHaveText("2")
    await expect(sourceValue(panel, "Review decision reason")).toHaveText(
      reason,
    )
    await expect(panel.getByText(/verified|posted/i)).toHaveCount(0)
  }
  expect(
    server.reads.filter((read) => read.resource === "products"),
  ).toHaveLength(2)
  await page.screenshot({
    path: testInfo.outputPath("product-record-import-source.png"),
    fullPage: true,
  })
})

test("location details retain filename row basis and revision after refresh", async ({
  page,
}, testInfo) => {
  const server = await mockRecords(page)
  await page.setViewportSize({ width: 1280, height: 1200 })
  await page.goto("/import-source-detail?tab=locations")
  for (const refreshed of [false, true]) {
    if (refreshed) await page.reload()
    await openRecord(page, "Farm cold store")
    const panel = sourcePanel(page)
    await expect(sourceValue(panel, "Original file")).toHaveText(
      "farm-locations-15.csv",
    )
    await expect(sourceValue(panel, "Import row")).toHaveText("23")
    await expect(panel.getByText("Source line", { exact: true })).toHaveCount(0)
    await expect(sourceValue(panel, "Recorded file SHA-256")).toHaveText(
      "b".repeat(64),
    )
    await expect(sourceValue(panel, "Review batch")).toHaveText(
      "9007199254740993",
    )
    await expect(sourceValue(panel, "Review item")).toHaveText(
      "9007199254740996",
    )
    await expect(sourceValue(panel, "Review revision")).toHaveText("3")
  }
  expect(
    server.reads.filter((read) => read.resource === "stock-locations"),
  ).toHaveLength(2)
  await page.screenshot({
    path: testInfo.outputPath("location-record-import-source.png"),
    fullPage: true,
  })
})

test("absent malformed and unsupported metadata do not render source proof", async ({
  page,
}) => {
  const rows = [
    product("No source metadata", null),
    { ...product("Malformed metadata", "{not JSON}"), id: "102" },
    {
      ...product(
        "Unsupported source metadata",
        JSON.stringify({
          source_review: evidence({
            version: 2,
            source_file: "forged-proof.csv",
          }),
        }),
      ),
      id: "103",
    },
    {
      ...product(
        "Invalid source hash",
        JSON.stringify({
          source_review: evidence({
            source_sha256: "not-a-hash",
            source_file: "forged-proof.csv",
          }),
        }),
      ),
      id: "104",
    },
  ]
  await mockRecords(page, rows)
  await page.goto("/import-source-detail")
  for (const row of rows) {
    await openRecord(page, row.name)
    await expect(sourcePanel(page)).toHaveCount(0)
    await expect(
      page.getByRole("dialog").getByText("forged-proof.csv", { exact: true }),
    ).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
  }
})

test("source filenames and decision reasons render only as text", async ({
  page,
}) => {
  const literal =
    '<a href="https://example.invalid/forged">Review note</a><script>window.importSourceExecuted = true</script>'
  const filename =
    '<img src="missing" onerror="window.importSourceExecuted = true">.csv'
  await mockRecords(page, [
    product(
      "Literal source metadata",
      JSON.stringify({
        source_review: evidence({
          source_file: filename,
          decision_reason: literal,
        }),
      }),
    ),
  ])
  await page.goto("/import-source-detail")
  await openRecord(page, "Literal source metadata")
  const panel = sourcePanel(page)
  await expect(sourceValue(panel, "Original file")).toHaveText(filename)
  await expect(sourceValue(panel, "Review decision reason")).toHaveText(literal)
  await expect(panel.locator("a,script,img")).toHaveCount(0)
  expect(
    await page.evaluate(() => Object.hasOwn(window, "importSourceExecuted")),
  ).toBe(false)
})

for (const change of ["actor", "company", "organization"] as const) {
  test(`changing ${change} dismisses open location details before the new scope resolves`, async ({
    page,
  }) => {
    const server = await mockRecords(page)
    await page.goto("/import-source-detail?tab=locations")
    await openRecord(page, "Farm cold store")
    await expect(sourcePanel(page)).toBeVisible()
    server.holdChangedScope()
    try {
      await page.evaluate((scope) => {
        const channel = new BroadcastChannel("synthetic-import-detail-controls")
        channel.postMessage(scope)
        channel.close()
      }, change)
      await expect
        .poll(() =>
          server.reads.some(
            (read) =>
              read.actor !== firstActor ||
              read.company !== "9001" ||
              read.organization !== "8001",
          ),
        )
        .toBe(true)
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await expect(sourcePanel(page)).toHaveCount(0)
      server.release()
      await openRecord(page, "Authorized location without source metadata")
      await expect(sourcePanel(page)).toHaveCount(0)
      await expect(
        page
          .getByRole("dialog")
          .getByText("farm-locations-15.csv", { exact: true }),
      ).toHaveCount(0)
    } finally {
      server.release()
      await page.unrouteAll({ behavior: "wait" })
    }
  })
}
