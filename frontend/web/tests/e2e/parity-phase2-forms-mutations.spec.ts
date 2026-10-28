import { matchesOperationResponse } from "./operation-response"
import { expect, test } from "@playwright/test"
import { parseQueryListResponse } from "@lumiere/api-client"

import {
  addCustomFormFieldViaSettings,
  deleteCustomFormFieldViaSettings,
  expectNoAppError,
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

  test("retains unsupported custom values without partially creating a CRM lead", async ({ page }) => {
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

    const creates: string[] = []
    page.on("request", (request) => {
      if (matchesOperationResponse(request, "create_lead")) creates.push(request.url())
    })
    await page.getByTestId("form-submit-new-lead").click()
    const form = page.getByTestId("form-modal-new-lead")
    await expect(form).toContainText("Saving custom fields during creation is not available yet.")
    await expect(page.getByTestId("form-field-contactName")).toHaveValue(leadName)
    await expect(page.getByTestId(`form-field-${fieldId}`)).toHaveValue(customValue)
    expect(creates, "unsupported custom values must be rejected before create dispatch").toEqual([])

    const leads = await page.request.get("/api/query/leads")
    expect(leads.ok()).toBe(true)
    expect(parseQueryListResponse(await leads.json()).filter((row) => row.name === leadName || row.contactName === leadName || row.contact_name === leadName)).toHaveLength(0)
    const values = await page.request.get("/api/query/record-custom-field-values")
    expect(values.ok()).toBe(true)
    expect(parseQueryListResponse(await values.json()).filter((row) => String(row.fieldKey ?? row.field_key) === fieldId)).toHaveLength(0)

    await form.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Discard", exact: true }).click()
    await expect(form).toBeHidden()

    await deleteCustomFormFieldViaSettings(page, fieldId)
    await expectNoAppError(page)
  })
})
