import { expect, test } from "@playwright/test"

import {
  expectNoAppError,
  fillField,
  openEntityCreate,
  smokeName,
  submitForm,
} from "./helpers"

test.describe("CRM phone identities and roles", { tag: ["@p1", "@contacts", "@ui"] }, () => {
  test("manages a phone identity and contact role from the CRM record", async ({ page }) => {
    test.setTimeout(90_000)

    const contactName = smokeName("phone-role-ui")

    await openEntityCreate(page, "/crm", "crm", "contacts", "new-contact")
    await fillField(page, "name", contactName)
    await fillField(page, "email", `${contactName}@example.test`)
    await submitForm(page, "new-contact")

    const contactRow = page.locator('[data-testid^="entity-row-"]', { hasText: contactName }).first()
    await expect(contactRow).toBeVisible({ timeout: 30_000 })
    await contactRow.click()

    const recordSheet = page.getByRole("dialog").filter({ hasText: contactName })
    await expect(recordSheet).toBeVisible()
    await recordSheet.getByRole("tab", { name: "Phones & roles" }).click()

    await recordSheet.getByRole("button", { name: "Add phone" }).click()
    const identityDialog = page.getByTestId("form-modal-create-contact-identity")
    await expect(identityDialog).toBeVisible()
    await identityDialog.getByTestId("form-field-rawValue").fill("+1 202 555 0101")

    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes("/api/call/create_contact_identity") && response.ok(),
        { timeout: 30_000 },
      ),
      identityDialog.getByRole("button", { name: "Add phone", exact: true }).click(),
    ])

    await expect(recordSheet.getByText(/\+120\*+101/)).toBeVisible({ timeout: 30_000 })

    await recordSheet.getByRole("button", { name: "Assign role" }).click()
    const roleDialog = page.getByTestId("form-modal-assign-contact-role")
    await roleDialog.getByTestId("form-field-role").fill("customer")
    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes("/api/call/assign_contact_role") && response.ok(),
        { timeout: 30_000 },
      ),
      roleDialog.getByRole("button", { name: "Assign role", exact: true }).click(),
    ])
    await expect(recordSheet.getByText("customer", { exact: true })).toBeVisible({ timeout: 30_000 })

    await expect(recordSheet.getByRole("button", { name: "Verify" })).toHaveCount(0)
    await expect(recordSheet.getByText("Unverified", { exact: true })).toBeVisible()
    await expect(recordSheet.getByText(/trusted OTP\/provider proof/i)).toBeVisible()

    await recordSheet.getByRole("button", { name: "End role" }).click()
    const endRoleDialog = page.getByTestId("form-modal-end-contact-role")
    await endRoleDialog.getByTestId("form-field-reason").fill("test correction")
    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes("/api/call/end_contact_role") && response.ok(),
        { timeout: 30_000 },
      ),
      endRoleDialog.getByRole("button", { name: "End role", exact: true }).click(),
    ])
    await expect(recordSheet.getByText("Ended", { exact: true })).toBeVisible({ timeout: 30_000 })
    await expectNoAppError(page)
  })
})
