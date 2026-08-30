import { matchesTypedOperationResponse } from "./operation-response"
import { expect, test } from "@playwright/test"

import {
  canonicalContactPairIds,
  chooseSelectOptionByLabel,
  expectNoAppError,
  fetchContactIdByName,
  fetchContactIdsByEmail,
  fillField,
  gotoModule,
  openEntityCreate,
  smokeName,
  submitForm,
  waitForContactMergedInto,
} from "./helpers"

test.describe("CRM duplicate merge", { tag: ["@phase-4", "@crm"] }, () => {
  test("detects duplicate contacts by email and merges via merge_contacts reducer", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const email = `${smokeName("dup-email")}@example.test`
    const nameA = smokeName("dup-contact-a")
    const nameB = smokeName("dup-contact-b")

    await openEntityCreate(page, "/crm", "crm", "contacts", "new-contact")
    await fillField(page, "name", nameA)
    await fillField(page, "email", email)
    const [createARes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesTypedOperationResponse(res, "create_contact") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-contact"),
    ])
    expect(createARes.ok()).toBe(true)
    await expect(page.getByText(nameA).first()).toBeVisible({ timeout: 30_000 })

    await openEntityCreate(page, "/crm", "crm", "contacts", "new-contact")
    await fillField(page, "name", nameB)
    await fillField(page, "email", email)
    const [createBRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesTypedOperationResponse(res, "create_contact") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-contact"),
    ])
    expect(createBRes.ok()).toBe(true)
    await expect(page.getByText(nameB).first()).toBeVisible({ timeout: 30_000 })

    await fetchContactIdsByEmail(page, email, 2)

    const survivorId = await fetchContactIdByName(page, nameA)
    const sourceId = await fetchContactIdByName(page, nameB)
    const [pairIdA, pairIdB] = canonicalContactPairIds(survivorId, sourceId)

    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-duplicates").click()
    await expect(page.getByTestId("crm-duplicate-contacts")).toBeVisible()

    const pairTestId = `crm-duplicate-pair-${pairIdA}-${pairIdB}`
    await expect(page.getByTestId(pairTestId)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId(pairTestId)).toContainText(nameA)
    await expect(page.getByTestId(pairTestId)).toContainText(nameB)

    await page.getByTestId(`crm-duplicate-merge-${pairIdA}-${pairIdB}`).click()
    await expect(page.getByTestId("form-modal-merge-contacts")).toBeVisible()
    await chooseSelectOptionByLabel(page, "targetContactId", nameA)

    const [mergeRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesTypedOperationResponse(res, "merge_contacts") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "merge-contacts"),
    ])
    expect(mergeRes.ok()).toBe(true)

    await waitForContactMergedInto(page, sourceId, survivorId)

    await expect
      .poll(async () => {
        await page.getByTestId("module-tab-crm-contacts").click()
        await page.getByTestId("module-tab-crm-duplicates").click()
        return !(await page.getByTestId(pairTestId).isVisible().catch(() => false))
      }, { timeout: 30_000 })
      .toBe(true)

    await expect(page.getByTestId("crm-duplicates-empty")).toBeVisible()

    await page.getByTestId("module-tab-crm-contacts").click()
    await expect(page.getByText(nameA).first()).toBeVisible({ timeout: 30_000 })
    await expectNoAppError(page)
  })
})
