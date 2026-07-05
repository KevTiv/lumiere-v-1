import { expect, test } from "@playwright/test"

import { expectNoAppError, isAiGatewayAvailable, openErpAiChat } from "./helpers"

/**
 * MVP step 14: AI business insight via ERP Assistant RAG (skipped when gateway is down).
 */
test.describe("MVP AI RAG insight", { tag: "@p0" }, () => {
  test("assistant responds to a business question", async ({ page }) => {
    test.setTimeout(90_000)

    if (!(await isAiGatewayAvailable(page))) {
      if (process.env.E2E_REQUIRE_AI === "1") {
        throw new Error("E2E_REQUIRE_AI=1 but ai-gateway health check failed")
      }
      test.skip(true, "ai-gateway health check unavailable in this environment")
    }

    await page.goto("/overview")
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)

    await openErpAiChat(page)
    await page.getByTestId("erp-ai-chat-input").fill("Summarize our open sales pipeline in one sentence.")
    await page.getByTestId("erp-ai-chat-send").click()

    const assistantMessage = page.getByTestId("erp-ai-chat-message-assistant").last()
    await expect(assistantMessage).toBeVisible({ timeout: 60_000 })
    await expect(assistantMessage).not.toHaveText(/^(|thinking…|thinking\.\.\.)$/i)
    await expectNoAppError(page)
  })
})
