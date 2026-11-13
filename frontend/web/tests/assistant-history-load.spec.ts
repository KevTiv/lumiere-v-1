import { writeFile } from "node:fs/promises"

import { expect, test } from "@playwright/test"

import { openErpAiChat, signIn } from "./e2e/helpers"

test("keeps the authenticated mobile transcript bounded and preserves drafts across history navigation", async ({ page, context }, info) => {
  const company = process.env.ASSISTANT_HISTORY_COMPANY
  const thread = process.env.ASSISTANT_HISTORY_SESSION
  const message = process.env.ASSISTANT_HISTORY_MESSAGE
  expect(company, "Run this test with the seeded assistant-history CI fixture").toBeTruthy()
  expect(thread).toBeTruthy()
  expect(message).toBeTruthy()
  await signIn(page)
  await page.goto("/overview")
  await openErpAiChat(page)

  const panel = page.getByTestId("erp-ai-chat-panel")
  const input = panel.getByTestId("erp-ai-chat-input")
  const history = panel.getByRole("button", { name: "History", exact: true })
  const messages = panel.locator('[data-testid^="erp-ai-chat-message-"]')
  const older = panel.getByRole("button", { name: "Load older messages", exact: true })
  const search = panel.getByRole("searchbox", { name: "Search conversations", exact: true })
  const title = "Products long-thread acceptance"
  const draft = "Keep this question after visiting another conversation."
  const cdp = await context.newCDPSession(page)
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage")
    return (await cdp.send("Runtime.getHeapUsage")).usedSize
  }

  await expect(panel).toHaveAttribute("data-mode", "full")
  await history.click()
  await search.fill("PRODUCTS-RECENT-CATALOG-2026")
  await panel.getByRole("button", { name: title, exact: true }).click()
  await expect(messages.first()).toBeVisible()
  await expect(older).toBeVisible()
  await input.fill(draft)
  const baseline = await heap()
  const observations: number[] = []
  for (let cycle = 0; cycle < 5; cycle++) {
    await older.click()
    await expect(older).toBeEnabled()
    const count = await messages.count()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(90)
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    observations.push(await heap())
  }
  expect(Math.min(...observations.slice(-2))).toBeLessThan(baseline + 32 * 1024 * 1024)
  await writeFile(info.outputPath("browser-heap.json"), JSON.stringify({ baseline, observations }))

  const renamed = "Renamed Products history acceptance"
  await panel.getByRole("button", { name: "Rename", exact: true }).click()
  await panel.getByRole("textbox", { name: "Conversation title", exact: true }).fill(renamed)
  await panel.getByRole("button", { name: "Save", exact: true }).click()
  await expect(panel.getByText(renamed, { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Archive", exact: true }).click()
  await expect(panel.getByText("Restore this conversation to continue.", { exact: true })).toBeVisible()
  await expect(input).toHaveCount(0)
  await history.click()
  await panel.getByRole("button", { name: "Archived", exact: true }).click()
  await panel.getByRole("button", { name: renamed, exact: true }).click()
  await panel.getByRole("button", { name: "Restore", exact: true }).click()
  await expect(input).toHaveValue(draft)

  await history.click()
  await panel.getByRole("button", { name: "New chat", exact: true }).click()
  await expect(input).toHaveValue("")
  await history.click()
  await panel.getByRole("button", { name: "Recent", exact: true }).click()
  await panel.getByRole("button", { name: renamed, exact: true }).click()
  await expect(input).toHaveValue(draft)
  await expect(page).toHaveURL(new RegExp(`assistantThread=${thread}`))

  const query = new URLSearchParams({ assistantCompany: company!, assistantThread: thread!, assistantMessage: message! })
  await page.goto(`/overview?${query}`)
  await expect(panel).toBeVisible()
  const originalMessage = messages.filter({ hasText: "Confirm Products mapping SKU-ALPHA-2026 before resuming." })
  await expect(originalMessage).toBeVisible()
  await originalMessage.getByRole("button", { name: "Use in new chat", exact: true }).first().click()
  const attached = panel.getByRole("list", { name: "Attached chat references", exact: true })
  await expect(attached).toContainText("Earlier chat message")
  await input.fill("Which product fields did we confirm?")
  await attached.getByRole("button", { name: "Remove Earlier chat message", exact: true }).click()
  await expect(attached).toHaveCount(0)
  await expect(input).toHaveValue("Which product fields did we confirm?")
})
