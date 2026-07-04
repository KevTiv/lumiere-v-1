import { expect, test } from "@playwright/test"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  expectNoAppError,
  fillField,
  openEntityCreate,
  selectEntityRowByText,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
} from "./helpers"

test.describe("Helpdesk update mutations", { tag: "@phase-6" }, () => {
  test("updates a ticket via edit-ticket and update_ticket reducer", async ({ page }) => {
    test.setTimeout(120_000)

    const ticketName = smokeName("mut-ticket")
    const updatedName = `${ticketName}-updated`

    await openEntityCreate(page, "/helpdesk", "helpdesk", "tickets", "new-helpdesk-ticket")
    await fillField(page, "name", ticketName)
    await chooseFirstEnabledOption(page, "teamId")
    await chooseFirstEnabledOption(page, "stageId")
    const [createTicketRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_ticket") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-helpdesk-ticket"),
    ])
    expect(createTicketRes.ok()).toBe(true)
    await expect(page.getByText(ticketName).first()).toBeVisible({ timeout: 30_000 })

    await selectEntityRowByText(page, ticketName)
    await waitForEntityActionEnabled(page, "entity-action-edit-ticket")
    await page.getByTestId("entity-action-edit-ticket").click()
    await expect(page.getByTestId("form-field-name")).toBeVisible({ timeout: 15_000 })
    await fillField(page, "name", updatedName)
    await chooseSelectOptionByLabel(page, "priority", /high/i)

    const [updateTicketRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/update_ticket") && res.ok(),
        { timeout: 30_000 },
      ),
      page.locator('[data-testid^="form-submit-helpdesk-ticket-detail-"]').click(),
    ])
    expect(updateTicketRes.ok()).toBe(true)
    await expect(page.getByText(updatedName).first()).toBeVisible({ timeout: 30_000 })
    await expectNoAppError(page)
  })
})
