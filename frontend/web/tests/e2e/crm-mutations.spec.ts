import { matchesOperationResponse } from "./operation-response"
import { expect, test } from "@playwright/test"

import {
  expectNoAppError,
  expectRecordAbsentFromQuery,
  fetchLeadIdByName,
  fillField,
  openEntityCreate,
  scalarQueryId,
  selectEntityRowById,
  selectEntityRowByText,
  smokeName,
  submitForm,
  waitForEntityActionEnabled,
  acceptEntityActionConfirm,
  chooseFirstEnabledOption,
  gotoModule,
  selectModuleTab,
} from "./helpers"

test.describe("CRM update/delete mutations", { tag: ["@p0", "@phase-1"] }, () => {
  test("creates a new enquiry, qualifies it on the record, converts it, and schedules a follow-up", async ({ page }) => {
    test.setTimeout(180_000)
    const leadName = smokeName("guided-lead")
    const followUp = `${leadName} follow-up`
    await gotoModule(page, "/crm", "crm")
    await expect(page.getByTestId("crm-my-work")).toBeVisible()
    await page.getByTestId("crm-my-work").getByRole("button", { name: "New lead", exact: true }).click()
    await fillField(page, "contactName", leadName)
    await fillField(page, "emailFrom", `${leadName}@example.test`)
    await submitForm(page, "new-lead")

    await selectModuleTab(page, "crm", "leads")
    await page.getByText(leadName, { exact: true }).first().click()
    const leadSheet = page.getByRole("dialog", { name: leadName, exact: true })
    await expect(leadSheet.getByRole("button", { name: "Qualify lead", exact: true })).toBeEnabled()
    await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "update_lead") && res.ok()),
      leadSheet.getByRole("button", { name: "Qualify lead", exact: true }).click(),
    ])
    await leadSheet.getByRole("button", { name: "Convert lead", exact: true }).click()
    await expect(page.getByTestId("form-modal-convert-lead")).toBeVisible()
    await chooseFirstEnabledOption(page, "opportunityStageId")
    await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "convert_lead_to_customer") && res.ok()),
      submitForm(page, "convert-lead"),
    ])
    await page.keyboard.press("Escape")
    await selectModuleTab(page, "crm", "opportunities")
    const opportunityName = `${leadName} - Opportunity`
    await page.getByText(opportunityName, { exact: true }).first().click()
    const opportunitySheet = page.getByRole("dialog", { name: opportunityName, exact: true })
    await opportunitySheet.getByRole("button", { name: "Schedule follow-up", exact: true }).click()
    await fillField(page, "summary", followUp)
    await chooseFirstEnabledOption(page, "activityTypeId")
    await fillField(page, "dateDeadline", new Date(Date.now() + 86_400_000).toISOString().slice(0, 10))
    await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "create_activity") && res.ok()),
      submitForm(page, "new-activity"),
    ])
    await page.keyboard.press("Escape")
    await gotoModule(page, "/crm", "crm")
    await expect(page.getByTestId("crm-my-work").getByText(followUp, { exact: true })).toBeVisible()
    await expectNoAppError(page)
  })

  test("updates a contact via edit-contact and update_contact reducer", async ({ page }) => {
    test.setTimeout(120_000)

    const contactName = smokeName("mut-contact")
    const updatedName = `${contactName}-updated`

    await openEntityCreate(page, "/crm", "crm", "contacts", "new-contact")
    await fillField(page, "name", contactName)
    await fillField(page, "email", `${contactName}@example.test`)
    await submitForm(page, "new-contact")
    await expect(page.getByText(contactName).first()).toBeVisible({ timeout: 30_000 })

    await selectEntityRowByText(page, contactName)
    await waitForEntityActionEnabled(page, "entity-action-edit-contact")
    await page.getByTestId("entity-action-edit-contact").click()
    await expect(page.getByTestId("form-modal-edit-contact")).toBeVisible()
    await fillField(page, "name", updatedName)

    const [updateContactRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "update_contact") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "edit-contact"),
    ])
    expect(updateContactRes.ok()).toBe(true)
    await expect(page.getByText(updatedName).first()).toBeVisible({ timeout: 30_000 })
    await expectNoAppError(page)
  })

  test("deletes a lead via delete-lead and delete_lead reducer", async ({ page }) => {
    test.setTimeout(120_000)

    const leadName = smokeName("mut-lead")

    await openEntityCreate(page, "/crm", "crm", "leads", "new-lead")
    await fillField(page, "contactName", leadName)
    await fillField(page, "emailFrom", `${leadName}@example.test`)
    await fillField(page, "expectedRevenue", "500")
    await submitForm(page, "new-lead")
    await expect(page.getByText(leadName).first()).toBeVisible({ timeout: 30_000 })

    const leadId = await fetchLeadIdByName(page, leadName)
    await selectEntityRowById(page, leadId)
    await waitForEntityActionEnabled(page, "entity-action-delete-lead")

    const deleteLeadResponse = page.waitForResponse(
      (res) => matchesOperationResponse(res, "delete_lead") && res.ok(),
      { timeout: 30_000 },
    )
    await page.getByTestId("entity-action-delete-lead").click()
    await acceptEntityActionConfirm(page)
    const deleteLeadRes = await deleteLeadResponse
    expect(deleteLeadRes.ok()).toBe(true)

    await expectRecordAbsentFromQuery(page, "/api/query/leads", (row) => scalarQueryId(row.id) === leadId)
    await expectNoAppError(page)
  })
})
