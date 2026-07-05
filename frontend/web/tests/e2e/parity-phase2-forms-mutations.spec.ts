import { expect, test } from "@playwright/test"

import {
  addCustomFormFieldViaSettings,
  deleteCustomFormFieldViaSettings,
  expectNoAppError,
  smokeName,
} from "./helpers"

test.describe("Parity phase 2 — form config mutations", { tag: ["@p0", "@parity-phase-2"] }, () => {
  test("adds a custom field on the CRM new-lead form configuration", async ({ page }) => {
    test.setTimeout(180_000)

    const fieldKeyRaw = smokeName("e2e_notes")
    const fieldSlug = fieldKeyRaw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_")
    const fieldLabel = `${fieldSlug} label`
    const fieldId = `custom:${fieldSlug}`

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
})
