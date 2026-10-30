import { expect, test, type Page } from "@playwright/test"
import { activeTabEntityTable, gotoModule, scalarQueryId } from "./helpers"

const VISIBLE = ["overview", "tasks", "approvals", "accounting", "sales", "crm", "purchasing", "reports", "subscriptions", "expenses", "documents", "calendar", "settings"]
const HIDDEN = ["messages", "inventory", "distributor", "pos", "manufacturing", "map", "fleet", "helpdesk", "workflows", "hr", "projects", "proposals", "forensics", "trackers", "ai-skills", "ai-action-drafts", "iot"]
const sidebar = (page: Page) => page.locator('[data-testid="dashboard-sidebar"]:visible')

async function expectFinanceNavigation(page: Page) {
  if (await page.evaluate(() => window.matchMedia("(max-width: 767px)").matches)) {
    const toggle = page.getByTestId("workspace-navigation-toggle")
    await expect(toggle).toBeVisible()
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.focus()
      await expect(toggle).toBeFocused()
      await toggle.press("Enter")
      await expect(toggle).toHaveAttribute("aria-expanded", "true")
    }
  }
  await expect(sidebar(page)).toHaveCount(1)
  await expect.poll(() => sidebar(page).locator("nav a").evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")?.slice(1)).sort(),
  )).toEqual([...VISIBLE].sort())
  for (const id of HIDDEN) await expect(sidebar(page).getByTestId(`sidebar-link-${id}`)).toHaveCount(0)
  await expect(sidebar(page).getByRole("button", { name: "Open Journal", exact: true })).toHaveCount(0)
  await expect(sidebar(page).getByRole("button", { name: "Open Notebook", exact: true })).toHaveCount(0)
  await expect(page.getByTestId("notification-bell")).toHaveCount(0)
}

async function expectVisibleReceipt(page: Page, receiptId: number) {
  await expect(page).toHaveURL((url) => url.pathname === "/inventory"
    && url.searchParams.get("tab") === "transfers"
    && url.searchParams.getAll("filter").length === 1
    && url.searchParams.get("filter") === `id:${receiptId}`)
  // Next.js can retain an earlier route tree hidden during client navigation.
  const module = page.locator('[data-testid="module-view-inventory"]:visible')
  await expect(module).toHaveCount(1)
  await expect(module.getByTestId("module-tab-inventory-transfers")).toHaveAttribute("aria-selected", "true")
  const table = activeTabEntityTable(page)
  await expect(table.getByTestId(`entity-row-${receiptId}`)).toBeVisible()
  await expect(table.locator('[data-testid^="entity-row-"]')).toHaveCount(1)
  await expect(table.getByTestId("entity-active-filter-id")).toContainText(`id: ${receiptId}`)
}

function observeWrites(page: Page) {
  const writes: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/(?:api|v1)\/(?:operations|compat\/reducer)\//.test(new URL(request.url()).pathname)) writes.push(request.url())
  })
  return writes
}

test.describe("Finance Alpha discovery", { tag: ["@p0", "@finance-alpha"] }, () => {
  for (const width of [1440, 390]) {
    test(`keeps Finance navigation and command search at ${width}px`, async ({ page }) => {
      const writes = observeWrites(page)
      await page.setViewportSize({ width, height: 900 })
      await gotoModule(page, "/reports", "reports")
      await expectFinanceNavigation(page)
      if (width < 768) {
        await sidebar(page).getByRole("button", { name: "Close navigation", exact: true }).click()
        await expect(sidebar(page)).toHaveCount(0)
        await expect(page.getByTestId("workspace-navigation-toggle")).toHaveAttribute("aria-expanded", "false")
      } else {
        await sidebar(page).getByRole("button", { name: "Collapse navigation", exact: true }).click()
        await expectFinanceNavigation(page)
      }
      await page.keyboard.press("Control+k")
      const palette = page.getByRole("dialog", { name: "Command Palette", exact: true })
      await expect(palette).toBeVisible()
      for (const name of ["Accounting", "Sales", "Purchasing", "Reports", "Expenses", "Settings"]) {
        await expect(palette.getByRole("option", { name, exact: true })).toBeVisible()
      }
      for (const name of ["Messages", "Journal", "Notebook", "Inventory", "Manufacturing", "Projects", "Human Resources", "AI Skills", "IoT"]) {
        await expect(palette.getByRole("option", { name, exact: true })).toHaveCount(0)
      }
      const box = await palette.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
      await palette.getByRole("combobox").fill("Inventory")
      await expect(palette.getByRole("option", { name: "Inventory", exact: true })).toHaveCount(0)
      await page.keyboard.press("Escape")
      await expect(palette).toBeHidden()
      await expectFinanceNavigation(page)
      await sidebar(page).getByTestId("sidebar-link-accounting").click()
      await expect(page).toHaveURL(/\/accounting$/)
      await page.goBack()
      await expect(page).toHaveURL(/\/reports$/)
      await expectFinanceNavigation(page)
      expect(writes).toEqual([])
      await page.screenshot({ path: test.info().outputPath(`finance-navigation-${width}.png`), fullPage: false })
    })
  }

  test("keeps supporting Settings and limits form and import catalogs", async ({ page }) => {
    const writes = observeWrites(page)
    await gotoModule(page, "/settings")
    for (const id of ["profile", "organization", "users", "roles", "audit", "form-config", "custom-fields"]) {
      await expect(page.getByTestId(`settings-section-${id}`)).toBeVisible()
    }
    await expect(page.getByRole("button", { name: /AI chat archive/ })).toHaveCount(0)
    await page.getByTestId("settings-section-imports").click()
    await page.getByTestId("guided-import-entity").click()
    for (const name of ["Contacts", "Products", "Employees", "Departments", "Journal entries", "Expenses", "Subscriptions"]) {
      await expect(page.getByRole("option", { name, exact: true })).toBeVisible()
    }
    for (const name of ["Stock quantities", "Warehouses", "Projects", "Timesheets", "Payslips", "Manufacturing orders", "Tickets"]) {
      await expect(page.getByRole("option", { name, exact: true })).toHaveCount(0)
    }
    await page.keyboard.press("Escape")
    await page.getByTestId("settings-section-form-config").click()
    const cards = page.locator('[data-testid^="form-config-module-"]:visible')
    await expect(cards).toHaveCount(9)
    for (const id of ["accounting", "sales", "crm", "purchasing", "reports", "subscriptions", "expenses", "documents", "calendar"]) {
      await expect(page.getByTestId(`form-config-module-${id}`)).toBeVisible()
    }
    await expect(page.getByTestId("form-config-module-journal")).toHaveCount(0)
    for (const id of ["inventory", "hr", "projects", "manufacturing", "helpdesk", "proposals", "forensic"]) {
      await expect(page.getByTestId(`form-config-module-${id}`)).toHaveCount(0)
    }
    await page.reload()
    await page.getByTestId("settings-section-organization").click()
    await expect(page.getByRole("button", { name: /Import AI agents/i })).toHaveCount(0)
    expect(writes).toEqual([])
    await page.screenshot({ path: test.info().outputPath("finance-support-settings.png"), fullPage: false })
  })

  test("removes standalone stock and project discovery from Overview", async ({ page }) => {
    const writes = observeWrites(page)
    await gotoModule(page, "/overview")
    const main = page.locator("main:visible")
    await expect(main.getByTestId("owner-control-loop")).toBeVisible()
    await expect(main.locator('a[href^="/inventory"], a[href^="/projects"]')).toHaveCount(0)
    await expect(main.getByRole("button", { name: "Log time", exact: true })).toHaveCount(0)
    await expect(main.getByRole("link", { name: /Review owner reports/ })).toBeVisible()
    await page.reload()
    await expectFinanceNavigation(page)
    await expect(main.locator('a[href^="/inventory"], a[href^="/projects"]')).toHaveCount(0)
    expect(writes).toEqual([])
  })

  test("opens an existing purchase receipt without exposing Inventory in global navigation", async ({ page }) => {
    const writes = observeWrites(page)
    // Select an existing explicit PO/receipt relation; do not infer a handoff by dates or names.
    const response = await page.request.get("/api/query/stock-pickings")
    expect(response.ok()).toBe(true)
    const payload = await response.json() as { data: Array<Record<string, unknown>> }
    const receipt = payload.data.find((row) => scalarQueryId(row.purchaseId ?? row.purchase_id) != null
      && String(row.pickingCode ?? row.picking_code) === "incoming" && !(row.isReturn ?? row.is_return))
    expect(receipt, "Seeded fixture must contain a PO-owned incoming receipt").toBeTruthy()
    const orderId = scalarQueryId(receipt!.purchaseId ?? receipt!.purchase_id)!
    const receiptId = scalarQueryId(receipt!.id)!
    await gotoModule(page, `/purchasing?tab=orders&filter=${encodeURIComponent(`id:${orderId}`)}`, "purchasing")
    await activeTabEntityTable(page).getByTestId(`entity-row-${orderId}`).click()
    const sheet = page.locator('[data-slot="sheet-content"]:visible')
    await sheet.getByTestId("entity-record-sheet-tab-handoffs").click()
    await sheet.getByTestId(`purchase-order-handoff-picking-${receiptId}`).click()
    await expectVisibleReceipt(page, receiptId)
    await expectFinanceNavigation(page)
    await page.reload()
    await expectVisibleReceipt(page, receiptId)
    await expectFinanceNavigation(page)
    await page.goBack()
    await expect(page).toHaveURL((url) => url.pathname === "/purchasing" && url.searchParams.get("filter") === `id:${orderId}`)
    expect(writes).toEqual([])
  })
})
