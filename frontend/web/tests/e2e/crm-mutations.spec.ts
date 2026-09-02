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
} from "./helpers"

test.describe("CRM update/delete mutations", { tag: ["@p0", "@phase-1"] }, () => {
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

    page.once("dialog", (dialog) => {
      expect(dialog.type()).toBe("confirm")
      void dialog.accept()
    })

    const [deleteLeadRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "delete_lead") && res.ok(),
        { timeout: 30_000 },
      ),
      page.getByTestId("entity-action-delete-lead").click(),
    ])
    expect(deleteLeadRes.ok()).toBe(true)

    await expectRecordAbsentFromQuery(page, "/api/query/leads", (row) => scalarQueryId(row.id) === leadId)
    await expectNoAppError(page)
  })
})
