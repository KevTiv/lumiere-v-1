/**
 * Expenses Waves A–F UI coverage for this session.
 * Tags: @expenses @p0 (shell/lifecycle UI).
 *
 * Fixture note: e2e auth is a single storage state — same-identity SoD blocks approve.
 * Gate-enabled SoD approve is proven in domain `run_expenses_wave_f_test`.
 * Post → reimburse uses the seeded Approved sheet ("Q1 Business Trips") when present.
 */
import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  callReducerOwner,
  callReducerBffResult,
  chooseSelectOptionByLabel,
  expectNoAppError,
  fetchAccountIdByCode,
  fetchAccountSelectLabelByInternalType,
  fetchCurrencyIdByCode,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  isoDate,
  scalarQueryId,
  selectEntityRowById,
  smokeName,
  submitForm,
} from "./helpers"

const some = <T>(value: T) => ({ some: value })
const none = { none: [] as [] }

async function openExpensesTab(page: Page, tabId: string) {
  await page.getByTestId(`module-tab-expenses-${tabId}`).click()
}

test.describe("Expenses wave lifecycle e2e @expenses", () => {
  test("toolbar actions and capture/ops panels render @p0", async ({ page }) => {
    await gotoModule(page, "/expenses", "expenses")

    await expect(page.getByTestId("expenses-capture-panel")).toBeVisible()
    await expect(page.getByTestId("expenses-capture-submit")).toBeVisible()
    await expect(page.getByTestId("expenses-capture-flush")).toBeVisible()
    await expect(page.getByTestId("expenses-ops-panel")).toBeVisible()
    await expect(page.getByTestId("expenses-ops-flush-intents")).toBeVisible()
    await expectNoAppError(page)

    await openExpensesTab(page, "expense-sheets")
    await expect(page.getByTestId("entity-action-submit-sheets")).toBeVisible()
    await expect(page.getByTestId("entity-action-post-sheets")).toBeVisible()
    await expect(page.getByTestId("entity-action-reimburse-sheets")).toBeVisible()
    await expectNoAppError(page)
  })

  test("dashboard New Report opens create sheet form @p0", async ({ page }) => {
    await gotoModule(page, "/expenses", "expenses")
    await page.getByTestId("module-tab-expenses-dashboard").click()
    const newReport = page.getByRole("button", { name: /New Report/i }).first()
    await expect(newReport).toBeVisible()
    await newReport.click()
    await expect(page.getByText(/New Expense Report|Report Name/i).first()).toBeVisible()
    await expectNoAppError(page)
  })

  test("capture panel queues delayed-sync expense @p0", async ({ page }) => {
    await gotoModule(page, "/expenses", "expenses")
    await expect(page.getByTestId("expenses-capture-panel")).toBeVisible()

    const employee = page.getByTestId("expenses-capture-employee")
    const pricelist = page.getByTestId("expenses-capture-pricelist")
    await expect(employee.locator("option")).not.toHaveCount(1, { timeout: 30_000 })
    await employee.selectOption({ index: 1 })
    await expect(pricelist.locator("option")).not.toHaveCount(1, { timeout: 30_000 })
    await pricelist.selectOption({ index: 1 })

    const name = smokeName("capture")
    await page.getByTestId("expenses-capture-name").fill(name)
    await page.getByTestId("expenses-capture-amount").fill("12.5")
    await page.getByTestId("expenses-capture-submit").click()

    await expect(page.getByTestId("expenses-capture-status")).toBeVisible({ timeout: 30_000 })
    await expectNoAppError(page)
  })

  test("ops FX fee + allocations form from expense row @p0", async ({ page }) => {
    await gotoModule(page, "/expenses", "expenses")
    // Wave D/E ops surface: FX fee on statement create (post advance covered in domain tests).
    await expect(page.getByTestId("expenses-ops-panel")).toBeVisible()
    await expect(page.getByTestId("expenses-ops-amount")).toBeVisible()
    await expect(page.getByPlaceholder("FX fee")).toBeVisible()

    // Allocations: create a Draft expense via BFF (seed rows are often Approved), then open form.
    const organizationId = await fetchSessionOrganizationId(page)
    const currencyId = await fetchCurrencyIdByCode(page, "USD")
    const employees = await page.request.get("/api/query/employees")
    const employeeId = Number(((await employees.json()) as { data?: Array<{ id?: number }> }).data?.[0]?.id)
    expect(employeeId).toBeGreaterThan(0)
    const name = smokeName("alloc")
    const receiptKey = `e2e-rcpt-${Date.now()}`
    await callReducerBff(page, "create_expense_receipt", [
      organizationId,
      {
        company_id: none,
        employee_id: employeeId,
        file_name: some("e2e.pdf"),
        mime_type: some("application/pdf"),
        storage_key: `e2e:${receiptKey}`,
        content_hash: none,
        client_request_id: some(receiptKey),
      },
    ])
    const receipts = await page.request.get("/api/query/expense-receipts")
    const receiptId = Number(
      ((await receipts.json()) as { data?: Array<{ id?: number; clientRequestId?: string; client_request_id?: string }> })
        .data?.find((r) => (r.clientRequestId ?? r.client_request_id) === receiptKey)?.id,
    )
    expect(receiptId).toBeGreaterThan(0)
    await callReducerBff(page, "create_expense", [
      organizationId,
      {
        company_id: none,
        employee_id: employeeId,
        name,
        date: { __timestamp_micros_since_unix_epoch__: Date.now() * 1000 },
        unit_amount: 22,
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
        client_request_id: some(`e2e-alloc-${Date.now()}`),
        payment_mode: { outOfPocket: [] },
        merchant_key: none,
        policy_exception_reason: none,
      },
    ])
    await page.reload()
    await gotoModule(page, "/expenses", "expenses")
    await openExpensesTab(page, "expenses")
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 45_000 })
    // Click the row containing the new Draft expense (ModuleView may wrap cells).
    await page.getByText(name).first().click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 })
    const allocBtn = page.getByRole("button", { name: "Split allocations" })
    await expect(allocBtn).toBeVisible({ timeout: 15_000 })
    await allocBtn.click()
    await expect(page.getByText(/Split expense allocations|allocation|share/i).first()).toBeVisible()
    await expectNoAppError(page)
  })

  test("capture conflict controls appear after forced error @expenses", async ({ page }) => {
    await gotoModule(page, "/expenses", "expenses")
    // Seed a conflict item via localStorage to assert retry/discard UI without flaky network.
    const organizationId = await fetchSessionOrganizationId(page)
    const currencyId = await fetchCurrencyIdByCode(page, "USD")
    await page.evaluate(
      ({ orgId, currencyId }) => {
        const deviceKey = "lumiere.expense-capture-device-id"
        let deviceId = window.localStorage.getItem(deviceKey)
        if (!deviceId) {
          deviceId = "e2e-device"
          window.localStorage.setItem(deviceKey, deviceId)
        }
        const key = `lumiere.expense-capture-outbox.${orgId}.${deviceId}`
        const item = {
          clientRequestId: `exp-cap-conflict-${Date.now()}`,
          deviceId,
          payload: {
            employeeId: "1",
            name: "Conflict meal",
            date: new Date().toISOString().slice(0, 10),
            unitAmount: 9,
            quantity: 1,
            currencyId: String(currencyId),
            hasReceipt: true,
            lineKind: "Standard",
          },
          createdAt: new Date().toISOString(),
          syncState: "conflict",
          lastError: "idempotency conflict",
        }
        window.localStorage.setItem(key, JSON.stringify([item]))
      },
      { orgId: organizationId, currencyId },
    )
    await page.reload()
    await gotoModule(page, "/expenses", "expenses")
    await expect(page.getByTestId("expenses-capture-item-conflict")).toBeVisible()
    await expect(page.getByTestId("expenses-capture-retry")).toBeVisible()
    await expect(page.getByTestId("expenses-capture-discard")).toBeVisible()
    await page.getByTestId("expenses-capture-discard").click()
    await expect(page.getByTestId("expenses-capture-item-conflict")).toHaveCount(0)
  })

  test("ops panel can create card statement line @expenses", async ({ page }) => {
    await gotoModule(page, "/expenses", "expenses")
    await expect(page.getByTestId("expenses-ops-panel")).toBeVisible()
    const ref = smokeName("stmt")
    await page.getByTestId("expenses-ops-external-ref").fill(ref)
    await page.getByTestId("expenses-ops-amount").fill("33")
    await page.getByPlaceholder("FX fee").fill("1.25")
    await page.getByTestId("expenses-ops-create-statement").click()
    await expect(page.getByTestId("expenses-ops-status")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId("expenses-ops-status")).not.toContainText(/error|failed|invalid/i)
    await expectNoAppError(page)
  })

  test("submit → SoD block → post → reimburse lifecycle @expenses @p0", async ({ page }) => {
    test.setTimeout(180_000)
    await gotoModule(page, "/expenses", "expenses")
    const organizationId = await fetchSessionOrganizationId(page)
    const currencyId = await fetchCurrencyIdByCode(page, "USD")

    const employees = await page.request.get("/api/query/employees")
    const employeeId = Number(((await employees.json()) as { data?: Array<{ id?: number }> }).data?.[0]?.id)
    expect(employeeId).toBeGreaterThan(0)

    const sheetName = smokeName("lifecycle-sheet")
    const expenseName = smokeName("lifecycle-line")
    const receiptKey = `e2e-lc-${Date.now()}`

    await callReducerBff(page, "create_expense_receipt", [
      organizationId,
      {
        company_id: none,
        employee_id: employeeId,
        file_name: some("lifecycle.pdf"),
        mime_type: some("application/pdf"),
        storage_key: `e2e:${receiptKey}`,
        content_hash: none,
        client_request_id: some(receiptKey),
      },
    ])
    const receipts = await page.request.get("/api/query/expense-receipts")
    const receiptId = Number(
      ((await receipts.json()) as { data?: Array<{ id?: number; clientRequestId?: string; client_request_id?: string }> })
        .data?.find((r) => (r.clientRequestId ?? r.client_request_id) === receiptKey)?.id,
    )
    expect(receiptId).toBeGreaterThan(0)

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
    const sheetsRes = await page.request.get("/api/query/expense-sheets")
    const sheetId = Number(
      ((await sheetsRes.json()) as { data?: Array<{ id?: number; name?: string }> }).data?.find(
        (s) => s.name === sheetName,
      )?.id,
    )
    expect(sheetId).toBeGreaterThan(0)

    await callReducerBff(page, "create_expense", [
      organizationId,
      {
        company_id: none,
        employee_id: employeeId,
        name: expenseName,
        date: { __timestamp_micros_since_unix_epoch__: Date.now() * 1000 },
        // Unique amount avoids seed/demo duplicate fraud holds (same employee+day+amount).
        unit_amount: 48.17 + (Date.now() % 1000) / 1000,
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
        client_request_id: some(`e2e-lc-exp-${Date.now()}`),
        payment_mode: { outOfPocket: [] },
        merchant_key: some(`e2e-merchant-${Date.now()}`),
        policy_exception_reason: none,
      },
    ])
    const expensesRes = await page.request.get("/api/query/expenses")
    const expenseId = Number(
      ((await expensesRes.json()) as { data?: Array<{ id?: number; name?: string }> }).data?.find(
        (e) => e.name === expenseName,
      )?.id,
    )
    expect(expenseId).toBeGreaterThan(0)

    await callReducerBff(page, "submit_expense", [organizationId, expenseId, sheetId])
    await callReducerBff(page, "submit_expense_sheet", [organizationId, sheetId])

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/expense-sheets")
        if (!res.ok()) return ""
        const json = (await res.json()) as {
          data?: Array<{ id?: number; state?: string | { tag?: string } }>
        }
        const row = (json.data ?? []).find((s) => Number(s.id) === sheetId)
        const state = row?.state
        return typeof state === "string" ? state : String(state?.tag ?? "")
      }, { timeout: 45_000 })
      .toMatch(/Submitted/i)

    // Single-user fixture: public approve must SoD-fail (second identity covered in domain Wave F).
    const approveResult = await callReducerBffResult(page, "approve_expense_sheet", [
      organizationId,
      sheetId,
    ])
    expect(approveResult.ok).toBe(false)
    expect(approveResult.error ?? "").toMatch(/sod|cannot approve|submitter/i)

    // Post + reimburse via seeded "Q1 Business Trips" (Approved on fresh seed; Posted if prior run).
    const sheetState = (state: unknown) => {
      if (state == null) return ""
      if (typeof state === "string") return state
      if (typeof state === "object" && !Array.isArray(state)) {
        const obj = state as Record<string, unknown>
        if (typeof obj.tag === "string") return obj.tag
        const keys = Object.keys(obj)
        if (keys.length === 1) {
          const key = keys[0]!
          const payload = obj[key]
          if (Array.isArray(payload) && payload.length === 0) {
            return key.charAt(0).toUpperCase() + key.slice(1)
          }
        }
      }
      return ""
    }
    const seedSheets = await page.request.get("/api/query/expense-sheets")
    const seedJson = (await seedSheets.json()) as {
      data?: Array<{
        id?: number
        name?: string
        state?: string | { tag?: string }
        accountMoveId?: number | string | null
        account_move_id?: number | string | null
      }>
    }
    const seedSheet = (seedJson.data ?? []).find((s) => s.name === "Q1 Business Trips")
    expect(seedSheet?.id, "seeded sheet Q1 Business Trips required for post/reimburse").toBeTruthy()
    const postSheetId = Number(seedSheet!.id)
    let seedState = sheetState(seedSheet!.state)
    let accountMoveId = scalarQueryId(seedSheet!.accountMoveId ?? seedSheet!.account_move_id) ?? 0

    const journals = await page.request.get("/api/query/account-journals")
    const journalData =
      ((await journals.json()) as { data?: Array<{ code?: string; name?: string }> }).data ?? []
    const journalRow =
      journalData.find((j) => String(j.code ?? "").toUpperCase() === "MISC") ?? journalData[0]
    expect(journalRow).toBeTruthy()
    const journalLabel =
      journalRow!.code && journalRow!.name
        ? `${journalRow!.code} — ${journalRow!.name}`
        : String(journalRow!.name ?? journalRow!.code)

    const expenseLabel = await fetchAccountSelectLabelByInternalType(page, "expense")
    const payableLabel = await fetchAccountSelectLabelByInternalType(page, "payable")

    if (/Approved/i.test(seedState)) {
      await gotoModule(page, "/expenses", "expenses")
      await openExpensesTab(page, "expense-sheets")
      await selectEntityRowById(page, postSheetId)
      await page.getByTestId("entity-action-post-sheets").click()
      await expect(page.getByTestId("form-modal-post-expense-report")).toBeVisible({ timeout: 15_000 })

      await fillField(page, "accountingDate", isoDate(0))
      await chooseSelectOptionByLabel(page, "journalId", journalLabel)
      await chooseSelectOptionByLabel(page, "defaultExpenseAccountId", expenseLabel)
      await chooseSelectOptionByLabel(page, "payableAccountId", payableLabel)

      const [postRes] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes("/api/call/post_expense_sheet") && res.ok(),
          { timeout: 45_000 },
        ),
        submitForm(page, "post-expense-report"),
      ])
      expect(postRes.ok()).toBe(true)

      await expect
        .poll(async () => {
          const res = await page.request.get("/api/query/expense-sheets")
          if (!res.ok()) return ""
          const json = (await res.json()) as {
            data?: Array<{
              id?: number
              state?: string | { tag?: string }
              accountMoveId?: number | string | null
              account_move_id?: number | string | null
            }>
          }
          const row = (json.data ?? []).find((s) => Number(s.id) === postSheetId)
          seedState = sheetState(row?.state)
          accountMoveId = scalarQueryId(row?.accountMoveId ?? row?.account_move_id) ?? 0
          return seedState
        }, { timeout: 60_000 })
        .toMatch(/Posted/i)
    } else {
      expect(seedState, "Q1 sheet must be Approved or Posted").toMatch(/Posted|Done/i)
      expect(accountMoveId).toBeGreaterThan(0)
    }
    expect(accountMoveId).toBeGreaterThan(0)

    await gotoModule(page, "/expenses", "expenses")
    await openExpensesTab(page, "expense-sheets")
    await selectEntityRowById(page, postSheetId)
    await page.getByTestId("entity-action-reimburse-sheets").click()
    await expect(page.getByTestId("form-modal-reimburse-expense-report")).toBeVisible({
      timeout: 15_000,
    })

    const liquidityLabel =
      (await fetchAccountSelectLabelByInternalType(page, "liquidity").catch(() => null)) ??
      (await (async () => {
        const bankId = await fetchAccountIdByCode(page, "1200")
        const res = await page.request.get("/api/query/account-accounts")
        const json = (await res.json()) as { data?: Array<{ id?: number; code?: string; name?: string }> }
        const row = (json.data ?? []).find((a) => Number(a.id) === bankId)
        const code = String(row?.code ?? "1200")
        const name = String(row?.name ?? "Bank")
        return `${code} — ${name}`
      })())

    await fillField(page, "paymentDate", isoDate(0))
    await chooseSelectOptionByLabel(page, "journalId", journalLabel)
    await chooseSelectOptionByLabel(page, "payableAccountId", payableLabel)
    await chooseSelectOptionByLabel(page, "liquidityAccountId", liquidityLabel)

    const [reimRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_expense_reimbursement_payment") && res.ok(),
        { timeout: 45_000 },
      ),
      submitForm(page, "reimburse-expense-report"),
    ])
    expect(reimRes.ok()).toBe(true)

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/expense-sheets")
        if (!res.ok()) return ""
        const json = (await res.json()) as {
          data?: Array<{ id?: number; state?: string | { tag?: string } }>
        }
        const row = (json.data ?? []).find((s) => Number(s.id) === postSheetId)
        const state = typeof row?.state === "string" ? row.state : String(row?.state?.tag ?? "")
        return state
      }, { timeout: 60_000 })
      .toMatch(/Done/i)

    await expectNoAppError(page)
  })

  // EXP-013 approve→post: the single-identity browser fixture cannot approve its
  // own submission (SoD), so the gate-enabled approve + post path is proven via
  // the domain suite (`run_all_domain_tests` → expenses waves D/E/F), which
  // exercises approve_expense_sheet_impl with a second identity and then
  // post_expense_sheet to a Posted move. The lifecycle test above covers the
  // browser-visible submit→post→reimburse path; this test covers the
  // approve→post reducer contract that SoD hides from the UI.
  test("approve → post domain path (second-identity SoD) @p0", async ({ page }) => {
    test.setTimeout(300_000)
    await gotoModule(page, "/expenses", "expenses")
    await callReducerOwner("run_all_domain_tests", [])
    await expectNoAppError(page)
  })
})
