import { expect, test, type Page } from "@playwright/test"

import {
  callReducerOwner,
  chooseFirstEnabledOption,
  chooseSelectOptionByValue,
  fetchAccountIdByCode,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  scalarQueryId,
  smokeName,
  submitForm,
  waitForBffQueryMinRows,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

function timestamp(iso: string) {
  return { __timestamp_micros_since_unix_epoch__: new Date(iso).getTime() * 1000 }
}

async function rows(page: Page, resource: string): Promise<Array<Record<string, unknown>>> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Array<Record<string, unknown>> }).data ?? []
}

function tag(value: unknown): string {
  if (value && typeof value === "object" && "tag" in value) return String((value as { tag?: unknown }).tag ?? "")
  return String(value ?? "")
}

test.describe("COV-08 closed accounting period", { tag: ["@p0", "@cov08"] }, () => {
  test("a closed period refuses a post dated inside it and leaves the entry a draft", async ({ page }) => {
    test.setTimeout(240_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const suffix = Date.now() % 100000
    // Stay below 2255: later dates exceed JS safe-integer microseconds.
    const year = 2200 + (suffix % 55)

    // Fixtures: an open fiscal year and period far from the seeded window.
    const yearName = smokeName(`cov08cp-fy-${suffix}`)
    await callReducerOwner("create_fiscal_year", [organizationId, companyId, {
      name: yearName,
      date_from: timestamp(`${year}-01-01T00:00:00Z`),
      date_to: timestamp(`${year}-12-31T23:59:59Z`),
      type: "normal",
      is_adjustment: false,
      notes: { none: [] },
      metadata: { none: [] },
    }])
    const fiscalYearId = scalarQueryId((await rows(page, "fiscal-years")).find((row) => row.name === yearName)?.id)
    if (fiscalYearId == null) throw new Error("created fiscal year not found")
    await callReducerOwner("open_fiscal_year", [organizationId, companyId, fiscalYearId])
    const periodName = smokeName(`cov08cp-period-${suffix}`)
    await callReducerOwner("create_account_period", [organizationId, companyId, {
      name: periodName,
      code: `C08P${suffix}`,
      date_from: timestamp(`${year}-01-01T00:00:00Z`),
      date_to: timestamp(`${year}-01-31T23:59:59Z`),
      fiscal_year_id: fiscalYearId,
      is_adjustment: false,
      notes: { none: [] },
      metadata: { none: [] },
    }])
    const periodId = scalarQueryId((await rows(page, "account-periods")).find((row) => row.name === periodName)?.id)
    if (periodId == null) throw new Error("created period not found")
    await callReducerOwner("open_account_period", [organizationId, companyId, periodId])

    // Operator: draft a journal entry dated inside the open period.
    const ref = smokeName("cov08cp-entry")
    const knownMoveIds = new Set((await rows(page, "account-moves")).map((row) => scalarQueryId(row.id)))
    await gotoModule(page, "/accounting", "accounting")
    await waitForBffQueryMinRows(page, "/api/query/account-journals")
    await page.waitForTimeout(2_000)
    await page.getByTestId("quick-action-journal_entry").click()
    await expect(page.getByTestId("form-modal-new-journal-entry")).toBeVisible()
    await fillField(page, "date", `${year}-01-15`)
    await chooseFirstEnabledOption(page, "journalId")
    await fillField(page, "ref", ref)
    const [created] = await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "create_account_move"), { timeout: 30_000 }),
      submitForm(page, "new-journal-entry"),
    ])
    expect(created.ok(), await created.text()).toBe(true)
    // `ref` is not projected by the account-moves read model: the new entry is the
    // one move that did not exist before the create.
    await expect
      .poll(async () => (await rows(page, "account-moves")).filter((row) => !knownMoveIds.has(scalarQueryId(row.id))).length, { timeout: 30_000 })
      .toBe(1)
    const entryId = scalarQueryId(
      (await rows(page, "account-moves")).find((row) => !knownMoveIds.has(scalarQueryId(row.id)))?.id,
    )
    if (entryId == null) throw new Error("drafted entry not found")

    // Operator: balance the entry with two lines through the Move lines tab.
    const arAccountId = await fetchAccountIdByCode(page, "1100")
    const bankAccountId = await fetchAccountIdByCode(page, "1200")
    for (const [accountId, name, debit, credit] of [
      [bankAccountId, "Bank", "40", "0"],
      [arAccountId, "Receivable", "0", "40"],
    ] as const) {
      await page.getByTestId("module-tab-accounting-move-lines").click()
      await page.getByTestId("module-create-accounting-move-lines").click()
      await expect(page.getByTestId("form-modal-add-account-move-line")).toBeVisible()
      await chooseSelectOptionByValue(page, "moveId", entryId)
      await chooseSelectOptionByValue(page, "accountId", accountId)
      await fillField(page, "name", name)
      await fillField(page, "debit", debit)
      await fillField(page, "credit", credit)
      const [added] = await Promise.all([
        page.waitForResponse((res) => matchesOperationResponse(res, "add_account_move_line"), { timeout: 30_000 }),
        submitForm(page, "add-account-move-line"),
      ])
      expect(added.ok(), await added.text()).toBe(true)
    }

    // Operator: close the period.
    await page.getByTestId("module-tab-accounting-account-periods").click()
    const periodRow = page.getByTestId(`entity-row-${periodId}`)
    await expect(periodRow).toContainText(periodName)
    await periodRow.click()
    const editDialog = page.getByRole("dialog")
    await expect(editDialog).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(editDialog).toBeHidden()
    const [closed] = await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "close_account_period"), { timeout: 30_000 }),
      page.getByTestId("entity-action-ap-close").click(),
    ])
    expect(closed.ok(), await closed.text()).toBe(true)

    // Operator: try to post the entry. The closed period refuses it.
    await gotoModule(page, `/accounting?tab=journal-entries&filter=${encodeURIComponent(`id:${entryId}`)}`, "accounting")
    const entryRow = page.getByTestId(`entity-row-${entryId}`)
    await expect(entryRow).toBeVisible({ timeout: 30_000 })
    await entryRow.click()
    const postButton = page.getByRole("dialog").getByRole("button", { name: /post/i })
    await expect(postButton).toBeVisible({ timeout: 15_000 })
    const [refused] = await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "post_account_move"), { timeout: 30_000 }),
      postButton.click(),
    ])
    expect(refused.ok()).toBe(false)
    expect(await refused.text()).toMatch(/closed|period/i)
    const after = (await rows(page, "account-moves")).find((row) => scalarQueryId(row.id) === entryId)
    expect(tag(after?.state)).toBe("Draft")
  })
})
