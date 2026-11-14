import { writeFile } from "node:fs/promises"

import { devices, expect, test, type Page } from "@playwright/test"
import { buildNavGroups } from "@lumiere/ui/lib/navigation-catalog"
import { isWorkspaceSurfaceVisible } from "@lumiere/ui/lib/workspace-profile"

import { expectNoAppError, openErpAiChat, scalarQueryId, signIn } from "./e2e/helpers"
import { expectCanonicalPickingFocus } from "./e2e/inventory-picking-fixtures"

test.use({ ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } })

const profile = "finance-alpha"
const alphaRoutes = buildNavGroups((key) => key, { workspaceProfile: profile })
  .flatMap(({ items }) => items)
  .map(({ surfaceId, href }) => ({ surfaceId, href }))

async function openHistory(page: Page, route: string, mode: "side" | "full") {
  const response = await page.goto(route, { waitUntil: "domcontentloaded" })
  expect(response?.ok(), `Alpha route ${route} must load`).toBe(true)
  await expect(page).toHaveURL((url) => url.pathname === route)
  await openErpAiChat(page)
  const assistant = page.getByTestId("erp-ai-chat-panel")
  if (mode === "full") {
    await assistant.getByRole("button", { name: "Open full workspace", exact: true }).click()
  }
  await expect(assistant).toHaveAttribute("data-mode", mode)
  await assistant.getByRole("button", { name: "History", exact: true }).click()
  await expect(assistant.getByRole("searchbox", { name: "Search conversations", exact: true })).toBeVisible()
  await expect(assistant.getByRole("button", { name: "Fresh thread", exact: true })).toBeVisible()
  await expectNoAppError(page)
}

test("opens personal Assistant history across the complete Finance Alpha profile", async ({ page }, info) => {
  test.setTimeout(240_000)
  expect(alphaRoutes).toHaveLength(16)
  expect(new Set(alphaRoutes.map(({ surfaceId }) => surfaceId)).size).toBe(16)
  expect(isWorkspaceSurfaceVisible(profile, "ai-assistant")).toBe(true)
  await signIn(page)
  const visited: string[] = []
  for (const { surfaceId, href } of alphaRoutes) {
    await test.step(surfaceId, () => openHistory(page, href, "side"))
    visited.push(surfaceId)
  }
  await test.step("ai-assistant", () => openHistory(page, "/overview", "full"))
  visited.push("ai-assistant")
  await writeFile(info.outputPath("alpha-history-surfaces.json"), JSON.stringify(visited))
})

async function readTransfer(page: Page, id: number) {
  const response = await page.request.get("/api/query/stock-pickings")
  expect(response.ok()).toBe(true)
  const payload = (await response.json()) as { data: { id: unknown; name: string; state: string }[] }
  const row = payload.data.find((candidate) => scalarQueryId(candidate.id) === id)
  expect(row?.name).toBe("WH/IN/SEED-0001")
  return row
}

test("reopens an exact current Warehouse transfer from archived chat without writes", async ({ page }) => {
  const id = Number(process.env.ASSISTANT_HISTORY_WAREHOUSE_TRANSFER)
  expect(Number.isSafeInteger(id) && id > 0, "Run with the seeded assistant-history CI fixture").toBe(true)
  await signIn(page)
  await page.goto("/warehouse")
  const before = await readTransfer(page, id)
  await openErpAiChat(page)
  const assistant = page.getByTestId("erp-ai-chat-panel")
  await assistant.getByRole("button", { name: "History", exact: true }).click()
  await assistant.getByRole("button", { name: "Archived", exact: true }).click()
  await assistant.getByRole("button", { name: "Warehouse archived outcome", exact: true }).click()
  await expect(assistant.getByText("Restore this conversation to continue.", { exact: true })).toBeVisible()
  await expect(assistant.getByTestId("erp-ai-chat-input")).toHaveCount(0)

  const writes: string[] = []
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname
    if (request.method() === "POST" && /^\/api\/(?:operations|reducers?)\//.test(pathname)) writes.push(pathname)
  })
  const card = assistant.getByTestId("assistant-native-action")
  await card.getByRole("button", { name: `Open stock transfer #${id}`, exact: true }).click()
  await expectCanonicalPickingFocus(page, id)
  expect(await readTransfer(page, id)).toEqual(before)
  expect(writes).toEqual([])
})

test("reviews the seeded Warehouse receipt and opens the count wizard without writing stock", async ({ page }) => {
  const id = Number(process.env.ASSISTANT_HISTORY_WAREHOUSE_TRANSFER)
  expect(Number.isSafeInteger(id) && id > 0, "Run with the seeded assistant-history CI fixture").toBe(true)
  await signIn(page)
  await page.goto("/warehouse")
  const before = await readTransfer(page, id)
  await openErpAiChat(page)
  const assistant = page.getByTestId("erp-ai-chat-panel")
  await assistant.getByRole("button", { name: "History", exact: true }).click()
  await assistant.getByRole("button", { name: "New chat", exact: true }).click()
  const input = assistant.getByTestId("erp-ai-chat-input")
  const writes: string[] = []
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname
    if (request.method() === "POST" && /^\/(?:api|v1)\/(?:operations|compat\/reducer)\/.*stock/.test(pathname)) writes.push(pathname)
  })
  await input.fill(`Receive stock transfer ${id}`)
  await assistant.getByTestId("erp-ai-chat-send").click()
  await assistant.getByRole("button", { name: `Review stock transfer receipt #${id}`, exact: true }).click()
  await expect(page).toHaveURL((url) =>
    url.pathname === `/inventory/transfers/${id}` && url.searchParams.get("tab") === "operations",
  )
  const transfer = page.getByTestId("transfer-page")
  await expect(transfer.getByTestId("transfer-title")).toHaveText("WH/IN/SEED-0001")
  await expect(transfer.getByRole("tab", { name: "Detailed operations" })).toHaveAttribute("aria-selected", "true")
  await expect(transfer.getByRole("link", { name: "Warehouse", exact: true })).toHaveAttribute("href", "/warehouse")
  expect(await readTransfer(page, id)).toEqual(before)
  await page.goto("/warehouse")
  await openErpAiChat(page)
  await input.fill("Open cycle count wizard")
  await assistant.getByTestId("erp-ai-chat-send").click()
  await assistant.getByRole("button", { name: "Open cycle count wizard", exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname === "/warehouse" && url.searchParams.get("tab") === "cycle-wizard")
  await expect(page.getByTestId("module-tab-warehouse-cycle-wizard")).toHaveAttribute("aria-selected", "true")
  expect(writes).toEqual([])
})

test("saves a chart from Assistant and reopens its exact placement from archived history", async ({ page }) => {
  test.setTimeout(180_000)
  const companyId = process.env.ASSISTANT_HISTORY_COMPANY
  expect(companyId).toBeTruthy()
  await signIn(page)
  await page.goto("/overview")
  await openErpAiChat(page)
  const assistant = page.getByTestId("erp-ai-chat-panel")
  const history = assistant.getByRole("button", { name: "History", exact: true })
  const title = "Overview chart proposal"
  const widgetName = "Assistant history Sales count"
  await history.click()
  await assistant.getByRole("button", { name: title, exact: true }).click()
  await assistant.getByTestId("assistant-native-action")
    .getByRole("button", { name: "Add widget to overview", exact: true }).click()
  const gallery = page.getByRole("dialog", { name: "Add widget", exact: true })
  await gallery.getByRole("button", { name: "Create new widget", exact: true }).click()
  await page.getByTestId("qb-model").click()
  await page.getByRole("option", { name: "Sale Order", exact: true }).click()
  await expect(page.getByTestId("qb-source-row-count")).toContainText(/\d+ rows? loaded/)
  await page.getByTestId("qb-group-by").click()
  await page.getByRole("option", { name: "State", exact: true }).click()
  await page.getByTestId("qb-name").fill(widgetName)
  await page.getByTestId("qb-save").click()
  await expect(page.getByRole("dialog", { name: "Build a widget", exact: true })).toHaveCount(0)
  const receiptSaved = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/ai/chat/widget-receipts" && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: "Done", exact: true }).click()
  const savedResponse = await receiptSaved
  expect(savedResponse.ok(), "The saved layout must publish its Assistant receipt").toBe(true)
  const saved = (await savedResponse.json()) as { widgetId: string; requestId: string }
  await page.reload({ waitUntil: "domcontentloaded" })
  await openErpAiChat(page)
  await history.click()
  await assistant.getByRole("button", { name: title, exact: true }).click()
  await assistant.getByRole("button", { name: "Archive", exact: true }).click()
  await expect(assistant.getByText("Restore this conversation to continue.", { exact: true })).toBeVisible()
  const link = assistant.getByRole("link", { name: "Open current view for Saved chart", exact: true })
  await expect(link).toBeVisible()
  const writes: string[] = []
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith("/api/") && /^(?:PUT|PATCH|DELETE)$/.test(request.method())) writes.push(path)
    if (request.method() === "POST" && /^\/api\/(?:operations|reducers?|ai\/chat\/widget-receipts)(?:\/|$)/.test(path)) writes.push(path)
  })
  await link.click()
  await expect(page).toHaveURL((url) =>
    url.pathname === "/overview" &&
    url.searchParams.get("savedWidget") === saved.widgetId &&
    url.searchParams.get("savedWidgetCompany") === companyId &&
    url.searchParams.get("savedWidgetPlacement") === `assistant-${saved.requestId}`,
  )
  const widget = page.locator(`[data-saved-widget-id="${saved.widgetId}"][data-placement-id="assistant-${saved.requestId}"]`)
  await expect(widget).toContainText(widgetName)
  await expect(widget).toBeFocused()
  await expect(page.getByRole("button", { name: "Done", exact: true })).toHaveCount(0)
  expect(writes).toEqual([])
})
