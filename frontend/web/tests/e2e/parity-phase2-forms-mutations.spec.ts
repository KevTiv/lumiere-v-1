import { matchesOperationResponse } from "./operation-response"
import { expect, test, type Request } from "@playwright/test"

import {
  addCustomFormFieldViaSettings,
  deleteCustomFormFieldViaSettings,
  expectNoAppError,
  expectRecordAbsentFromQuery,
  fillField,
  openEntityCreate,
  smokeName,
} from "./helpers"

function customFieldFixture(smokePrefix: string) {
  const fieldSlug = smokeName(smokePrefix)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
  return {
    fieldSlug,
    fieldLabel: `${fieldSlug} label`,
    fieldId: `custom:${fieldSlug}`,
  }
}

test.describe("Parity phase 2 — form config mutations", { tag: ["@p0", "@parity-phase-2"] }, () => {
  test("adds a custom field on the CRM new-lead form configuration", async ({ page }) => {
    test.setTimeout(180_000)

    const { fieldSlug, fieldLabel, fieldId } = customFieldFixture("e2e_notes")

    await addCustomFormFieldViaSettings(page, { fieldKey: fieldSlug, fieldLabel })
    await expect(page.getByTestId(`form-config-field-row-${fieldId}`)).toBeVisible({
      timeout: 30_000,
    })

    await deleteCustomFormFieldViaSettings(page, fieldId)
    await expect(page.getByTestId(`form-config-field-row-${fieldId}`)).toHaveCount(0, {
      timeout: 15_000,
    })

    await expectNoAppError(page)
  })

  test("retains custom field entries and creates no lead when custom-field creation is unsupported", async ({ page }) => {
    test.setTimeout(180_000)

    const { fieldSlug, fieldLabel, fieldId } = customFieldFixture("e2e_eav")
    const leadName = smokeName("eav-lead")
    const customValue = `val-${fieldSlug}`

    await addCustomFormFieldViaSettings(page, { fieldKey: fieldSlug, fieldLabel })

    await openEntityCreate(page, "/crm", "crm", "leads", "new-lead")
    await fillField(page, "contactName", leadName)
    await fillField(page, "emailFrom", `${leadName}@example.test`)
    await fillField(page, "expectedRevenue", "250")
    // Custom fields use fieldId as the ModularForm name
    await fillField(page, fieldId, customValue)

    // Creation cannot yet atomically persist a custom-field value. Verify the
    // admission contract instead of certifying a base record with dropped data.
    const createRequests: Request[] = []
    const onRequest = (request: Request) => {
      if (matchesOperationResponse(request, "create_lead")) createRequests.push(request)
    }
    page.on("request", onRequest)
    const modal = page.getByTestId("form-modal-new-lead")
    await modal.getByTestId("form-submit-new-lead").click()
    await expect(modal.getByRole("alert")).toContainText("Saving custom fields during creation is not available yet")
    await expect(modal.getByTestId("form-field-contactName")).toHaveValue(leadName)
    await expect(modal.getByTestId(`form-field-${fieldId}`)).toHaveValue(customValue)
    expect(createRequests).toHaveLength(0)
    page.off("request", onRequest)
    await expectRecordAbsentFromQuery(page, "/api/query/leads", (row) => row.name === leadName)
    await modal.getByRole("button", { name: "Cancel", exact: true }).click()
    const discard = page.getByTestId("discard-changes-dialog")
    if (await discard.isVisible()) await discard.getByTestId("discard-changes-confirm").click()

    await deleteCustomFormFieldViaSettings(page, fieldId)
    await expectNoAppError(page)
  })
})
