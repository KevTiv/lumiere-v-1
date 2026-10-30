import { matchesOperationResponse } from "./operation-response"
import { expect, test } from "@playwright/test"
import { parseQueryListResponse } from "@lumiere/api-client"

import {
  addCustomFormFieldViaSettings,
  deleteCustomFormFieldViaSettings,
  dismissBlockingDialogs,
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

  test("explains unavailable custom-field creation before entry and retains values without creating a lead", async ({ page }) => {
    test.setTimeout(180_000)
    const { fieldSlug, fieldLabel, fieldId } = customFieldFixture("e2e_eav")
    const leadName = smokeName("eav-lead")
    const customValue = `val-${fieldSlug}`
    await addCustomFormFieldViaSettings(page, { fieldKey: fieldSlug, fieldLabel })
    const creates: string[] = []
    page.on("request", (request) => {
      if (request.method() === "POST" && matchesOperationResponse(request, "create_lead")) creates.push(request.url())
    })
    try {
      await openEntityCreate(page, "/crm", "crm", "leads", "new-lead")
      const modal = page.getByTestId("form-modal-new-lead")
      await expect(modal.getByText(/This form includes custom fields that cannot be saved during creation yet/)).toBeVisible()
      await expect(page.getByTestId("form-submit-new-lead")).toBeDisabled()
      await fillField(page, "contactName", leadName)
      await fillField(page, "emailFrom", `${leadName}@example.test`)
      await fillField(page, "expectedRevenue", "250")
      await fillField(page, fieldId, customValue)
      await expect(page.getByTestId("form-submit-new-lead")).toBeDisabled()
      await expect(modal.getByTestId("form-field-contactName")).toHaveValue(leadName)
      await expect(modal.getByTestId(`form-field-${fieldId}`)).toHaveValue(customValue)
      expect(creates).toEqual([])
      const response = await page.request.get("/api/query/leads")
      expect(response.ok()).toBe(true)
      expect(parseQueryListResponse(await response.json()).filter((row) => row.name === leadName || row.contactName === leadName || row.contact_name === leadName)).toEqual([])
      const customFields = await page.request.get("/api/query/record-custom-field-values")
      expect(customFields.ok()).toBe(true)
      expect(parseQueryListResponse(await customFields.json()).some((row) => String(row.fieldKey ?? row.field_key ?? "") === fieldId)).toBe(false)
      expect(creates).toEqual([])
      // Keep the safety block until the create command can atomically save the EAV values.
    } finally {
      await dismissBlockingDialogs(page)
      await deleteCustomFormFieldViaSettings(page, fieldId)
    }
    await expectNoAppError(page)
  })
})
