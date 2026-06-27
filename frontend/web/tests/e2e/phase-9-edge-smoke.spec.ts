import { expect, test } from "@playwright/test"

import { expectNoAppError, gotoModule, signIn } from "./helpers"

const PROPOSAL_ROW_ACTION_IDS = [
  "submit-proposal",
  "award-proposal",
  "archive-proposal",
] as const

test.describe("Phase 9 edge modules smoke", { tag: "@phase-9" }, () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("proposals list row actions are visible without selection", async ({ page }) => {
    await gotoModule(page, "/proposals", "proposals")
    await page.getByTestId("module-tab-proposals-proposals").click()
    await expect(page.getByTestId("entity-table")).toBeVisible()

    for (const actionId of PROPOSAL_ROW_ACTION_IDS) {
      const action = page.getByTestId(`entity-action-${actionId}`)
      await expect(action).toBeVisible()
      await expect(action).toBeDisabled()
    }

    await expectNoAppError(page)
  })

  test("pos register and admin tabs render admin tables", async ({ page }) => {
    await page.goto("/pos")
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
    await expectNoAppError(page)

    await expect(page.getByTestId("pos-tab-register")).toBeVisible()
    await page.getByTestId("pos-tab-admin").click()

    const tables = page.getByTestId("entity-table")
    await expect(tables.first()).toBeVisible()
    expect(await tables.count()).toBeGreaterThanOrEqual(3)
    await expectNoAppError(page)
  })

  test("pos admin action opens FormModal and cancels", async ({ page }) => {
    await page.goto("/pos")
    await page.getByTestId("pos-tab-admin").click()
    await expectNoAppError(page)

    await page.getByRole("button", { name: /create pos terminal/i }).click()
    await expect(page.getByTestId("form-modal-pos-create-terminal")).toBeVisible()
    await page.getByTestId("form-modal-pos-create-terminal").getByRole("button", { name: /^cancel$/i }).click()
    await expect(page.getByTestId("form-modal-pos-create-terminal")).toBeHidden()
    await expectNoAppError(page)
  })

  test("map loads, map view appears, and layer legend is visible", async ({ page }) => {
    await page.goto("/map")
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)

    await expect(page.getByText(/loading map/i)).toBeHidden({ timeout: 30_000 })
    await expect(page.getByTestId("map-view")).toBeVisible()

    await expect(page.getByTestId("map-layer-warehouse")).toBeVisible()
    await expect(page.getByText(/summary|warehouse|vehicle|pos/i).first()).toBeVisible()
    await expectNoAppError(page)
  })
})
