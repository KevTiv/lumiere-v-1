import { expect, test, type Page } from "@playwright/test"
import type { WebMcpModelContext } from "../lib/assistant-webmcp"

type Tool = Parameters<WebMcpModelContext["registerTool"]>[0]
type BrowserFixtureDocument = Document & {
  modelContext: WebMcpModelContext & { getTools(): Tool[]; registrations: number }
}

async function installModelContext(page: Page) {
  await page.addInitScript(() => {
    const tools = new Map<Tool["name"], Tool>()
    const modelContext: BrowserFixtureDocument["modelContext"] = {
      registrations: 0,
      async registerTool(tool, { signal }) {
        this.registrations += 1
        if (tools.has(tool.name)) throw new Error("Tool name is already registered.")
        tools.set(tool.name, tool)
        signal.addEventListener("abort", () => tools.delete(tool.name), { once: true })
      },
      getTools: () => [...tools.values()],
    }
    Object.defineProperty(document, "modelContext", { configurable: true, value: modelContext })
  })
}

function toolNames(page: Page) {
  return page.evaluate(() => (document as BrowserFixtureDocument).modelContext.getTools().map(tool => tool.name))
}

function executeTool(page: Page, name: Tool["name"], input: Record<string, string>) {
  return page.evaluate(({ name, input }) => {
    const tool = (document as BrowserFixtureDocument).modelContext.getTools().find(tool => tool.name === name)
    if (!tool) throw new Error("Tool is unavailable.")
    return tool.execute(input)
  }, { name, input })
}

test("both tools navigate through the current dispatcher without duplicate registration", async ({ page }) => {
  await installModelContext(page)
  await page.goto("/assistant-webmcp")
  await expect.poll(() => toolNames(page)).toEqual(["open_inventory_record", "open_import_review"])
  const registrations = await page.evaluate(() => (document as BrowserFixtureDocument).modelContext.registrations)

  const productId = "42"
  expect(await executeTool(page, "open_inventory_record", { productId })).toEqual({ status: "opened" })
  await expect(page.getByTestId("destination")).toHaveText(JSON.stringify({ kind: "open_inventory_record", productId }))

  const taskId = "0123456789abcdef0123456789abcdef"
  expect(await executeTool(page, "open_import_review", { taskId })).toEqual({ status: "opened" })
  await expect(page.getByTestId("destination")).toHaveText(JSON.stringify({ kind: "open_import_review", taskId }))
  expect(await page.evaluate(() => (document as BrowserFixtureDocument).modelContext.registrations)).toBe(registrations)
})

test("route changes, company switches and sign-out retire active tool registrations", async ({ page }) => {
  await installModelContext(page)
  await page.goto("/assistant-webmcp")
  await expect.poll(() => toolNames(page)).toHaveLength(2)
  await page.getByRole("button", { name: "Pause next navigation" }).click()

  const oldCall = executeTool(page, "open_inventory_record", { productId: "42" })
  await expect(page.getByTestId("pending")).toHaveText("pending")
  await page.getByRole("button", { name: "Change route" }).click()
  expect(await oldCall).toEqual({ status: "scope_changed" })
  await expect.poll(() => toolNames(page)).toHaveLength(2)

  const companyCall = executeTool(page, "open_import_review", { taskId: "0123456789abcdef0123456789abcdef" })
  await expect(page.getByTestId("pending")).toHaveText("pending")
  await page.getByRole("button", { name: "Switch company" }).click()
  expect(await companyCall).toEqual({ status: "scope_changed" })
  await expect.poll(() => toolNames(page)).toEqual([])

  await page.getByRole("button", { name: "Return to pilot company" }).click()
  await expect.poll(() => toolNames(page)).toHaveLength(2)
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect.poll(() => toolNames(page)).toEqual([])
  await expect(page.getByTestId("destination")).toBeEmpty()
})

test("an unsupported browser leaves the workspace available", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "modelContext", { value: undefined })
  })
  await page.goto("/assistant-webmcp")
  await expect(page.getByRole("heading", { name: "Assistant WebMCP fixture" })).toBeVisible()
  await page.getByRole("button", { name: "Change route" }).click()
  await expect(page.getByTestId("route")).toHaveText("/settings")
})
