import { expect, test, type Page, type Request } from "@playwright/test"

import {
  callReducerBff,
  chooseSelectOptionByLabel,
  fetchAccountIdByCode,
  fetchAccountSelectLabelByInternalType,
  fetchCurrencyIdByCode,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  isoDate,
  scalarQueryId,
  selectEntityRowById,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

const some = <T>(value: T) => ({ some: value })
const none = { none: [] as [] }
type Row = Record<string, unknown>

function stateTag(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value) return String((value as { tag?: unknown }).tag ?? "")
    const keys = Object.keys(value)
    if (keys.length === 1) {
      return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
    }
  }
  return ""
}

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) {
    throw new Error(`${resource} query failed: ${response.status()}`)
  }
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function sheetSnapshot(page: Page, sheetId: number) {
  const row = (await rows(page, "expense-sheets")).find(
    (candidate) => scalarQueryId(candidate.id) === sheetId,
  )
  if (!row) throw new Error(`expense sheet not found: ${sheetId}`)
  return {
    id: sheetId,
    organizationId: scalarQueryId(
      row.organizationId ?? row.organization_id,
    ),
    companyId: scalarQueryId(row.companyId ?? row.company_id),
    state: stateTag(row.state),
    accountMoveId:
      scalarQueryId(row.accountMoveId ?? row.account_move_id) ?? null,
    reimbursementMoveId:
      scalarQueryId(
        row.reimbursementMoveId ?? row.reimbursement_move_id,
      ) ?? null,
  }
}

async function moveSnapshot(page: Page, moveId: number) {
  const row = (await rows(page, "account-moves")).find(
    (candidate) => scalarQueryId(candidate.id) === moveId,
  )
  if (!row) throw new Error(`account move not found: ${moveId}`)
  return {
    id: moveId,
    organizationId: scalarQueryId(
      row.organizationId ?? row.organization_id,
    ),
    companyId: scalarQueryId(row.companyId ?? row.company_id),
    state: stateTag(row.state),
  }
}

async function openSheetAction(
  page: Page,
  sheetId: number,
  actionId: string,
) {
  await gotoModule(page, "/expenses", "expenses")
  await page.getByTestId("module-tab-expenses-expense-sheets").click()
  await selectEntityRowById(page, sheetId)
  const action = page.getByTestId(`entity-action-${actionId}`)
  await expect(action).toBeVisible()
  return action
}

test.describe(
  "COV-11 Expense sheet submit → approve → post → reimburse",
  { tag: ["@p0", "@cov11"] },
  () => {
    test("preserves exact sheet and accounting-move effects across SoD, retries and denial", async ({
      browser,
      page,
    }) => {
      test.setTimeout(300_000)
      await gotoModule(page, "/expenses", "expenses")
      const organizationId = await fetchSessionOrganizationId(page)
      const currencyId = await fetchCurrencyIdByCode(page, "USD")

      const employees = await page.request.get("/api/query/employees")
      const employeeId = Number(
        (
          (await employees.json()) as {
            data?: Array<{ id?: number }>
          }
        ).data?.[0]?.id,
      )
      expect(employeeId).toBeGreaterThan(0)

      const sheetName = smokeName("cov11-sheet")
      const expenseName = smokeName("cov11-line")
      const receiptKey = smokeName("cov11-receipt")

      await callReducerBff(page, "create_expense_receipt", [
        organizationId,
        {
          company_id: none,
          employee_id: employeeId,
          file_name: some("cov11.pdf"),
          mime_type: some("application/pdf"),
          storage_key: `e2e:${receiptKey}`,
          content_hash: none,
          client_request_id: some(receiptKey),
        },
      ])
      const receiptId = scalarQueryId(
        (await rows(page, "expense-receipts")).find(
          (row) =>
            String(row.clientRequestId ?? row.client_request_id ?? "") ===
            receiptKey,
        )?.id,
      )
      expect(receiptId).not.toBeNull()

      await callReducerBff(page, "create_expense_sheet", [
        organizationId,
        {
          company_id: none,
          employee_id: employeeId,
          name: sheetName,
          currency_id: currencyId,
          notes: none,
          accounting_date: none,
        },
      ])
      const sheetId = scalarQueryId(
        (await rows(page, "expense-sheets")).find(
          (row) => row.name === sheetName,
        )?.id,
      )
      if (sheetId == null) throw new Error("created expense sheet not found")

      await callReducerBff(page, "create_expense", [
        organizationId,
        {
          company_id: none,
          employee_id: employeeId,
          name: expenseName,
          date: {
            __timestamp_micros_since_unix_epoch__: Date.now() * 1000,
          },
          unit_amount: 73.17 + (Date.now() % 1000) / 1000,
          quantity: 1,
          currency_id: currencyId,
          product_id: none,
          description: none,
          tax_ids: [],
          account_id: none,
          analytic_account_id: none,
          project_id: none,
          line_kind: { standard: [] },
          mileage_distance: none,
          mileage_rate_id: none,
          per_diem_days: none,
          per_diem_rate_id: none,
          attachment_ids: [receiptId],
          client_request_id: some(smokeName("cov11-expense")),
          payment_mode: { outOfPocket: [] },
          merchant_key: some(smokeName("cov11-merchant")),
          policy_exception_reason: none,
        },
      ])
      const expenseId = scalarQueryId(
        (await rows(page, "expenses")).find(
          (row) => row.name === expenseName,
        )?.id,
      )
      if (expenseId == null) throw new Error("created expense line not found")
      await callReducerBff(page, "submit_expense", [
        organizationId,
        expenseId,
        sheetId,
      ])

      const submitAction = await openSheetAction(
        page,
        sheetId,
        "submit-sheets",
      )
      const [submitted] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(response, "submit_expense_sheet"),
          { timeout: 45_000 },
        ),
        submitAction.click(),
      ])
      expect(submitted.ok()).toBe(true)
      await expect
        .poll(() => sheetSnapshot(page, sheetId))
        .toMatchObject({ state: "Submitted" })
      const submittedEffect = await sheetSnapshot(page, sheetId)

      const staleSubmit = await replay(page, submitted.request())
      expect(staleSubmit.status()).toBe(422)
      expect(await sheetSnapshot(page, sheetId)).toEqual(submittedEffect)

      const financeContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const financePage = await financeContext.newPage()
      let approvedRequest: Request
      try {
        await signIn(
          financePage,
          "fixture.finance@example.test",
          PERSONA_PASSWORD,
        )
        const approveAction = await openSheetAction(
          financePage,
          sheetId,
          "approve-sheets",
        )
        const [approved] = await Promise.all([
          financePage.waitForResponse(
            (response) =>
              matchesOperationResponse(response, "approve_expense_sheet"),
            { timeout: 45_000 },
          ),
          approveAction.click(),
        ])
        expect(approved.ok()).toBe(true)
        approvedRequest = approved.request()

        await expect
          .poll(() => sheetSnapshot(page, sheetId))
          .toMatchObject({ state: "Approved" })
        const approvedEffect = await sheetSnapshot(page, sheetId)
        const staleApprove = await replay(financePage, approved.request())
        expect(staleApprove.status()).toBe(422)
        expect(await sheetSnapshot(page, sheetId)).toEqual(approvedEffect)
      } finally {
        await financeContext.close()
      }

      const journals = await rows(page, "account-journals")
      const journalRow =
        journals.find(
          (row) => String(row.code ?? "").toUpperCase() === "MISC",
        ) ?? journals[0]
      if (!journalRow) throw new Error("no accounting journal available")
      const journalLabel =
        journalRow.code && journalRow.name
          ? `${journalRow.code} — ${journalRow.name}`
          : String(journalRow.name ?? journalRow.code)

      const expenseLabel = await fetchAccountSelectLabelByInternalType(
        page,
        "expense",
      )
      const payableLabel = await fetchAccountSelectLabelByInternalType(
        page,
        "payable",
      )

      const postAction = await openSheetAction(page, sheetId, "post-sheets")
      await postAction.click()
      await expect(
        page.getByTestId("form-modal-post-expense-report"),
      ).toBeVisible({ timeout: 15_000 })
      await fillField(page, "accountingDate", isoDate(0))
      await chooseSelectOptionByLabel(page, "journalId", journalLabel)
      await chooseSelectOptionByLabel(
        page,
        "defaultExpenseAccountId",
        expenseLabel,
      )
      await chooseSelectOptionByLabel(
        page,
        "payableAccountId",
        payableLabel,
      )

      const [posted] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(response, "post_expense_sheet"),
          { timeout: 45_000 },
        ),
        submitForm(page, "post-expense-report"),
      ])
      expect(posted.ok()).toBe(true)
      await expect
        .poll(() => sheetSnapshot(page, sheetId))
        .toMatchObject({ state: "Posted" })
      const postedEffect = await sheetSnapshot(page, sheetId)
      expect(postedEffect.accountMoveId).not.toBeNull()
      const sourceMove = await moveSnapshot(
        page,
        postedEffect.accountMoveId!,
      )
      expect(sourceMove).toMatchObject({
        organizationId,
        companyId: postedEffect.companyId,
        state: "Posted",
      })

      // post_expense_sheet is deliberately same-key idempotent. The raw retry
      // converges successfully and must not create or relink another move.
      const postRetry = await replay(page, posted.request())
      expect(postRetry.ok()).toBe(true)
      expect(await sheetSnapshot(page, sheetId)).toEqual(postedEffect)
      expect(
        await moveSnapshot(page, postedEffect.accountMoveId!),
      ).toEqual(sourceMove)

      const reimburseAction = await openSheetAction(
        page,
        sheetId,
        "reimburse-sheets",
      )
      await reimburseAction.click()
      await expect(
        page.getByTestId("form-modal-reimburse-expense-report"),
      ).toBeVisible({ timeout: 15_000 })

      const liquidityLabel =
        (await fetchAccountSelectLabelByInternalType(
          page,
          "liquidity",
        ).catch(() => null)) ??
        (await (async () => {
          const bankId = await fetchAccountIdByCode(page, "1200")
          const row = (await rows(page, "account-accounts")).find(
            (account) => scalarQueryId(account.id) === bankId,
          )
          return `${String(row?.code ?? "1200")} — ${String(
            row?.name ?? "Bank",
          )}`
        })())

      await fillField(page, "paymentDate", isoDate(0))
      await chooseSelectOptionByLabel(page, "journalId", journalLabel)
      await chooseSelectOptionByLabel(
        page,
        "payableAccountId",
        payableLabel,
      )
      await chooseSelectOptionByLabel(
        page,
        "liquidityAccountId",
        liquidityLabel,
      )

      const [reimbursed] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(
              response,
              "create_expense_reimbursement_payment",
            ),
          { timeout: 45_000 },
        ),
        submitForm(page, "reimburse-expense-report"),
      ])
      expect(reimbursed.ok()).toBe(true)

      await expect
        .poll(() => sheetSnapshot(page, sheetId))
        .toMatchObject({ state: "Done" })
      const doneEffect = await sheetSnapshot(page, sheetId)
      expect(doneEffect.accountMoveId).toBe(postedEffect.accountMoveId)
      expect(doneEffect.reimbursementMoveId).not.toBeNull()
      const reimbursementMove = await moveSnapshot(
        page,
        doneEffect.reimbursementMoveId!,
      )
      expect(reimbursementMove).toMatchObject({
        organizationId,
        companyId: doneEffect.companyId,
        state: "Posted",
      })

      const staleReimbursement = await replay(
        page,
        reimbursed.request(),
      )
      expect(staleReimbursement.status()).toBe(422)
      expect(await sheetSnapshot(page, sheetId)).toEqual(doneEffect)
      expect(
        await moveSnapshot(page, doneEffect.accountMoveId!),
      ).toEqual(sourceMove)
      expect(
        await moveSnapshot(page, doneEffect.reimbursementMoveId!),
      ).toEqual(reimbursementMove)

      const readerContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const readerPage = await readerContext.newPage()
      try {
        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        for (const request of [
          submitted.request(),
          approvedRequest!,
          posted.request(),
          reimbursed.request(),
        ]) {
          const denied = await replay(readerPage, request)
          expect(denied.status()).toBe(403)
        }
        expect(await sheetSnapshot(page, sheetId)).toEqual(doneEffect)
        expect(
          await moveSnapshot(page, doneEffect.accountMoveId!),
        ).toEqual(sourceMove)
        expect(
          await moveSnapshot(page, doneEffect.reimbursementMoveId!),
        ).toEqual(reimbursementMove)
      } finally {
        await readerContext.close()
      }
    })
  },
)
