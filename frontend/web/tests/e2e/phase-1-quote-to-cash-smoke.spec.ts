import { expect, test } from "@playwright/test"

import {
  expectNoAppError,
  fillField,
  gotoModule,
  openEntityCreate,
  smokeName,
  submitForm,
} from "./helpers"

test.describe("ERP phase-1 quote-to-cash gaps smoke @phase-1", () => {
  test("CRM contact-tags tab renders", async ({ page }) => {
    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-contact-tags").click()
    await expect(page.getByTestId("module-create-crm-contact-tags")).toBeVisible()
    await expect(page.getByTestId("entity-table")).toBeVisible()
    await expectNoAppError(page)
  })

  test("CRM contact-segments tab renders", async ({ page }) => {
    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-contact-segments").click()
    await expect(page.getByTestId("module-create-crm-contact-segments")).toBeVisible()
    await expect(page.getByTestId("entity-table")).toBeVisible()
    await expectNoAppError(page)
  })

  test("creates a contact tag from the Contact Tags tab", async ({ page }) => {
    const tagName = smokeName("contact-tag")

    await openEntityCreate(page, "/crm", "crm", "contact-tags", "new-contact-tag")
    await fillField(page, "name", tagName)
    await submitForm(page, "new-contact-tag")

    await expect(page.getByText(tagName)).toBeVisible()
  })

  test("creates a contact segment from the Contact Segments tab", async ({ page }) => {
    const segmentName = smokeName("contact-segment")

    await openEntityCreate(page, "/crm", "crm", "contact-segments", "new-contact-segment")
    await fillField(page, "name", segmentName)
    await submitForm(page, "new-contact-segment")

    await expect(page.getByText(segmentName)).toBeVisible()
  })
})
