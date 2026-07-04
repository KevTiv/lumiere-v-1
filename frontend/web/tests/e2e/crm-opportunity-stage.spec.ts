import { expect, test } from "@playwright/test"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  expectNoAppError,
  fetchOpportunityIdByName,
  fillField,
  gotoModule,
  openEntityCreate,
  selectEntityRowByText,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
} from "./helpers"

test.describe("CRM opportunity stage workflow", { tag: "@phase-1" }, () => {
  test("changes opportunity stage before conversion", async ({ page }) => {
    test.setTimeout(120_000)

    const contactName = smokeName("stage-contact")
    const oppName = smokeName("stage-opp")

    await openEntityCreate(page, "/crm", "crm", "contacts", "new-contact")
    await fillField(page, "name", contactName)
    await fillField(page, "email", `${contactName}@example.test`)
    await submitForm(page, "new-contact")
    await expect(page.getByText(contactName).first()).toBeVisible({ timeout: 30_000 })

    await openEntityCreate(page, "/crm", "crm", "opportunities", "new-opportunity")
    await fillField(page, "name", oppName)
    await fillField(page, "expectedRevenue", "1500")
    await chooseFirstEnabledOption(page, "stageId")
    const [createOppRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_opportunity") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-opportunity"),
    ])
    expect(createOppRes.ok()).toBe(true)

    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-opportunities").click()
    await selectEntityRowByText(page, oppName)
    await waitForEntityActionEnabled(page, "entity-action-change-stage")
    await page.getByTestId("entity-action-change-stage").click()
    await expect(page.getByTestId("form-modal-change-opportunity-stage")).toBeVisible()
    await chooseSelectOptionByLabel(page, "stageId", /won|negotiation|proposal/i)
    const [stageRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/update_opportunity") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "change-opportunity-stage"),
    ])
    expect(stageRes.ok()).toBe(true)

    const opportunityId = await fetchOpportunityIdByName(page, oppName)
    expect(opportunityId).toBeTruthy()
    await expectNoAppError(page)
  })
})
