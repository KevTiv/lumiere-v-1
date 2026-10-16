import {
  expect,
  test,
  type APIResponse,
  type Page,
  type Request,
  type Response,
} from "@playwright/test"
import {
  prepareOutstandingDocumentImport,
} from "@lumiere/erp-shared/outstanding-document-import"

import {
  fetchDefaultCompanyId,
  gotoModule,
  openAccountingTab,
  openSettingsSection,
  scalarQueryId,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"
import {
  fixtureCsv,
  historicalJournalCsv,
  historicalPaymentAllocationFixture,
  openingBalanceCsv,
} from "./rwanda-accounting-alpha-fixtures"

type Row = Record<string, unknown>

const RUN_REHEARSAL = process.env.E2E_RWANDA_ALPHA_REHEARSAL === "1"
const REQUIRE_ACCEPTED_PACK =
  process.env.E2E_RWANDA_REQUIRE_ACCEPTED_PACK === "1"
const REHEARSAL_ENV = [
  "E2E_RWANDA_RUN_ID",
  "E2E_RWANDA_TENANT_REF",
  "E2E_RWANDA_EXPECTED_COMPANY_ID",
  "E2E_RWANDA_OPERATOR_NAME",
  "E2E_RWANDA_OPERATOR_EMAIL",
  "E2E_RWANDA_RELEASE_COMMIT",
  "E2E_RWANDA_CONTRACT_VERSION",
  "E2E_RWANDA_MODULE_VERSION",
  "E2E_RWANDA_CUTOVER_DATE",
  "E2E_RWANDA_CUSTOMER_PARTNER_ID",
  "E2E_RWANDA_SUPPLIER_PARTNER_ID",
  "E2E_RWANDA_MIGRATION_MODE",
] as const

function rehearsalContext(): Record<string, string> {
  const missing: string[] = REHEARSAL_ENV.filter((name) => !process.env[name]?.trim())
  if (process.env.E2E_RWANDA_ISOLATED_TENANT_ACK !== "1") {
    missing.push("E2E_RWANDA_ISOLATED_TENANT_ACK=1")
  }
  if (missing.length > 0) {
    throw new Error(`Missing Rwanda rehearsal configuration: ${missing.join(", ")}`)
  }
  const context = Object.fromEntries(REHEARSAL_ENV.map((name) => [name, process.env[name]!.trim()]))
  if (!/^[0-9a-f]{40}$/.test(context.E2E_RWANDA_RELEASE_COMMIT!)) {
    throw new Error("E2E_RWANDA_RELEASE_COMMIT must be a full lowercase Git commit SHA")
  }
  if (!new Set(["residual_only", "original_total_with_payment_replay"]).has(context.E2E_RWANDA_MIGRATION_MODE!)) {
    throw new Error("E2E_RWANDA_MIGRATION_MODE must be residual_only or original_total_with_payment_replay")
  }
  if (!/^[1-9][0-9]*$/.test(context.E2E_RWANDA_EXPECTED_COMPANY_ID!)) {
    throw new Error("E2E_RWANDA_EXPECTED_COMPANY_ID must be a positive integer")
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(context.E2E_RWANDA_CUTOVER_DATE!) ||
    Number.isNaN(Date.parse(`${context.E2E_RWANDA_CUTOVER_DATE}T00:00:00Z`))
  ) {
    throw new Error("E2E_RWANDA_CUTOVER_DATE must be an ISO date")
  }
  for (const name of [
    "E2E_RWANDA_CUSTOMER_PARTNER_ID",
    "E2E_RWANDA_SUPPLIER_PARTNER_ID",
  ]) {
    if (!/^[1-9][0-9]*$/.test(context[name]!)) {
      throw new Error(`${name} must be a positive integer`)
    }
  }
  if (context.E2E_RWANDA_MIGRATION_MODE === "original_total_with_payment_replay") {
    for (const name of [
      "E2E_RWANDA_CUSTOMER_PAYMENT_TRANSACTION_ID",
      "E2E_RWANDA_SUPPLIER_PAYMENT_TRANSACTION_ID",
    ]) {
      const value = process.env[name]?.trim() ?? ""
      if (!/^[1-9][0-9]*$/.test(value)) {
        throw new Error(`${name} must identify a posted company-currency historical payment`)
      }
      context[name] = value
    }
  }
  return context
}

type HistoricalReplayRun = {
  requestBody: Row
  paymentTransactionId: number
  documentMoveIds: number[]
  reconciliationIds: number[]
  firstResponseStatus: number
  firstResponseBody: unknown
}

let historicalReplayRuns: HistoricalReplayRun[] = []

function optionValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if ("some" in record) return optionValue(record.some)
    if ("none" in record) return null
  }
  return value
}

function enumTag(value: unknown): string {
  const unwrapped = optionValue(value)
  if (typeof unwrapped === "string") return unwrapped.toLowerCase()
  if (unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)) {
    const record = unwrapped as Record<string, unknown>
    if (typeof record.tag === "string") return record.tag.toLowerCase()
    const keys = Object.keys(record)
    if (keys.length === 1) return keys[0]!.toLowerCase()
  }
  return ""
}

function numberValue(row: Row, camel: string, snake = camel): number {
  return Number(optionValue(row[camel] ?? row[snake]) ?? 0)
}

function timestampMillis(value: unknown): number | null {
  const unwrapped = optionValue(value)
  if (typeof unwrapped === "string") {
    const parsed = Date.parse(unwrapped)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof unwrapped === "number") {
    return unwrapped > 100_000_000_000_000 ? unwrapped / 1000 : unwrapped
  }
  if (unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)) {
    const record = unwrapped as Row
    const micros = record.__timestamp_micros_since_unix_epoch__ ??
      record.microsSinceUnixEpoch ?? record.micros_since_unix_epoch
    if (typeof micros === "number" || typeof micros === "string") {
      const numeric = Number(micros)
      return Number.isFinite(numeric) ? numeric / 1000 : null
    }
  }
  return null
}

async function queryRows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) {
    throw new Error(`${resource} query failed: ${response.status()}`)
  }
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function attachJson(name: string, value: unknown): Promise<void> {
  const context = rehearsalContext()
  await test.info().attach(name, {
    body: Buffer.from(JSON.stringify({
      evidenceBinding: {
        runId: context.E2E_RWANDA_RUN_ID,
        tenantRef: context.E2E_RWANDA_TENANT_REF,
        companyId: Number(context.E2E_RWANDA_EXPECTED_COMPANY_ID),
        releaseCommit: context.E2E_RWANDA_RELEASE_COMMIT,
        contractVersion: context.E2E_RWANDA_CONTRACT_VERSION,
        moduleVersion: context.E2E_RWANDA_MODULE_VERSION,
        cutoverDate: context.E2E_RWANDA_CUTOVER_DATE,
        migrationMode: context.E2E_RWANDA_MIGRATION_MODE,
      },
      evidence: value,
    }, null, 2)),
    contentType: "application/json",
  })
}

function rowCompanyId(row: Row): number | null {
  return scalarQueryId(row.companyId ?? row.company_id)
}

function rowId(row: Row): number | null {
  return scalarQueryId(row.id)
}

function accountByClassification(
  rows: Row[],
  companyId: number,
  classification: string,
): Row | undefined {
  const target = classification.toLowerCase()
  return rows.find(
    (row) =>
      rowCompanyId(row) === companyId &&
      (enumTag(row.internalType ?? row.internal_type) === target ||
        enumTag(row.internalGroup ?? row.internal_group) === target) &&
      row.deprecated !== true,
  )
}

function journalByType(rows: Row[], companyId: number, type: string): Row | undefined {
  const target = type.toLowerCase()
  return rows.find(
    (row) =>
      rowCompanyId(row) === companyId &&
      enumTag(row.type ?? row.type_) === target &&
      row.active !== false,
  )
}

async function selectCsvFile(
  page: Page,
  name: string,
  contents: string,
): Promise<void> {
  await page.locator('#csv-import-file').setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(contents),
  })
}

async function submitTrackedCsv(page: Page, entity: string): Promise<Response> {
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === `/api/import/${entity}` &&
      candidate.request().method() === "POST",
  )
  await page.getByRole("dialog").getByRole("button", { name: /^import$/i }).click()
  return response
}

async function replayRequest(page: Page, request: Request): Promise<APIResponse> {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function moveLines(page: Page, moveId: number): Promise<Row[]> {
  return (await queryRows(page, "account-move-lines")).filter(
    (row) => scalarQueryId(row.moveId ?? row.move_id) === moveId,
  )
}

async function activeReconciliationIds(page: Page, transactionId: number): Promise<number[]> {
  return (await queryRows(page, "payment-reconciliations"))
    .filter(
      (row) =>
        scalarQueryId(row.paymentTransactionId ?? row.payment_transaction_id) === transactionId &&
        optionValue(row.isReversal ?? row.is_reversal) !== true,
    )
    .map((row) => rowId(row))
    .filter((id): id is number => id != null)
    .sort((left, right) => left - right)
}

function balancedEvidence(lines: Row[]) {
  const debit = lines.reduce(
    (sum, row) => sum + numberValue(row, "debit"),
    0,
  )
  const credit = lines.reduce(
    (sum, row) => sum + numberValue(row, "credit"),
    0,
  )
  return { lineCount: lines.length, debit, credit, difference: debit - credit }
}

async function createManualDocument(
  page: Page,
  kind: "invoice" | "bill",
  description: string,
): Promise<{ moveId: number; evidence: ReturnType<typeof balancedEvidence> }> {
  await gotoModule(page, "/accounting", "accounting")
  await page.getByTestId(`quick-action-create_${kind}`).click()
  await expect(page.getByTestId("create-invoice-modal")).toBeVisible()
  await page.getByTestId("create-invoice-partner").click()
  await page.getByRole("option").first().click()
  await page.getByTestId("create-invoice-line-description").fill(description)
  await page.getByTestId("create-invoice-line-unit-price").fill("125000")
  await expect(page.getByTestId("create-invoice-save-draft")).toBeEnabled()

  const operation = page.waitForResponse(
    (candidate) =>
      matchesOperationResponse(candidate, "create_manual_account_invoice"),
    { timeout: 30_000 },
  )
  await page.getByTestId("create-invoice-save-draft").click()
  const response = await operation
  expect(response.ok()).toBe(true)
  const params = (response.request().postDataJSON() as { params?: Row }).params
  const companyId = scalarQueryId(params?.company_id)
  const requestKey = String(params?.idempotency_key ?? "")
  if (companyId == null || !requestKey) {
    throw new Error(`${kind} request did not expose its company and idempotency key`)
  }
  const result = await page.request.get(
    `/api/accounting/manual-invoice-results/${companyId}/${requestKey}`,
  )
  expect(result.ok()).toBe(true)
  const resultBody = (await result.json()) as { data?: { id?: unknown } }
  const moveId = scalarQueryId(resultBody.data?.id)
  if (moveId == null) throw new Error(`${kind} result did not return a move id`)
  const lines = await moveLines(page, moveId)
  const evidence = balancedEvidence(lines)
  expect(evidence.lineCount).toBe(2)
  expect(evidence.difference).toBeCloseTo(0, 2)
  return { moveId, evidence }
}

test.describe("Rwanda accounting alpha rehearsal", { tag: "@rwanda-alpha" }, () => {
  test.describe.configure({ mode: "serial" })
  test.skip(
    !RUN_REHEARSAL,
    "Set E2E_RWANDA_ALPHA_REHEARSAL=1 against an isolated Rwanda rehearsal tenant.",
  )

  test("1. verifies Rwanda company, country-pack, currency, and tax-review gates", async ({
    page,
  }) => {
    const runContext = rehearsalContext()
    const companyId = await fetchDefaultCompanyId(page)
    expect(companyId, "The authenticated company must match the configured isolated rehearsal company.").toBe(
      Number(runContext.E2E_RWANDA_EXPECTED_COMPANY_ID),
    )
    const companies = await queryRows(page, "companies")
    const company = companies.find((row) => rowId(row) === companyId)
    if (!company) throw new Error(`default company ${companyId} was not found`)

    expect(
      String(optionValue(company.addressCountryCode ?? company.address_country_code) ?? "").toUpperCase(),
      "The rehearsal company must use Rwanda as its legal address country.",
    ).toBe("RW")

    const currencyId = scalarQueryId(company.currencyId ?? company.currency_id)
    const currency = (await queryRows(page, "currencies")).find(
      (row) => rowId(row) === currencyId,
    )
    expect(String(currency?.code ?? "").toUpperCase()).toBe("RWF")

    const catalogResponse = await page.request.get("/api/country-packs/catalog")
    expect(catalogResponse.ok()).toBe(true)
    const catalog = ((await catalogResponse.json()) as { data?: Row[] }).data ?? []
    const rwandaPack = catalog.find(
      (row) => String(row.packKey ?? row.pack_key).toLowerCase() === "rw",
    )
    expect(rwandaPack, "Rwanda must be discoverable in the country-pack catalog.").toBeTruthy()

    const acceptance = String(
      rwandaPack?.acceptanceStatus ?? rwandaPack?.acceptance_status ?? "",
    ).toLowerCase()
    if (REQUIRE_ACCEPTED_PACK) {
      expect(
        acceptance,
        "Legal/tax review must move the Rwanda pack to accepted before statutory certification.",
      ).toBe("accepted")
    } else {
      expect(["review_required", "accepted"]).toContain(acceptance)
    }

    const activationResponse = await page.request.get(`/api/country-packs/${companyId}`)
    expect(activationResponse.ok()).toBe(true)
    const activations = ((await activationResponse.json()) as { data?: Row[] }).data ?? []
    const activation = activations.find(
      (row) => String(row.packKey ?? row.pack_key).toLowerCase() === "rw",
    )
    if (REQUIRE_ACCEPTED_PACK) {
      expect(activation?.enabled, "The accepted Rwanda pack must be enabled for this company.").toBe(true)
    }

    await openSettingsSection(page, "organization")
    await expect(page.getByTestId("country-pack-readiness-panel")).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByTestId("country-pack-readiness-panel").getByText(/rwanda/i).first(),
    ).toBeVisible()

    await attachJson("01-rwanda-country-pack.json", {
      companyId,
      companyCountry: "RW",
      currency: "RWF",
      definition: rwandaPack,
      activation: activation ?? null,
      statutoryCertificationRequired: REQUIRE_ACCEPTED_PACK,
    })
    await attachJson("00-rwanda-rehearsal-context.json", {
      runId: runContext.E2E_RWANDA_RUN_ID,
      tenantRef: runContext.E2E_RWANDA_TENANT_REF,
      companyId,
      isolatedTenantAcknowledged: true,
      operator: {
        name: runContext.E2E_RWANDA_OPERATOR_NAME,
        email: runContext.E2E_RWANDA_OPERATOR_EMAIL,
      },
      release: {
        commit: runContext.E2E_RWANDA_RELEASE_COMMIT,
        contractVersion: runContext.E2E_RWANDA_CONTRACT_VERSION,
        moduleVersion: runContext.E2E_RWANDA_MODULE_VERSION,
      },
      migrationMode: runContext.E2E_RWANDA_MIGRATION_MODE,
      cutoverDate: runContext.E2E_RWANDA_CUTOVER_DATE,
      executedAt: new Date().toISOString(),
    })
  })

  test("2. proves chart, journals, fiscal periods, and accounting readiness", async ({ page }) => {
    const runContext = rehearsalContext()
    const companyId = await fetchDefaultCompanyId(page)
    const [accounts, journals, fiscalYears, periods] = await Promise.all([
      queryRows(page, "account-accounts"),
      queryRows(page, "account-journals"),
      queryRows(page, "fiscal-years"),
      queryRows(page, "account-periods"),
    ])

    const requirements = {
      receivable: accountByClassification(accounts, companyId, "receivable"),
      payable: accountByClassification(accounts, companyId, "payable"),
      income: accountByClassification(accounts, companyId, "income"),
      expense: accountByClassification(accounts, companyId, "expense"),
      salesJournal: journalByType(journals, companyId, "sale"),
      purchaseJournal: journalByType(journals, companyId, "purchase"),
    }
    for (const [name, value] of Object.entries(requirements)) {
      expect(value, `Missing Rwanda alpha accounting prerequisite: ${name}`).toBeTruthy()
    }
    expect(
      fiscalYears.some((row) => rowCompanyId(row) === companyId),
      "The company needs a fiscal year.",
    ).toBe(true)
    const cutoverStart = Date.parse(`${runContext.E2E_RWANDA_CUTOVER_DATE}T00:00:00Z`)
    const openPeriods = periods.filter(
      (row) => rowCompanyId(row) === companyId && enumTag(row.state) === "open",
    )
    expect(openPeriods.length, "The company needs an open accounting period.").toBeGreaterThan(0)
    const coveringPeriod = openPeriods.find((row) => {
      const from = timestampMillis(row.dateFrom ?? row.date_from)
      const to = timestampMillis(row.dateTo ?? row.date_to)
      return from != null && to != null && from <= cutoverStart && to >= cutoverStart
    })
    expect(
      coveringPeriod,
      `An open accounting period must cover cutover date ${runContext.E2E_RWANDA_CUTOVER_DATE}.`,
    ).toBeTruthy()

    await gotoModule(page, "/accounting", "accounting")
    const readiness = page.getByTestId("accounting-setup-readiness")
    await expect(readiness).toBeVisible()
    await expect(readiness.getByText(/accounting setup is ready/i)).toBeVisible()

    await attachJson("02-accounting-readiness.json", {
      companyId,
      accountIds: Object.fromEntries(
        Object.entries(requirements)
          .filter(([name]) => !name.endsWith("Journal"))
          .map(([name, row]) => [name, rowId(row!)]),
      ),
      journalIds: {
        sale: rowId(requirements.salesJournal!),
        purchase: rowId(requirements.purchaseJournal!),
      },
      fiscalYearCount: fiscalYears.filter((row) => rowCompanyId(row) === companyId).length,
      openPeriodCount: periods.filter(
        (row) => rowCompanyId(row) === companyId && enumTag(row.state) === "open",
      ).length,
      cutoverDate: runContext.E2E_RWANDA_CUTOVER_DATE,
      coveringOpenPeriodId: rowId(coveringPeriod!),
    })
  })

  test("3. creates balanced customer invoice and vendor bill drafts", async ({ page }) => {
    const invoice = await createManualDocument(
      page,
      "invoice",
      smokeName("rw-alpha-customer-invoice"),
    )
    const bill = await createManualDocument(
      page,
      "bill",
      smokeName("rw-alpha-vendor-bill"),
    )

    const moves = await queryRows(page, "account-moves")
    expect(enumTag(moves.find((row) => rowId(row) === invoice.moveId)?.moveType ?? moves.find((row) => rowId(row) === invoice.moveId)?.move_type)).toBe("outinvoice")
    expect(enumTag(moves.find((row) => rowId(row) === bill.moveId)?.moveType ?? moves.find((row) => rowId(row) === bill.moveId)?.move_type)).toBe("ininvoice")

    await attachJson("03-invoice-and-bill.json", { invoice, bill })
  })

  test("4. records a failed opening-balance import, replays it safely, then imports the correction", async ({
    page,
  }) => {
    const companyId = await fetchDefaultCompanyId(page)
    const accountType = (await queryRows(page, "account-account-types")).find(
      (row) =>
        (rowCompanyId(row) == null || rowCompanyId(row) === companyId) &&
        enumTag(row.internalGroup ?? row.internal_group) === "asset",
    )
    const userTypeId = rowId(accountType ?? {})
    if (userTypeId == null) throw new Error("No asset account type is available for the opening balance")

    const code = `RWOB${Date.now().toString().slice(-8)}`
    await gotoModule(page, "/accounting", "accounting")
    await openAccountingTab(page, "accounts")
    await page.getByRole("button", { name: /import accounts \(csv\)/i }).click()

    const invalid = openingBalanceCsv({
      code,
      name: "Rwanda alpha opening balance",
      userTypeId,
      openingDebit: 125000,
      openingCredit: 25000,
      openingBalance: 100000,
    })
    await selectCsvFile(page, "rw-opening-balance-invalid.csv", invalid)
    await expect(page.getByText("1 rows found")).toBeVisible()
    const first = await submitTrackedCsv(page, "account_account")
    expect(first.ok()).toBe(true)
    const firstReceipt = (await first.json()) as Row
    expect(firstReceipt.status).toBe("failed")
    expect(numberValue(firstReceipt, "rowsImported", "rows_imported")).toBe(0)
    expect(numberValue(firstReceipt, "errorRows", "error_rows")).toBe(1)
    expect((await queryRows(page, "account-accounts")).some((row) => row.code === code)).toBe(false)

    const replay = await replayRequest(page, first.request())
    expect(replay.ok()).toBe(true)
    const replayReceipt = (await replay.json()) as Row
    expect(String(replayReceipt.jobId ?? replayReceipt.job_id)).toBe(
      String(firstReceipt.jobId ?? firstReceipt.job_id),
    )
    expect((await queryRows(page, "account-accounts")).some((row) => row.code === code)).toBe(false)

    await page.getByRole("button", { name: /import another file/i }).click()
    const corrected = openingBalanceCsv({
      code,
      name: "Rwanda alpha opening balance",
      userTypeId,
      openingDebit: 125000,
      openingBalance: 125000,
    })
    await selectCsvFile(page, "rw-opening-balance-corrected.csv", corrected)
    const correction = await submitTrackedCsv(page, "account_account")
    expect(correction.ok()).toBe(true)
    const correctionReceipt = (await correction.json()) as Row
    expect(correctionReceipt.status).toBe("success")

    const imported = (await queryRows(page, "account-accounts")).find(
      (row) => row.code === code,
    )
    expect(imported).toBeTruthy()
    expect(numberValue(imported!, "openingDebit", "opening_debit")).toBe(125000)
    expect(numberValue(imported!, "openingCredit", "opening_credit")).toBe(0)
    expect(numberValue(imported!, "openingBalance", "opening_balance")).toBe(125000)

    await attachJson("04-opening-balance-retry.json", {
      rejected: firstReceipt,
      identicalReplay: replayReceipt,
      correction: correctionReceipt,
      importedAccount: imported,
    })
  })

  test("5. rejects an unbalanced historical journal and imports its balanced correction atomically", async ({
    page,
  }) => {
    const runContext = rehearsalContext()
    const companyId = await fetchDefaultCompanyId(page)
    const accounts = await queryRows(page, "account-accounts")
    const journals = await queryRows(page, "account-journals")
    const debitAccount = accountByClassification(accounts, companyId, "asset")
    const creditAccount = accountByClassification(accounts, companyId, "income")
    const journal =
      journalByType(journals, companyId, "general") ??
      journalByType(journals, companyId, "sale")
    const debitAccountId = rowId(debitAccount ?? {})
    const creditAccountId = rowId(creditAccount ?? {})
    const journalId = rowId(journal ?? {})
    if (debitAccountId == null || creditAccountId == null || journalId == null) {
      throw new Error("Historical journal rehearsal needs asset/income accounts and an active journal")
    }

    const reference = smokeName("rw-alpha-history")
    const input = {
      journalId,
      debitAccountId,
      creditAccountId,
      reference,
      date: runContext.E2E_RWANDA_CUTOVER_DATE,
      amount: 375000,
    }

    await gotoModule(page, "/accounting", "accounting")
    await openAccountingTab(page, "journal-entries")
    await page.getByRole("button", { name: /import entries \(csv\)/i }).click()
    await selectCsvFile(
      page,
      "rw-history-unbalanced.csv",
      historicalJournalCsv({ ...input, creditAdjustment: 1 }),
    )
    await page.getByRole("dialog").getByRole("button", { name: /^import$/i }).click()
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(/balanced/i)
    expect(
      (await queryRows(page, "account-moves")).some(
        (row) => String(row.ref ?? row.ref_) === reference,
      ),
    ).toBe(false)

    await selectCsvFile(
      page,
      "rw-history-balanced.csv",
      historicalJournalCsv(input),
    )
    const parentRequest = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/import/account_move" &&
        response.request().method() === "POST",
      { timeout: 30_000 },
    )
    const lineRequest = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/import/account_move_line" &&
        response.request().method() === "POST",
      { timeout: 30_000 },
    )
    await page.getByRole("dialog").getByRole("button", { name: /^import$/i }).click()
    const [parentResponse, lineResponse] = await Promise.all([parentRequest, lineRequest])
    expect(parentResponse.ok()).toBe(true)
    expect(lineResponse.ok()).toBe(true)
    const parentReceipt = (await parentResponse.json()) as Row
    const lineReceipt = (await lineResponse.json()) as Row
    expect(parentReceipt.status).toBe("success")
    expect(lineReceipt.status).toBe("success")

    await expect.poll(async () => {
      const matching = (await queryRows(page, "account-moves")).filter(
        (row) => String(row.ref ?? row.ref_) === reference,
      )
      return matching.length
    }, { timeout: 30_000 }).toBe(1)
    const move = (await queryRows(page, "account-moves")).find(
      (row) => String(row.ref ?? row.ref_) === reference,
    )!
    const moveId = rowId(move)
    if (moveId == null) throw new Error("Imported historical move has no id")
    const evidence = balancedEvidence(await moveLines(page, moveId))
    expect(evidence.lineCount).toBe(2)
    expect(evidence.debit).toBeCloseTo(375000, 2)
    expect(evidence.credit).toBeCloseTo(375000, 2)
    expect(evidence.difference).toBeCloseTo(0, 2)

    await attachJson("05-historical-journal.json", {
      moveId,
      reference,
      parentReceipt,
      lineReceipt,
      reconciliation: evidence,
    })
  })

  test("6. imports outstanding invoice and bill cutover documents", async ({ page }) => {
    const runContext = rehearsalContext()
    const reconstructOriginal =
      runContext.E2E_RWANDA_MIGRATION_MODE === "original_total_with_payment_replay"
    const companyId = await fetchDefaultCompanyId(page)
    const [companies, accounts, journals, contacts] = await Promise.all([
      queryRows(page, "companies"),
      queryRows(page, "account-accounts"),
      queryRows(page, "account-journals"),
      queryRows(page, "contacts"),
    ])
    const company = companies.find((row) => rowId(row) === companyId)
    const currencyId = scalarQueryId(company?.currencyId ?? company?.currency_id)
    const receivable = accountByClassification(accounts, companyId, "receivable")
    const payable = accountByClassification(accounts, companyId, "payable")
    const openingAccount =
      accountByClassification(accounts, companyId, "equity") ??
      accountByClassification(accounts, companyId, "asset")
    const saleJournal = journalByType(journals, companyId, "sale")
    const purchaseJournal = journalByType(journals, companyId, "purchase")
    const configuredCustomerId = Number(runContext.E2E_RWANDA_CUSTOMER_PARTNER_ID)
    const configuredVendorId = Number(runContext.E2E_RWANDA_SUPPLIER_PARTNER_ID)
    const customer = contacts.find((row) => rowId(row) === configuredCustomerId)
    const vendor = contacts.find((row) => rowId(row) === configuredVendorId)
    expect(
      customer?.isCustomer === true || Number(customer?.customerRank ?? customer?.customer_rank ?? 0) > 0,
      `Configured customer partner ${configuredCustomerId} must be an active customer in the rehearsal company.`,
    ).toBe(true)
    expect(
      vendor?.isVendor === true || Number(vendor?.supplierRank ?? vendor?.supplier_rank ?? 0) > 0,
      `Configured supplier partner ${configuredVendorId} must be an active vendor in the rehearsal company.`,
    ).toBe(true)
    const ids = {
      currency: currencyId,
      receivable: rowId(receivable ?? {}),
      payable: rowId(payable ?? {}),
      opening: rowId(openingAccount ?? {}),
      saleJournal: rowId(saleJournal ?? {}),
      purchaseJournal: rowId(purchaseJournal ?? {}),
      customer: rowId(customer ?? {}),
      vendor: rowId(vendor ?? {}),
    }
    for (const [name, id] of Object.entries(ids)) {
      if (id == null) throw new Error(`Outstanding-document rehearsal is missing ${name}`)
    }

    const headers = [
      "document_type", "reference", "journal_id", "partner_id",
      "counterpart_account_id", "opening_account_id", "posting_date",
      "invoice_date", "due_date", "source_total", "opening_residual",
      "currency_id", "document_number", "payment_reference", "metadata",
      ...(reconstructOriginal ? ["payment_transaction_id"] : []),
    ]
    const invoiceReference = smokeName("rw-alpha-open-invoice")
    const billReference = smokeName("rw-alpha-open-bill")
    const cutoverDate = runContext.E2E_RWANDA_CUTOVER_DATE
    const rows = [
      [
        "customer_invoice", invoiceReference, ids.saleJournal!, ids.customer!,
        ids.receivable!, ids.opening!, cutoverDate, cutoverDate, cutoverDate,
        "500000", "300000", ids.currency!, invoiceReference, invoiceReference,
        JSON.stringify({ source_row: "customer-1" }),
        ...(reconstructOriginal
          ? [runContext.E2E_RWANDA_CUSTOMER_PAYMENT_TRANSACTION_ID!]
          : []),
      ],
      [
        "vendor_bill", billReference, ids.purchaseJournal!, ids.vendor!,
        ids.payable!, ids.opening!, cutoverDate, cutoverDate, cutoverDate,
        "400000", "200000", ids.currency!, billReference, billReference,
        JSON.stringify({ source_row: "vendor-1" }),
        ...(reconstructOriginal
          ? [runContext.E2E_RWANDA_SUPPLIER_PAYMENT_TRANSACTION_ID!]
          : []),
      ],
    ].map((row) => row.map(String))
    const mapping = Object.fromEntries(headers.map((header) => [header, header]))
    const prepared = prepareOutstandingDocumentImport({
      headers,
      rows,
      mapping,
      mode: reconstructOriginal ? "reconstruct_original_total" : "cutover_open_residual",
      companyCurrencyId: ids.currency!,
    })
    expect(prepared.documentCount).toBe(2)
    expect(prepared.sourceTotal).toBe(900000)
    expect(prepared.openingResidualTotal).toBe(500000)
    expect(prepared.paymentReplayGroups).toHaveLength(reconstructOriginal ? 2 : 0)

    await gotoModule(page, "/accounting", "accounting")
    await openAccountingTab(page, "journal-entries")
    await page.getByRole("button", {
      name: reconstructOriginal
        ? /import originals for payment replay/i
        : /import outstanding invoices and bills/i,
    }).click()
    await selectCsvFile(
      page,
      reconstructOriginal
        ? "rw-original-documents-payment-replay.csv"
        : "rw-outstanding-documents.csv",
      fixtureCsv(headers, rows),
    )
    const parentRequest = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/import/account_move",
      { timeout: 30_000 },
    )
    const lineRequest = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/import/account_move_line",
      { timeout: 30_000 },
    )
    const replayResponses = reconstructOriginal
      ? new Promise<Response[]>((resolve, reject) => {
          const responses: Response[] = []
          const timeout = setTimeout(() => {
            page.off("response", onResponse)
            reject(new Error(`Timed out after ${responses.length}/${prepared.paymentReplayGroups.length} historical payment responses`))
          }, 30_000)
          const onResponse = (response: Response) => {
            if (
              new URL(response.url()).pathname !== "/api/accounting/historical-payment-allocations" ||
              response.request().method() !== "POST"
            ) return
            responses.push(response)
            if (responses.length === prepared.paymentReplayGroups.length) {
              clearTimeout(timeout)
              page.off("response", onResponse)
              resolve(responses)
            }
          }
          page.on("response", onResponse)
        })
      : Promise.resolve([])
    await page.getByRole("dialog").getByRole("button", { name: /^import$/i }).click()
    const [parentResponse, lineResponse, historicalResponses] = await Promise.all([
      parentRequest,
      lineRequest,
      replayResponses,
    ])
    expect(parentResponse.ok()).toBe(true)
    expect(lineResponse.ok()).toBe(true)
    const parentReceipt = (await parentResponse.json()) as Row
    const lineReceipt = (await lineResponse.json()) as Row
    expect(parentReceipt.status).toBe("success")
    expect(lineReceipt.status).toBe("success")
    for (const response of historicalResponses) expect(response.ok()).toBe(true)

    await expect.poll(async () => {
      const moves = await queryRows(page, "account-moves")
      return [invoiceReference, billReference].filter((reference) =>
        moves.some((row) => String(row.ref ?? row.ref_) === reference),
      ).length
    }, { timeout: 30_000 }).toBe(2)
    const moves = await queryRows(page, "account-moves")
    const imported = [invoiceReference, billReference].map((reference) =>
      moves.find((row) => String(row.ref ?? row.ref_) === reference)!,
    )
    expect(numberValue(imported[0]!, "amountTotal", "amount_total")).toBe(
      reconstructOriginal ? 500000 : 300000,
    )
    expect(numberValue(imported[0]!, "amountResidual", "amount_residual")).toBe(300000)
    expect(numberValue(imported[1]!, "amountTotal", "amount_total")).toBe(
      reconstructOriginal ? 400000 : 200000,
    )
    expect(numberValue(imported[1]!, "amountResidual", "amount_residual")).toBe(200000)
    for (const move of imported) {
      const moveId = rowId(move)
      if (moveId == null) throw new Error("Outstanding document has no move id")
      const evidence = balancedEvidence(await moveLines(page, moveId))
      expect(evidence.lineCount).toBe(2)
      expect(evidence.difference).toBeCloseTo(0, 2)
    }

    historicalReplayRuns = await Promise.all(historicalResponses.map(async (response) => {
      const requestBody = response.request().postDataJSON() as Row
      const params = requestBody.params as Row
      const paymentTransactionId = Number(
        params.payment_transaction_id ?? params.paymentTransactionId,
      )
      const documentMoveIds = ((params.allocations ?? []) as Row[]).map((allocation) =>
        Number(allocation.document_move_id ?? allocation.documentMoveId))
      const reconciliationIds = await activeReconciliationIds(page, paymentTransactionId)
      expect(reconciliationIds).toHaveLength(documentMoveIds.length)
      return {
        requestBody,
        paymentTransactionId,
        documentMoveIds,
        reconciliationIds,
        firstResponseStatus: response.status(),
        firstResponseBody: await response.json(),
      }
    }))

    await attachJson("06-outstanding-documents.json", {
      prepared: {
        mode: prepared.mode,
        documentCount: prepared.documentCount,
        sourceTotal: prepared.sourceTotal,
        sourcePaidToDateTotal: prepared.sourcePaidToDateTotal,
        openingResidualTotal: prepared.openingResidualTotal,
        bookedDocumentTotal: prepared.bookedDocumentTotal,
        paymentReplayGroupCount: prepared.paymentReplayGroups.length,
      },
      receipts: { parent: parentReceipt, lines: lineReceipt },
      historicalPaymentResponses: historicalReplayRuns.map((run) => ({
        status: run.firstResponseStatus,
        request: run.requestBody,
        body: run.firstResponseBody,
        reconciliationIds: run.reconciliationIds,
      })),
      moves: imported,
    })
  })

  test("7. fixes the historical-payment reconstruction wire contract", async () => {
    const fixture = historicalPaymentAllocationFixture({
      companyId: 11,
      paymentTransactionId: 22,
      currencyId: 33,
      documentMoveId: 44,
      sourceTotal: 500000,
      expectedOpenResidual: 300000,
    })
    expect(fixture).toEqual({
      idempotency_key: "rw-alpha-history-22-44",
      company_id: 11,
      payment_transaction_id: 22,
      currency_id: 33,
      allocations: [{
        document_move_id: 44,
        allocated_amount: 200000,
        expected_residual_after: 300000,
        completes_document_history: true,
      }],
      metadata: JSON.stringify({ source: "rwanda-alpha-rehearsal", country: "RW" }),
    })
    await attachJson("07-historical-payment-contract.json", fixture)
  })

  test("8. applies historical payments to original-total documents", async ({ page }) => {
    const runContext = rehearsalContext()
    test.skip(
      runContext.E2E_RWANDA_MIGRATION_MODE === "residual_only",
      "Residual-only cutover intentionally does not replay pre-cutover payments.",
    )
    expect(historicalReplayRuns.length, "Checkpoint 6 must call the historical-payment BFF route.").toBeGreaterThan(0)

    const idempotentReplays = []
    for (const run of historicalReplayRuns) {
      expect(await activeReconciliationIds(page, run.paymentTransactionId)).toEqual(
        run.reconciliationIds,
      )
      const response = await page.request.post("/api/accounting/historical-payment-allocations", {
        data: run.requestBody,
      })
      expect(response.ok()).toBe(true)
      const replayBody = await response.json()
      expect(replayBody).toEqual(run.firstResponseBody)
      const reconciliationIdsAfterReplay = await activeReconciliationIds(
        page,
        run.paymentTransactionId,
      )
      expect(reconciliationIdsAfterReplay).toEqual(run.reconciliationIds)
      idempotentReplays.push({
        paymentTransactionId: run.paymentTransactionId,
        documentMoveIds: run.documentMoveIds,
        status: response.status(),
        body: replayBody,
        reconciliationIdsBefore: run.reconciliationIds,
        reconciliationIdsAfter: reconciliationIdsAfterReplay,
      })
    }

    const moves = await queryRows(page, "account-moves")
    const residuals = historicalReplayRuns.flatMap((run) => run.documentMoveIds.map((moveId) => {
      const move = moves.find((row) => rowId(row) === moveId)
      if (!move) throw new Error(`Historical replay document ${moveId} was not found`)
      return {
        moveId,
        amountTotal: numberValue(move, "amountTotal", "amount_total"),
        amountResidual: numberValue(move, "amountResidual", "amount_residual"),
      }
    }))
    expect(residuals.map((row) => row.amountResidual).sort((a, b) => a - b)).toEqual([
      200000,
      300000,
    ])

    await attachJson("08-historical-payment-replay.json", {
      route: "/api/accounting/historical-payment-allocations",
      upstreamRoute: "/v1/accounting/historical-payment-allocations",
      idempotentReplays,
      residuals,
    })
  })
})
