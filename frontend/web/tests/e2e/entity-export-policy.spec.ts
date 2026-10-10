import { expect, test } from "@playwright/test"

import { activeTabEntityTable, expectNoAppError, gotoModule } from "./helpers"

test.describe("entity export policy @p0", () => {
  test("ordinary entity lists do not expose export unless the list opts in", async ({ page }) => {
    await gotoModule(page, "/helpdesk", "helpdesk")
    await page.getByTestId("module-tab-helpdesk-tickets").click()

    await expect(activeTabEntityTable(page)).toBeVisible()
    await expect(page.getByTestId("entity-table-export")).toHaveCount(0)
    await expectNoAppError(page)
  })
})
