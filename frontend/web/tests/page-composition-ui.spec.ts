import { expect, test, type Page } from "@playwright/test"

const errors = new WeakMap<Page, string[]>()
const apiRequests = new WeakMap<Page, string[]>()

test.use({ viewport: { width: 1440, height: 1100 } })
test.beforeEach(async ({ page }) => {
  const browserErrors: string[] = []
  const requests: string[] = []
  errors.set(page, browserErrors)
  apiRequests.set(page, requests)
  page.on("pageerror", (error) => browserErrors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text())
  })
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      requests.push(request.url())
  })
  await page.goto("/page-composition")
  await expect(page.getByTestId("page-composition-fixture")).toHaveAttribute(
    "data-hydrated",
    "true",
  )
})
test.afterEach(async ({ page }) => {
  expect(errors.get(page), "Production editor has no browser errors").toEqual(
    [],
  )
  expect(
    apiRequests.get(page),
    "Synthetic adapter never calls ERP APIs",
  ).toEqual([])
})

test("gallery preview, adding, sizing and drag reorder persist through reload", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "Edit page", exact: true }).click()
  await page.getByRole("button", { name: "Add widget", exact: true }).click()
  const gallery = page.getByRole("dialog", { name: "Add widget", exact: true })
  await gallery
    .getByRole("textbox", { name: "Search widgets" })
    .fill("Invoices by month")
  await expect(gallery.locator(".recharts-bar").first()).toBeVisible()
  await gallery.getByRole("combobox", { name: "New widget width" }).click()
  await page.getByRole("option", { name: "Full width", exact: true }).click()
  const galleryScreenshot = testInfo.outputPath("page-composition-gallery.png")
  await page.screenshot({ path: galleryScreenshot, fullPage: true })
  await testInfo.attach("Widget gallery", {
    path: galleryScreenshot,
    contentType: "image/png",
  })
  await gallery
    .getByRole("button", { name: "Add to page", exact: true })
    .click()

  const grid = page.getByTestId("page-composition-grid")
  const added = grid.locator('[data-widget-key="saved:101"]')
  await expect(added.locator(".recharts-bar").first()).toBeVisible()
  await expect(added.getByText("Sample company", { exact: true })).toBeVisible()
  await expect(
    added.getByText("August–November 2026 via invoice_date"),
  ).toBeVisible()
  await expect(added.getByText("Records", { exact: true })).toBeVisible()
  await added
    .getByRole("combobox", { name: "Width of Invoices by month" })
    .click()
  await page.getByRole("option", { name: "Wide", exact: true }).click()
  await added
    .getByRole("button", {
      name: "Move Invoices by month earlier",
      exact: true,
    })
    .click()
  await expect(grid.locator("[data-placement-id]").nth(3)).toHaveAttribute(
    "data-widget-key",
    "saved:101",
  )

  await grid
    .getByRole("button", { name: "Drag Open orders", exact: true })
    .dragTo(
      grid.getByRole("button", {
        name: "Drag Confirmed order value",
        exact: true,
      }),
    )
  await expect(grid.locator("[data-placement-id]").first()).toHaveAttribute(
    "data-widget-key",
    "builtin:open-orders",
  )
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1)
  const editorScreenshot = testInfo.outputPath("page-composition-editor.png")
  await page.screenshot({ path: editorScreenshot, fullPage: true })
  await testInfo.attach("Edited page", {
    path: editorScreenshot,
    contentType: "image/png",
  })

  await page.getByRole("button", { name: "Done", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Edit page", exact: true }),
  ).toBeVisible()
  const snapshot = JSON.parse(
    (await page.getByTestId("fixture-saved-layout").textContent()) ?? "{}",
  )
  expect(snapshot.revision).toBe("1")
  expect(snapshot.value).toHaveLength(5)
  expect(snapshot.value[0].widgetId).toBe("open-orders")
  expect(
    snapshot.value.find(
      (widget: { widgetId: string }) => widget.widgetId === "101",
    ).width,
  ).toBe(8)
  await page.reload()
  await expect(page.getByTestId("page-composition-fixture")).toHaveAttribute(
    "data-hydrated",
    "true",
  )
  await expect(page.getByTestId("fixture-saved-layout")).toHaveText(
    JSON.stringify(snapshot),
  )
  await expect(
    page.getByText("Invoices by month", { exact: true }),
  ).toBeVisible()
})

test("assistant additions use the same cancellable draft and reset restores the template", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Simulate assistant add", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Done", exact: true }),
  ).toBeVisible()
  const grid = page.getByTestId("page-composition-grid")
  await expect(
    grid.locator('[data-widget-key="saved:102"] .recharts-pie'),
  ).toBeVisible()
  await page.getByRole("button", { name: "Work review", exact: true }).click()
  await expect(grid.locator("[data-placement-id]")).toHaveCount(2)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(grid.locator('[data-widget-key="saved:102"]')).toHaveCount(1)
  await expect(page.getByTestId("fixture-saved-layout")).toHaveText(
    '{"value":null,"revision":null}',
  )
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(
    page.getByText("Invoice payment status", { exact: true }),
  ).toHaveCount(0)

  await page
    .getByRole("button", { name: "Simulate assistant add", exact: true })
    .click()
  await page.getByRole("button", { name: "Done", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Edit page", exact: true }),
  ).toBeVisible()
  const saved = await page.getByTestId("fixture-saved-layout").textContent()
  await page.getByRole("button", { name: "Edit page", exact: true }).click()
  await page
    .getByRole("button", { name: "Reset to default", exact: true })
    .click()
  await expect(grid.locator('[data-widget-key="saved:102"]')).toHaveCount(0)
  await page.getByRole("button", { name: "Undo", exact: true }).click()
  await expect(grid.locator('[data-widget-key="saved:102"]')).toHaveCount(1)
  await page.getByRole("button", { name: "Redo", exact: true }).click()
  await expect(grid.locator('[data-widget-key="saved:102"]')).toHaveCount(0)
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByTestId("fixture-saved-layout")).toHaveText(saved ?? "")

  await page.getByRole("button", { name: "Edit page", exact: true }).click()
  await page
    .getByRole("button", { name: "Reset to default", exact: true })
    .click()
  await page.getByRole("button", { name: "Done", exact: true }).click()
  await expect(page.getByTestId("fixture-saved-layout")).toHaveText(
    '{"value":null,"revision":"2"}',
  )
  await page.reload()
  await expect(page.getByTestId("page-composition-fixture")).toHaveAttribute(
    "data-hydrated",
    "true",
  )
  await expect(
    page.getByText("Invoice payment status", { exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByText("Monthly order value", { exact: true }),
  ).toBeVisible()

  await page
    .getByRole("button", { name: "Simulate assistant request", exact: true })
    .click()
  const gallery = page.getByRole("dialog", { name: "Add widget", exact: true })
  await expect(
    gallery.getByRole("textbox", { name: "Search widgets" }),
  ).toHaveValue("")
  await expect(gallery).toContainText("Show invoice metrics on this page")
  await gallery.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
})
