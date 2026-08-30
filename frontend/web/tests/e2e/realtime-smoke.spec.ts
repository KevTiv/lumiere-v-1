import { matchesTypedOperationResponse } from "./operation-response"
import { expect, test } from "@playwright/test"

import {
  expectNoAppError,
  fillField,
  gotoModule,
  smokeName,
  submitForm,
  waitForBffQueryMinRows,
} from "./helpers"

test.describe("Realtime query invalidation", { tag: "@phase-11" }, () => {
  test("creating a CRM contact triggers a follow-up contacts query", async ({ page }) => {
    const contactName = smokeName("rt-contact")

    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-contacts").click()
    await waitForBffQueryMinRows(page, "/api/query/contacts")

    await page.getByTestId("module-create-crm-contacts").click()
    await expect(page.getByTestId("form-modal-new-contact")).toBeVisible()
    await fillField(page, "name", contactName)
    await fillField(page, "email", `${contactName}@example.test`)

    const [mutationRes, refetchRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesTypedOperationResponse(res, "create_contact") && res.ok(),
        { timeout: 30_000 },
      ),
      page.waitForResponse(
        (res) => res.url().includes("/api/query/contacts") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-contact"),
    ])

    expect(mutationRes.ok()).toBe(true)
    expect(refetchRes.ok()).toBe(true)
    await expect(page.getByText(contactName).first()).toBeVisible({ timeout: 30_000 })
    await expectNoAppError(page)
  })
})
