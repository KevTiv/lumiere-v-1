import { expect, test } from "@playwright/test"

import {
  assertModuleTabs,
  expectNoAppError,
  gotoModule,
  openTabAndCancelCreate,
} from "./helpers"

test.describe("Phase 11 missing modules smoke", { tag: "@phase-11" }, () => {
  test("tasks board renders stats and create task modal", async ({ page }) => {
    await gotoModule(page, "/tasks")
    await expect(page.getByRole("button", { name: /create task/i })).toBeVisible()
    await page.getByRole("button", { name: /create task/i }).click()
    await expect(page.getByTestId("form-modal-new-task")).toBeVisible()
    await page.getByTestId("form-modal-new-task").getByRole("button", { name: /^cancel$/i }).click()
    await expectNoAppError(page)
  })

  test("forensics view loads reports tab", async ({ page }) => {
    await gotoModule(page, "/forensics")
    await expect(page.getByRole("tab", { name: /reports/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /new report/i })).toBeVisible()
    await expectNoAppError(page)
  })

  test("trackers dashboard renders configured widgets", async ({ page }) => {
    await gotoModule(page, "/trackers")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    await expectNoAppError(page)
  })

  test("iot module tabs render and device create modal opens", async ({ page }) => {
    await gotoModule(page, "/iot", "iot")
    await assertModuleTabs(page, "iot", [
      "dashboard",
      "iot-pairing-tokens",
      "iot-hubs",
      "iot-devices",
    ])
    await openTabAndCancelCreate(page, "iot", "iot-devices", "new-iot-device")
  })
})
