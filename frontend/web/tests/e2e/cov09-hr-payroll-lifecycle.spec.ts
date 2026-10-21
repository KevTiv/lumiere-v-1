import { expect, test, type Page, type Request } from "@playwright/test"

import {
  selectModuleTab,
  chooseFirstOption,
  chooseSelectOptionByLabel,
  fetchAccountIdByCode,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  isoDate,
  openEntityCreate,
  scalarQueryId,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"
import { loseNextResponse } from "./pretenant-support"
import { canonicalOptionValue, canonicalRow, canonicalSumTag, sessionActor } from "./sod-evidence"

const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const PAYROLL_APPROVER = "fixture.hr-project@example.test"

type Row = Record<string, unknown>

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function exactId(
  page: Page,
  resource: string,
  predicate: (row: Row) => boolean,
  label: string,
): Promise<number> {
  let id: number | null = null
  await expect
    .poll(async () => {
      const matches = (await rows(page, resource)).filter(predicate)
      id = matches.length === 1 ? scalarQueryId(matches[0]?.id) : null
      return matches.length
    }, { timeout: 45_000, message: `${label} must resolve to one exact row` })
    .toBe(1)
  if (id == null) throw new Error(`${label} has no id`)
  return id
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function selectPayslipAction(page: Page, payslipId: number, actionId: string) {
  await gotoModule(page, "/hr", "hr")
  await selectModuleTab(page, "hr", "payslips")
  const row = page.getByTestId(`entity-row-${payslipId}`)
  await expect(row).toBeVisible({ timeout: 45_000 })
  await row.click()
  const action = page.getByTestId(`entity-action-${actionId}`)
  await expect(action).toBeEnabled()
  await action.click()
}

async function payrollEffect(page: Page, payslipId: number) {
  const payslip = await canonicalRow(page, "payslips", payslipId)
  const accountMoveId = scalarQueryId(
    canonicalOptionValue(payslip.accountMoveId ?? payslip.account_move_id),
  )
  const move = accountMoveId == null ? null : await canonicalRow(page, "account-moves", accountMoveId)
  return {
    payslipId,
    state: canonicalSumTag(payslip.state, ["Draft", "Verify", "Done", "Cancelled"]),
    organizationId: scalarQueryId(payslip.organizationId ?? payslip.organization_id),
    companyId: scalarQueryId(payslip.companyId ?? payslip.company_id),
    employeeId: scalarQueryId(payslip.employeeId ?? payslip.employee_id),
    contractId: scalarQueryId(
      canonicalOptionValue(payslip.contractId ?? payslip.contract_id),
    ),
    accountMoveId,
    moveOrganizationId: move == null ? null : scalarQueryId(move.organizationId ?? move.organization_id),
    moveCompanyId: move == null ? null : scalarQueryId(move.companyId ?? move.company_id),
  }
}

test.describe("COV-09 operator payroll lifecycle", { tag: ["@p0", "@cov09"] }, () => {
  test("operator creates employee and contract; a second persona approves and posts with exact recovery", async ({
    browser,
    page,
  }) => {
    test.setTimeout(360_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const creatorIdentity = await sessionActor(page)
    const employeeName = smokeName("cov09-payroll-employee")

    await openEntityCreate(page, "/hr", "hr", "employees", "new-employee")
    await fillField(page, "name", employeeName)
    await chooseFirstOption(page, "employmentType")
    await fillField(page, "workEmail", `${employeeName.toLowerCase()}@example.test`)
    await submitForm(page, "new-employee")
    const employeeId = await exactId(page, "employees", (row) => row.name === employeeName, employeeName)

    const contractName = smokeName("cov09-payroll-contract")
    await openEntityCreate(page, "/hr", "hr", "contracts", "new-contract")
    await fillField(page, "name", contractName)
    await chooseSelectOptionByLabel(page, "employeeId", employeeName)
    await fillField(page, "wage", "5500")
    await chooseFirstOption(page, "pricelistId")
    await fillField(page, "dateStart", isoDate(-1))
    await submitForm(page, "new-contract")
    const contractId = await exactId(page, "contracts", (row) => row.name === contractName, contractName)

    const structures = await rows(page, "payroll-structures")
    const structure = structures.find((row) =>
      (row.isActive ?? row.is_active) !== false && (row.isActive ?? row.is_active) !== 0,
    )
    const structId = scalarQueryId(structure?.id)
    const structureName = String(structure?.name ?? "").trim()
    if (structId == null || structureName === "") throw new Error("no active payroll structure seeded")

    await openEntityCreate(page, "/hr", "hr", "payslips", "new-payslip")
    await chooseSelectOptionByLabel(page, "employeeId", employeeName)
    await chooseSelectOptionByLabel(page, "structId", structureName)
    await fillField(page, "dateFrom", isoDate(-1))
    await fillField(page, "dateTo", isoDate(28))
    await fillField(page, "basicWage", "5500")
    await chooseSelectOptionByLabel(page, "contractId", contractName)
    await submitForm(page, "new-payslip")
    const payslipId = await exactId(
      page,
      "payslips",
      (row) =>
        scalarQueryId(row.employeeId ?? row.employee_id) === employeeId &&
        scalarQueryId(row.contractId ?? row.contract_id) === contractId,
      "operator-created payslip",
    )
    expect(await payrollEffect(page, payslipId)).toMatchObject({
      state: "Draft",
      organizationId,
      companyId,
      employeeId,
      contractId,
      accountMoveId: null,
    })

    const approverContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const approverPage = await approverContext.newPage()
    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(approverPage, PAYROLL_APPROVER, PERSONA_PASSWORD)
      const approverIdentity = await sessionActor(approverPage)
      expect(approverIdentity).not.toBe(creatorIdentity)

      await selectPayslipAction(approverPage, payslipId, "approve-payslip")
      await fillField(approverPage, "grossWage", "5500")
      await fillField(approverPage, "netWage", "5500")
      const lost = await loseNextResponse(approverPage, "confirm_payslip")
      await submitForm(approverPage, "approve-payslip")
      expect(lost.lost()).toBe(true)
      await expect.poll(() => payrollEffect(page, payslipId)).toMatchObject({
        state: "Verify",
        accountMoveId: null,
      })

      let stpDispatches = 0
      approverPage.on("request", (request) => {
        if (request.url().includes("create_hr_integration_intent")) stpDispatches += 1
      })
      await selectPayslipAction(approverPage, payslipId, "create-stp-intent")
      const stpUnavailable = "STP submission is unavailable because no provider adapter is configured"
      await expect(
        approverPage.getByRole("alert").filter({ hasText: stpUnavailable }),
      ).toContainText(stpUnavailable)
      expect(stpDispatches).toBe(0)

      const journal = (await rows(page, "account-journals")).find(
        (row) => String(row.code ?? "").toUpperCase() === "INV",
      ) ?? (await rows(page, "account-journals"))[0]
      const journalId = scalarQueryId(journal?.id)
      if (journalId == null) throw new Error("no accounting journal seeded")
      const expenseAccountId = await fetchAccountIdByCode(page, "5000")
      const payableAccountId = await fetchAccountIdByCode(page, "2000")

      await page.reload({ waitUntil: "domcontentloaded" })
      await selectPayslipAction(page, payslipId, "post-payslip")
      await fillField(page, "journalId", String(journalId))
      await fillField(page, "accountingDate", isoDate())
      await fillField(page, "expenseAccountId", String(expenseAccountId))
      await fillField(page, "payableAccountId", String(payableAccountId))
      const [posted] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "post_payslip"),
          { timeout: 45_000 },
        ),
        submitForm(page, "post-payslip"),
      ])
      expect(posted.ok()).toBe(true)
      await expect
        .poll(() => payrollEffect(page, payslipId), { timeout: 45_000 })
        .toMatchObject({
          state: "Done",
          organizationId,
          companyId,
          employeeId,
          contractId,
          moveOrganizationId: organizationId,
          moveCompanyId: companyId,
        })
      const exactEffect = await payrollEffect(page, payslipId)
      expect(exactEffect.accountMoveId).toBeGreaterThan(0)

      // Reducer-level duplicate replay is idempotent and must retain one exact
      // account-move relation rather than creating another payroll journal entry.
      const duplicatePost = await replay(page, posted.request())
      expect(duplicatePost.ok()).toBe(true)
      expect(await payrollEffect(page, payslipId)).toEqual(exactEffect)

      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const sensitiveRead = await readerPage.request.get("/api/query/payslips")
      if (sensitiveRead.status() === 200) {
        const readerRows = ((await sensitiveRead.json()) as { data?: Row[] }).data ?? []
        for (const row of readerRows) {
          expect(row).not.toHaveProperty("basicWage")
          expect(row).not.toHaveProperty("basic_wage")
          expect(row).not.toHaveProperty("grossWage")
          expect(row).not.toHaveProperty("gross_wage")
          expect(row).not.toHaveProperty("netWage")
          expect(row).not.toHaveProperty("net_wage")
        }
      } else {
        expect(sensitiveRead.status()).toBe(403)
      }
      const deniedPost = await replay(readerPage, posted.request())
      expect(deniedPost.status()).toBe(403)
      expect(await payrollEffect(page, payslipId)).toEqual(exactEffect)
    } finally {
      await readerContext.close()
      await approverContext.close()
    }
  })
})
