import { expect, test } from "@playwright/test"

import { expectNoAppError, gotoModule, openEntityCreate, smokeName, submitForm, fillField } from "./helpers"

test.describe("Realtime query invalidation", { tag: "@phase-11" }, () => {
  test("creating a CRM contact triggers a follow-up contacts query", async ({ page }) => {
    const contactName = smokeName("rt-contact")

    await gotoModule(page, "/crm", "crm")
    const initialContactsQuery = page.waitForResponse(
      (res) => res.url().includes("/api/query/contacts") && res.ok(),
      { timeout: 30_000 },
    )

    await page.getByTestId("module-tab-crm-contacts").click()
    await initialContactsQuery

    await openEntityCreate(page, "/crm", "crm", "contacts", "new-contact")
    await fillField(page, "name", contactName)
    await fillField(page, "email", `${contactName}@example.test`)

    const [mutationRes, refetchRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_contact") && res.ok(),
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
