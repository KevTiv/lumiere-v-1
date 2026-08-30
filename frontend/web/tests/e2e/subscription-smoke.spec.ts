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

test.describe("STDB subscription cache", { tag: "@phase-11" }, () => {
  test("creating a CRM contact updates the list without refetching contacts query", async ({
    page,
  }) => {
    const contactName = smokeName("sub-contact")
    let contactsQueryAfterCreate = 0

    page.on("request", (req) => {
      if (req.url().includes("/api/query/contacts") && req.method() === "GET") {
        contactsQueryAfterCreate += 1
      }
    })

    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-contacts").click()
    await waitForBffQueryMinRows(page, "/api/query/contacts")

    await page.getByTestId("module-create-crm-contacts").click()
    await expect(page.getByTestId("form-modal-new-contact")).toBeVisible()
    await fillField(page, "name", contactName)
    await fillField(page, "email", `${contactName}@example.test`)

    const mutationRes = await Promise.all([
      page.waitForResponse(
        (res) => matchesTypedOperationResponse(res, "create_contact") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-contact"),
    ]).then(([res]) => res)

    expect(mutationRes.ok()).toBe(true)
    await expect(page.getByText(contactName).first()).toBeVisible({ timeout: 30_000 })
    expect(contactsQueryAfterCreate).toBe(0)
    await expectNoAppError(page)
  })
})
