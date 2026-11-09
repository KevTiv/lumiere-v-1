import { expect, test } from "@playwright/test"

import { selectModuleTab, activeTabEntityTable, expectNoAppError, gotoModule } from "./helpers"

const PROPOSAL_ROW_ACTION_IDS = [
  "submit-proposal",
  "award-proposal",
  "archive-proposal",
] as const

test.describe("Phase 9 edge modules smoke", { tag: "@phase-9" }, () => {
  test("proposals list row actions are offered only once a row is selected", async ({ page }) => {
    await gotoModule(page, "/proposals", "proposals")
    await selectModuleTab(page, "proposals", "proposals")
    await expect(activeTabEntityTable(page)).toBeVisible()

    for (const actionId of PROPOSAL_ROW_ACTION_IDS) {
      await expect(page.getByTestId(`entity-action-${actionId}`)).toHaveCount(0)
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

  test("map loads and keeps fleet controls reachable in a narrow workspace", { tag: "@aside-fit" }, async ({ page }) => {
    await page.goto("/map")
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)

    await expect(page.getByText(/loading map/i)).toBeHidden({ timeout: 30_000 })
    const map = page.getByTestId("map-view")
    await expect(map).toBeVisible()
    const mapNode = await map.elementHandle()

    await expect(page.getByTestId("map-layer-warehouse")).toBeVisible()
    await page.setViewportSize({ width: 390, height: 720 })
    const trigger = page.getByRole("button", { name: "Map controls" })
    await trigger.press("Enter")
    const panel = page.getByRole("complementary", { name: "Summary", exact: true })
    await expect(panel.getByRole("heading", { name: "Summary", exact: true })).toBeFocused()
    await expect(panel.getByRole("button", { name: "Add vehicle" })).toBeVisible()
    await expect(map).toBeHidden()
    await page.keyboard.press("Escape")
    await expect(trigger).toBeFocused()
    await expect(map).toBeVisible()
    expect(await mapNode?.evaluate((element) => element.isConnected)).toBe(true)
    await expectNoAppError(page)
  })
})
