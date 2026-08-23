import { expect, test } from "@playwright/test"
import { parseQueryListResponse } from "@lumiere/api-client"

import {
  addCustomFormFieldViaSettings,
  deleteCustomFormFieldViaSettings,
  expectNoAppError,
  fetchLeadIdByName,
  fillField,
  openEntityCreate,
  smokeName,
  submitForm,
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

  test("persists custom field value to EAV on CRM lead create", async ({ page }) => {
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

    const [createRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_lead") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-lead"),
    ])
    expect(createRes.ok()).toBe(true)
    await expect(page.getByText(leadName).first()).toBeVisible({ timeout: 30_000 })

    const leadId = await fetchLeadIdByName(page, leadName)

    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/query/record-custom-field-values")
          if (!res.ok()) return false
          const rows = parseQueryListResponse(await res.json())
          return rows.some((row) => {
            const model = String(row.model ?? "")
            const recordId = String(row.recordId ?? row.record_id ?? "")
            const key = String(row.fieldKey ?? row.field_key ?? "")
            const valueJson = String(row.valueJson ?? row.value_json ?? "")
            return (
              model === "crm_lead" &&
              recordId === String(leadId) &&
              key === fieldId &&
              valueJson.includes(customValue)
            )
          })
        },
        { timeout: 45_000 },
      )
      .toBeTruthy()

    await deleteCustomFormFieldViaSettings(page, fieldId)
    await expectNoAppError(page)
  })
})
