import { expect, test, type Page, type Request, type Response } from "@playwright/test"

import {
  callReducerBff,
  callReducerOwner,
  chooseSelectOptionByLabel,
  fetchAccountSelectLabelByInternalType,
  fetchCurrencyIdByCode,
  fetchDefaultCompanyId,
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

// COV-11 — see docs/plan/erp-cov11-expense-sheet-lifecycle-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const READER_EMAIL = "fixture.reader@example.test"

const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

type Row = Record<string, unknown>

/**
 * Trusted setup call that posts already-SATS-encoded args unchanged (no
 * params re-encoding), for fixtures the session compat route redacts.
 */
async function callOwnerRaw(reducer: string, args: unknown[]): Promise<void> {
  const host = (process.env.E2E_STDB_HOST ?? process.env.STDB_HOST ?? "http://127.0.0.1:3000").replace(/\/$/, "")
  const moduleName = process.env.STDB_MODULE?.trim()
  const token = process.env.STDB_SERVER_TOKEN?.trim()
  if (!moduleName || !token) throw new Error(`trusted fixture call ${reducer} requires STDB_MODULE and STDB_SERVER_TOKEN`)
  const response = await fetch(`${host}/v1/database/${moduleName}/call/${reducer}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  })
  if (!response.ok) {
    throw new Error(`trusted fixture reducer ${reducer} failed (${response.status}): ${await response.text()}`)
  }
}

async function rows(page: Page, path: string): Promise<Row[]> {
  const response = await page.request.get(path)
  if (!response.ok()) throw new Error(`${path} failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function exactId(page: Page, path: string, match: (row: Row) => boolean, label: string) {
  const matches = (await rows(page, path)).filter(match)
  if (matches.length !== 1) throw new Error(`${label}: expected one row, found ${matches.length}`)
  const id = scalarQueryId(matches[0]?.id)
  if (id == null) throw new Error(`${label} has no id`)
  return id
}

function identityHex(value: unknown): string {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return identityHex(record.hex ?? record.Hex ?? record.__identity__ ?? "")
  }
  return String(value ?? "").trim().replace(/^0x/i, "").toLowerCase()
}

function stateTag(state: unknown): string {
  if (typeof state === "string") return state
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const record = state as Record<string, unknown>
    if (typeof record.tag === "string") return record.tag
    const keys = Object.keys(record)
    if (keys.length === 1) return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
  }
  return String(state ?? "")
}

async function replay(page: Page, request: Request, rewrite?: (body: string) => string) {
  const url = new URL(request.url())
  const body = request.postData()
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: body != null && rewrite ? JSON.parse(rewrite(body)) : request.postDataJSON(),
  })
}

async function sheetSnapshot(page: Page, sheetId: number) {
  const matches = (await rows(page, "/api/query/expense-sheets")).filter((row) => scalarQueryId(row.id) === sheetId)
  if (matches.length !== 1) throw new Error(`expected one expense sheet ${sheetId}, found ${matches.length}`)
  const row = matches[0]!
  return {
    id: sheetId,
    organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
    state: stateTag(row.state),
    accountMoveId: scalarQueryId(row.accountMoveId ?? row.account_move_id) ?? null,
    reimbursementMoveId: scalarQueryId(row.reimbursementMoveId ?? row.reimbursement_move_id) ?? null,
  }
}

async function openSheets(page: Page) {
  await gotoModule(page, "/expenses", "expenses")
  await page.getByTestId("module-tab-expenses-expense-sheets").click()
}

/** Select one sheet in Expenses → Sheets and run a toolbar action; returns the operation response. */
async function runSheetAction(page: Page, sheetId: number, actionId: string, reducer: string): Promise<Response> {
  await openSheets(page)
  await selectEntityRowById(page, sheetId)
  const action = page.getByTestId(`entity-action-${actionId}`)
  await expect(action).toBeEnabled()
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => matchesOperationResponse(candidate, reducer), { timeout: 45_000 }),
    action.click(),
  ])
  return response
}

/** Open a sheet workflow form from its toolbar action; returns the operation response of its submit. */
async function runSheetForm(
  page: Page,
  sheetId: number,
  actionId: string,
  formId: string,
  reducer: string,
  fill: () => Promise<void>,
): Promise<Response> {
  await openSheets(page)
  await selectEntityRowById(page, sheetId)
  await page.getByTestId(`entity-action-${actionId}`).click()
  await expect(page.getByTestId(`form-modal-${formId}`)).toBeVisible({ timeout: 15_000 })
  await fill()
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => matchesOperationResponse(candidate, reducer), { timeout: 45_000 }),
    submitForm(page, formId),
  ])
  return response
}

test.describe("COV-11 exact expense sheet submit → approve → post → reimburse", { tag: ["@p0", "@cov11"] }, () => {
  test("operator drives the lifecycle; replays, self-approval and reader are rejected", async ({ browser, page }) => {
    test.setTimeout(420_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const currencyId = await fetchCurrencyIdByCode(page, "USD")

    // The signed-in admin session approves, so it must be an employee of the
    // organization (EXP-007). Link it to a dedicated employee record.
    await gotoModule(page, "/expenses", "expenses")
    const adminIdentity = identityHex(
      (await page.context().cookies()).find((cookie) => cookie.name === "stdb_identity")?.value,
    )
    expect(adminIdentity).toMatch(/^[0-9a-f]{64}$/)

    // ── Fixtures (setup calls only) ─────────────────────────────────────────
    const tag = smokeName("cov11")
    const createEmployee = async (name: string) => {
      await callReducerBff(page, "create_employee", [organizationId, {
        company_id: none,
        name,
        job_id: none,
        department_id: none,
        employment_type: { tag: "FullTime" },
        work_email: none,
        employee_number: none,
        job_title: none,
        parent_id: none,
        coach_id: none,
        work_phone: none,
        mobile_phone: none,
        work_location: none,
        work_contact_partner_id: none,
        date_hired: none,
        gender: none,
        birthday: none,
        marital: none,
        emergency_contact: none,
        emergency_phone: none,
        barcode: none,
        pin: none,
        image_url: none,
        color: none,
        is_active: true,
        metadata: none,
      }])
      return exactId(page, "/api/query/employees", (row) => row.name === name, name)
    }
    const employeeId = await createEmployee(`${tag} traveler`)
    const approverEmployeeId = await createEmployee(`${tag} approver`)
    await callOwnerRaw("update_employee", [organizationId, companyId, approverEmployeeId, {
      name: none,
      job_title: none,
      job_id: none,
      department_id: none,
      parent_id: none,
      work_email: none,
      work_phone: none,
      mobile_phone: none,
      work_location: none,
      work_contact_partner_id: none,
      employment_type: none,
      user_id: some({ __identity__: `0x${adminIdentity}` }),
    }])

    let lineSeq = 0
    /** A Draft sheet with one receipt-backed line, attached and ready to submit. */
    const createSheet = async (name: string) => {
      const receiptKey = `${tag}-rcpt-${(lineSeq += 1)}`
      await callReducerBff(page, "create_expense_receipt", [organizationId, {
        company_id: none,
        employee_id: employeeId,
        file_name: some("cov11.pdf"),
        mime_type: some("application/pdf"),
        storage_key: `e2e:${receiptKey}`,
        content_hash: none,
        client_request_id: some(receiptKey),
      }])
      const receiptId = await exactId(
        page,
        "/api/query/expense-receipts",
        (row) => (row.clientRequestId ?? row.client_request_id) === receiptKey,
        `${name} receipt`,
      )
      await callReducerBff(page, "create_expense_sheet", [organizationId, {
        company_id: none,
        employee_id: employeeId,
        name,
        currency_id: currencyId,
        notes: none,
        accounting_date: none,
      }])
      const sheetId = await exactId(page, "/api/query/expense-sheets", (row) => row.name === name, name)
      const lineName = `${name}-line`
      await callReducerBff(page, "create_expense", [organizationId, {
        company_id: none,
        employee_id: employeeId,
        name: lineName,
        date: { __timestamp_micros_since_unix_epoch__: Date.now() * 1000 },
        // Unique amount avoids same employee+day+amount fraud holds.
        unit_amount: 40 + lineSeq * 7 + (Date.now() % 1000) / 1000,
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
        client_request_id: some(`${tag}-line-${lineSeq}`),
        payment_mode: { outOfPocket: [] },
        merchant_key: some(`${tag}-merchant-${lineSeq}`),
        policy_exception_reason: none,
      }])
      const lineId = await exactId(page, "/api/query/expenses", (row) => row.name === lineName, lineName)
      await callReducerBff(page, "submit_expense", [organizationId, lineId, sheetId])
      return sheetId
    }
    const ownSheet = await createSheet(`${tag}-own`)
    const flowSheet = await createSheet(`${tag}-flow`)
    for (const sheetId of [ownSheet, flowSheet]) {
      expect(await sheetSnapshot(page, sheetId)).toMatchObject({ organizationId, state: "Draft", accountMoveId: null })
    }

    const expenseLabel = await fetchAccountSelectLabelByInternalType(page, "expense")
    const payableLabel = await fetchAccountSelectLabelByInternalType(page, "payable")
    const liquidityLabel = await fetchAccountSelectLabelByInternalType(page, "liquidity")
    const journals = await rows(page, "/api/query/account-journals")
    const journalRow = journals.find((j) => String(j.code ?? "").toUpperCase() === "MISC") ?? journals[0]
    expect(journalRow).toBeTruthy()
    const journalLabel =
      journalRow!.code && journalRow!.name ? `${journalRow!.code} — ${journalRow!.name}` : String(journalRow!.name ?? journalRow!.code)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, READER_EMAIL, PERSONA_PASSWORD)
      const denied = async (request: Request, sheetId: number, expected: Awaited<ReturnType<typeof sheetSnapshot>>) => {
        expect((await replay(readerPage, request)).status()).toBe(403)
        expect(await sheetSnapshot(page, sheetId)).toEqual(expected)
      }

      // ── Submit from the visible toolbar action, then replay ─────────────
      const submitted = await runSheetAction(page, ownSheet, "submit-sheets", "submit_expense_sheet")
      expect(submitted.ok()).toBe(true)
      await expect.poll(() => sheetSnapshot(page, ownSheet)).toMatchObject({ state: "Submitted", accountMoveId: null })
      const submittedSnapshot = await sheetSnapshot(page, ownSheet)
      expect((await replay(page, submitted.request())).status()).toBe(422)
      expect(await sheetSnapshot(page, ownSheet)).toEqual(submittedSnapshot)
      await denied(submitted.request(), ownSheet, submittedSnapshot)

      // Separation of duties: the submitter cannot approve their own sheet.
      const selfApproval = await runSheetAction(page, ownSheet, "approve-sheets", "approve_expense_sheet")
      expect(selfApproval.status()).toBe(422)
      expect(await sheetSnapshot(page, ownSheet)).toEqual(submittedSnapshot)

      // ── A different identity submitted this one; the admin approves it ──
      await callReducerOwner("submit_expense_sheet", [organizationId, flowSheet])
      await expect.poll(() => sheetSnapshot(page, flowSheet)).toMatchObject({ state: "Submitted" })

      const approved = await runSheetAction(page, flowSheet, "approve-sheets", "approve_expense_sheet")
      expect(approved.ok()).toBe(true)
      await expect.poll(() => sheetSnapshot(page, flowSheet)).toMatchObject({ state: "Approved", accountMoveId: null })
      const approvedSnapshot = await sheetSnapshot(page, flowSheet)
      expect((await replay(page, approved.request())).status()).toBe(422)
      expect(await sheetSnapshot(page, flowSheet)).toEqual(approvedSnapshot)
      await denied(approved.request(), flowSheet, approvedSnapshot)

      // ── Post: the sheet reads back with its own journal entry ───────────
      const posted = await runSheetForm(page, flowSheet, "post-sheets", "post-expense-report", "post_expense_sheet", async () => {
        await fillField(page, "accountingDate", isoDate(0))
        await chooseSelectOptionByLabel(page, "journalId", journalLabel)
        await chooseSelectOptionByLabel(page, "defaultExpenseAccountId", expenseLabel)
        await chooseSelectOptionByLabel(page, "payableAccountId", payableLabel)
      })
      expect(posted.ok()).toBe(true)
      await expect.poll(() => sheetSnapshot(page, flowSheet)).toMatchObject({ state: "Posted", reimbursementMoveId: null })
      const postedSnapshot = await sheetSnapshot(page, flowSheet)
      expect(postedSnapshot.accountMoveId).toBeGreaterThan(0)
      const postingMoves = (await rows(page, "/api/query/account-moves")).filter(
        (row) => scalarQueryId(row.id) === postedSnapshot.accountMoveId,
      )
      expect(postingMoves).toHaveLength(1)
      // Same client request id (stable per sheet) is an idempotent no-op; a new one is stale.
      expect((await replay(page, posted.request())).ok()).toBe(true)
      expect(await sheetSnapshot(page, flowSheet)).toEqual(postedSnapshot)
      const stalePost = await replay(page, posted.request(), (body) => body.replace(/exp-post-/g, "exp-post-stale-"))
      expect(stalePost.status()).toBe(422)
      expect(await sheetSnapshot(page, flowSheet)).toEqual(postedSnapshot)
      await denied(posted.request(), flowSheet, postedSnapshot)

      // ── Partial reimbursement attaches its own move; sheet stays Posted ─
      const flowRow = (await rows(page, "/api/query/expense-sheets")).find((row) => scalarQueryId(row.id) === flowSheet)
      const totalAmount = Number(flowRow?.totalAmount ?? flowRow?.total_amount)
      expect(totalAmount).toBeGreaterThan(0)
      const fillReimbursement = (amount?: string) => async () => {
        await fillField(page, "paymentDate", isoDate(0))
        await chooseSelectOptionByLabel(page, "journalId", journalLabel)
        await chooseSelectOptionByLabel(page, "payableAccountId", payableLabel)
        await chooseSelectOptionByLabel(page, "liquidityAccountId", liquidityLabel)
        if (amount) await fillField(page, "amount", amount)
      }
      const partial = await runSheetForm(
        page,
        flowSheet,
        "reimburse-sheets",
        "reimburse-expense-report",
        "create_expense_reimbursement_payment",
        fillReimbursement((totalAmount / 2).toFixed(2)),
      )
      expect(partial.ok()).toBe(true)
      await expect.poll(async () => (await sheetSnapshot(page, flowSheet)).reimbursementMoveId).not.toBeNull()
      const partialSnapshot = await sheetSnapshot(page, flowSheet)
      expect(partialSnapshot.state).toBe("Posted")
      expect(partialSnapshot.accountMoveId).toBe(postedSnapshot.accountMoveId)
      expect(partialSnapshot.reimbursementMoveId).not.toBe(postedSnapshot.accountMoveId)

      // ── Final reimbursement clears the sheet with a new, distinct move ──
      const final = await runSheetForm(
        page,
        flowSheet,
        "reimburse-sheets",
        "reimburse-expense-report",
        "create_expense_reimbursement_payment",
        fillReimbursement(),
      )
      expect(final.ok()).toBe(true)
      await expect.poll(async () => (await sheetSnapshot(page, flowSheet)).state).toBe("Done")
      const doneSnapshot = await sheetSnapshot(page, flowSheet)
      expect(doneSnapshot.accountMoveId).toBe(postedSnapshot.accountMoveId)
      expect(doneSnapshot.reimbursementMoveId).not.toBeNull()
      expect(doneSnapshot.reimbursementMoveId).not.toBe(partialSnapshot.reimbursementMoveId)
      expect(doneSnapshot.reimbursementMoveId).not.toBe(doneSnapshot.accountMoveId)

      // Replays of a finished sheet are stale (422) and denied for the reader (403).
      for (const request of [partial.request(), final.request()]) {
        expect((await replay(page, request)).status()).toBe(422)
        expect(await sheetSnapshot(page, flowSheet)).toEqual(doneSnapshot)
        await denied(request, flowSheet, doneSnapshot)
      }
      expect((await replay(page, posted.request(), (body) => body.replace(/exp-post-/g, "exp-post-late-"))).status()).toBe(422)
      expect(await sheetSnapshot(page, flowSheet)).toEqual(doneSnapshot)
    } finally {
      await readerContext.close()
    }
  })
})
