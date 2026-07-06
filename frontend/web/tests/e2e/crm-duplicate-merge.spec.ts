import { expect, test } from "@playwright/test"

/**
 * CRM duplicate merge — stub for Phase 4 track [crm-duplicate-merge].
 * Full flow (create dup pair → merge → verify survivor) deferred until stable test fixtures exist.
 */
test.describe("CRM duplicate merge", { tag: ["@phase-4", "@crm"] }, () => {
  test.skip("stub: duplicates tab lists pairs and merge_contacts reducer", async ({ page }) => {
    await page.goto("/crm")
    await page.getByTestId("module-tab-crm-duplicates").click()
    await expect(page.getByTestId("crm-duplicate-contacts")).toBeVisible()
  })
})
