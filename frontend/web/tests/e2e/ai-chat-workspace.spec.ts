import { chooseSelectOptionByTriggerValue } from "./helpers-legacy"
import { expect, test } from "@playwright/test"
import { expectNoAppError, openErpAiChat } from "./helpers"

// Authenticated layout/keyboard coverage. This suite makes no provider request;
// real Mistral and durable spend acceptance belongs to GOV00 and the pilot smoke.
test.describe("AI chat workspace", { tag: ["@p0", "@ai-workspace"] }, () => {
  for (const width of [320, 390, 768, 1440]) {
    test(`keeps the composer and context usable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto("/overview")
      await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
      await openErpAiChat(page)
      const panel = page.getByTestId("erp-ai-chat-panel")
      const input = page.getByTestId("erp-ai-chat-input")
      await expect(panel).toHaveAttribute("data-mode", "full")
      await expect(input).toBeFocused()
      const question = "Preserve this question while changing context. " + "long-token-".repeat(100)
      await input.fill(question)
      await chooseSelectOptionByTriggerValue(
        page,
        panel.getByRole("combobox", { name: "Assistant context" }),
        "module:inventory",
      )
      await panel.getByRole("button", { name: "Dock beside ERP" }).click()
      await expect(panel).toHaveAttribute("data-mode", "side")
      await expect(input).toHaveValue(question)
      await expect(input).toBeFocused()
      await expect(panel.getByRole("combobox", { name: "Assistant context" })).toContainText("Inventory")
      const bounds = await panel.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1)
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await panel.getByRole("button", { name: "Open full workspace" }).click()
      await expect(input).toHaveValue(question)
      await panel.getByRole("button", { name: "Close", exact: true }).focus()
      await page.keyboard.press("Enter")
      await expect(panel).toHaveCount(0)
      await expectNoAppError(page)
    })
  }
})
