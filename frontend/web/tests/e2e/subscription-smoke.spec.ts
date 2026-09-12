import { matchesOperationResponse } from "./operation-response"
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
  test("creating a CRM contact invalidates exactly one authorized contacts query", async ({
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
    contactsQueryAfterCreate = 0

    const [mutationRes, refetchRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "create_contact") && res.ok(),
        { timeout: 30_000 },
      ),
      page.waitForResponse(
        (res) => res.url().includes("/api/query/contacts") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-contact"),
    ])

    expect(mutationRes.ok()).toBe(true)
    const refetched = (await refetchRes.json()) as { data?: Array<{ name?: unknown }> }
    expect(refetched.data?.some((row) => row.name === contactName)).toBe(true)
    expect(contactsQueryAfterCreate).toBe(1)
    await expectNoAppError(page)
  })
})
