import { expect, test, type Page } from "@playwright/test"

import { callReducerBff, fetchSessionOrganizationId, smokeName } from "./helpers"

type QueryRow = Record<string, unknown>

const none = { none: [] as [] }
const some = <T>(value: T) => ({ some: value })

function valueOf(value: unknown): unknown {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    const row = value as QueryRow
    if ("some" in row) return valueOf(row.some)
    if ("none" in row) return undefined
  }
  return value
}

function field(row: QueryRow, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in row) return valueOf(row[key])
  }
  return undefined
}

function idOf(value: unknown): number | null {
  const raw = valueOf(value)
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function timestamp(isoDate: string): { __timestamp_micros_since_unix_epoch__: number } {
  return { __timestamp_micros_since_unix_epoch__: new Date(isoDate).getTime() * 1_000 }
}

async function queryRows(page: Page, resource: string): Promise<QueryRow[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok(), `${resource} query failed with ${response.status()}`).toBe(true)
  const body = (await response.json()) as { data?: unknown[] }
  return (body.data ?? []).filter((row): row is QueryRow => row != null && typeof row === "object" && !Array.isArray(row))
}

async function fetchStatementScope(page: Page): Promise<{ companyId: number; journalId: number; currencyId: number }> {
  const accounts = await queryRows(page, "payment-accounts")
  const wallet = accounts.find((row) => String(field(row, "name")) === "MTN Main Wallet") ?? accounts[0]
  const companyId = idOf(field(wallet ?? {}, "companyId", "company_id"))
  const journalId = idOf(field(wallet ?? {}, "accountJournalId", "account_journal_id"))
  const currencyId = idOf(field(wallet ?? {}, "currencyId", "currency_id"))
  if (companyId == null || journalId == null || currencyId == null) {
    throw new Error("a seeded payment account with company, journal, and currency is required")
  }
  return { companyId, journalId, currencyId }
}

async function importWorkspace(page: Page, companyId: number): Promise<{ imports: QueryRow[]; lines: QueryRow[] }> {
  const response = await page.request.get(`/api/accounting/bank-statement-imports/${companyId}`)
  expect(response.ok(), `statement-import workspace failed with ${response.status()}`).toBe(true)
  const body = (await response.json()) as { imports?: QueryRow[]; lines?: QueryRow[] }
  return { imports: body.imports ?? [], lines: body.lines ?? [] }
}

test.describe("Bank statement CSV staging", { tag: ["@phase-1", "@accounting"] }, () => {
  test("keeps invalid rows visible, ignores an identical retry, and approves a valid batch", async ({ page }) => {
    test.setTimeout(120_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const scope = await fetchStatementScope(page)
    const marker = smokeName("statement-import")
    const invalidKey = `${marker}-invalid`
    const validKey = `${marker}-valid`

    const stage = async (idempotencyKey: string, rows: unknown[]) => callReducerBff(page, "stage_bank_statement_import", [
      organizationId,
      scope.companyId,
      scope.journalId,
      scope.currencyId,
      { file_name: some(`${idempotencyKey}.csv`), idempotency_key: idempotencyKey, opening_balance: 0, rows },
    ])

    await stage(invalidKey, [{ row_number: 2, date: none, amount: some(35), reference: none, description: some("Missing date") }])
    await stage(invalidKey, [{ row_number: 2, date: none, amount: some(35), reference: none, description: some("Missing date") }])

    await expect.poll(async () => {
      const workspace = await importWorkspace(page, scope.companyId)
      return workspace.imports.filter((row) => String(field(row, "idempotencyKey", "idempotency_key")) === invalidKey).length
    }, { timeout: 30_000 }).toBe(1)
    const invalidWorkspace = await importWorkspace(page, scope.companyId)
    const invalidImport = invalidWorkspace.imports.find((row) => String(field(row, "idempotencyKey", "idempotency_key")) === invalidKey)
    expect(field(invalidImport ?? {}, "state")).toBe("needs_review")
    expect(idOf(field(invalidImport ?? {}, "invalidRows", "invalid_rows"))).toBe(1)

    await stage(validKey, [{ row_number: 2, date: some(timestamp("2026-07-01T00:00:00.000Z")), amount: some(125.5), reference: some(marker), description: some("Customer transfer") }])
    let validImport: QueryRow | undefined
    await expect.poll(async () => {
      const workspace = await importWorkspace(page, scope.companyId)
      validImport = workspace.imports.find((row) => String(field(row, "idempotencyKey", "idempotency_key")) === validKey)
      return idOf(field(validImport ?? {}, "id")) ?? 0
    }, { timeout: 30_000 }).toBeGreaterThan(0)
    const importId = idOf(field(validImport ?? {}, "id"))
    if (importId == null) throw new Error("staged valid import has no ID")

    await callReducerBff(page, "approve_bank_statement_import", [organizationId, importId])
    await callReducerBff(page, "approve_bank_statement_import", [organizationId, importId])

    await expect.poll(async () => {
      const workspace = await importWorkspace(page, scope.companyId)
      const approved = workspace.imports.find((row) => idOf(field(row, "id")) === importId)
      return idOf(field(approved ?? {}, "approvedStatementId", "approved_statement_id")) ?? 0
    }, { timeout: 30_000 }).toBeGreaterThan(0)
    const approvedWorkspace = await importWorkspace(page, scope.companyId)
    const approvedLines = approvedWorkspace.lines.filter((line) => idOf(field(line, "importId", "import_id")) === importId)
    expect(approvedLines).toHaveLength(1)
    expect(idOf(field(approvedLines[0], "createdStatementLineId", "created_statement_line_id"))).toBeGreaterThan(0)
  })
})
