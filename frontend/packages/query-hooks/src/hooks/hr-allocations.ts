/**
 * Pure read-side helpers for HR leave allocations, offboarding checklists and statutory IDs.
 *
 * Rows are accessed through tolerant getters (camelCase / snake_case) so the code works with
 * both old and new generated contracts. PII rule: the statutory identifier `value` is only
 * ever exposed through `maskStatutoryValue`; no helper here returns or serialises the raw value.
 */

export type HrRow = Record<string, unknown>

function pick(row: HrRow, ...keys: string[]): unknown {
  for (const key of keys) {
    const v = row[key]
    if (v !== undefined && v !== null && v !== "") return v
  }
  return undefined
}

function pickText(row: HrRow, ...keys: string[]): string | undefined {
  const v = pick(row, ...keys)
  if (v === undefined || typeof v === "object") return undefined
  return String(v)
}

function pickNumber(row: HrRow, ...keys: string[]): number | undefined {
  const v = pick(row, ...keys)
  if (v === undefined || typeof v === "boolean") return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function pickBool(row: HrRow, ...keys: string[]): boolean {
  const v = pick(row, ...keys)
  return v === true || v === 1 || v === "true" || v === "1"
}

export function hrRowEmployeeId(row: HrRow): string | undefined {
  return pickText(row, "employeeId", "employee_id")
}

// ── Allocations ──────────────────────────────────────────────────────────────

/** Remaining = allocated - used (2dp). Undefined when allocated is not a number; unused counts as 0. */
export function allocationRemainingDays(allocated: unknown, used: unknown): number | undefined {
  if (allocated === undefined || allocated === null || allocated === "") return undefined
  const a = Number(allocated)
  if (!Number.isFinite(a)) return undefined
  const uRaw = used === undefined || used === null || used === "" ? 0 : Number(used)
  const u = Number.isFinite(uRaw) ? uRaw : 0
  return Math.round((a - u) * 100) / 100
}

/** Accepts ISO strings, Date, epoch ms/us numbers and `{ microsSinceUnixEpoch }` shapes; returns YYYY-MM-DD. */
export function formatHrDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  let ms: number | undefined
  if (value instanceof Date) ms = value.getTime()
  else if (typeof value === "number" || typeof value === "bigint") {
    const n = Number(value)
    ms = n > 1e14 ? n / 1000 : n
  } else if (typeof value === "string") {
    ms = Date.parse(value)
  } else if (typeof value === "object") {
    const o = value as HrRow
    const micros = pick(o, "microsSinceUnixEpoch", "__timestamp_micros_since_unix_epoch__")
    if (micros !== undefined) ms = Number(micros) / 1000
  }
  if (ms === undefined || !Number.isFinite(ms)) return undefined
  return new Date(ms).toISOString().slice(0, 10)
}

export interface AllocationDisplayRow {
  id: string
  employeeId?: string
  employeeName?: string
  leaveTypeId?: string
  leaveTypeName?: string
  periodYear?: number
  allocatedDays?: number
  usedDays?: number
  remainingDays?: number
  validFrom?: string
  validTo?: string
  state?: string
}

function nameIndex(rows: readonly HrRow[], ...nameKeys: string[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of rows) {
    const id = pickText(r, "id")
    const name = pickText(r, ...nameKeys)
    if (id !== undefined && name !== undefined) m.set(id, name)
  }
  return m
}

export function mapAllocationRows(
  allocations: readonly HrRow[],
  employees: readonly HrRow[],
  leaveTypes: readonly HrRow[],
): AllocationDisplayRow[] {
  const empNames = nameIndex(employees, "name", "workEmail", "work_email")
  const typeNames = nameIndex(leaveTypes, "name", "displayName", "display_name", "code")
  return allocations.map((r) => {
    const employeeId = hrRowEmployeeId(r)
    const leaveTypeId = pickText(r, "leaveTypeId", "leave_type_id")
    const allocatedDays = pickNumber(r, "allocatedDays", "allocated_days")
    const usedDays = pickNumber(r, "usedDays", "used_days")
    return {
      id: String(pick(r, "id") ?? ""),
      employeeId,
      employeeName: employeeId !== undefined ? empNames.get(employeeId) : undefined,
      leaveTypeId,
      leaveTypeName: leaveTypeId !== undefined ? typeNames.get(leaveTypeId) : undefined,
      periodYear: pickNumber(r, "periodYear", "period_year"),
      allocatedDays,
      usedDays,
      remainingDays: allocationRemainingDays(allocatedDays, usedDays),
      validFrom: formatHrDate(pick(r, "validFrom", "valid_from", "dateFrom", "date_from")),
      validTo: formatHrDate(pick(r, "validTo", "valid_to", "dateTo", "date_to")),
      state: pickText(r, "state", "status"),
    }
  })
}

/** Optional columns are shown only when at least one row actually carries them. */
export function allocationOptionalColumns(
  rows: readonly AllocationDisplayRow[],
): { validity: boolean; state: boolean; period: boolean } {
  return {
    validity: rows.some((r) => r.validFrom !== undefined || r.validTo !== undefined),
    state: rows.some((r) => r.state !== undefined),
    period: rows.some((r) => r.periodYear !== undefined),
  }
}

// ── Offboarding ──────────────────────────────────────────────────────────────

export type OffboardingItemKey = "assetsReturned" | "accessRevoked" | "docsCollected"

export interface OffboardingItem {
  key: OffboardingItemKey
  done: boolean
  notes?: string
}

export interface OffboardingView {
  id: string
  status?: string
  items: OffboardingItem[]
  doneCount: number
  total: number
  complete: boolean
}

export function offboardingForEmployee(
  rows: readonly HrRow[],
  employeeId: string | number,
): OffboardingView | undefined {
  const target = String(employeeId)
  const matches = rows.filter((r) => hrRowEmployeeId(r) === target)
  if (matches.length === 0) return undefined
  // Latest checklist wins (highest id; ids are not ordered but one active checklist per employee is expected).
  const row = matches.reduce((a, b) => (Number(pick(b, "id") ?? 0) > Number(pick(a, "id") ?? 0) ? b : a))
  const items: OffboardingItem[] = [
    { key: "assetsReturned", done: pickBool(row, "assetsReturned", "assets_returned"), notes: pickText(row, "assetsNotes", "assets_notes") },
    { key: "accessRevoked", done: pickBool(row, "accessRevoked", "access_revoked"), notes: pickText(row, "accessNotes", "access_notes") },
    { key: "docsCollected", done: pickBool(row, "docsCollected", "docs_collected"), notes: pickText(row, "docsNotes", "docs_notes") },
  ]
  const doneCount = items.filter((i) => i.done).length
  const status = pickText(row, "status")
  return {
    id: String(pick(row, "id") ?? ""),
    status,
    items,
    doneCount,
    total: items.length,
    complete: status === "complete" || doneCount === items.length,
  }
}

// ── Statutory IDs ────────────────────────────────────────────────────────────

/**
 * Masks an identifier to its last 4 characters ("••••1234"). Values of 4 or fewer characters are
 * fully masked ("••••") so a short id is never revealed. Returns undefined when no value is present
 * (the server omits it without view_statutory_id) so the UI shows nothing.
 */
export function maskStatutoryValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const compact = String(value).replace(/\s+/g, "")
  if (compact === "") return undefined
  if (compact.length <= 4) return "••••"
  return `••••${compact.slice(-4)}`
}

export interface StatutoryIdDisplayRow {
  id: string
  employeeId?: string
  idKind?: string
  country?: string
  issueDate?: string
  expiryDate?: string
  /** Masked (last 4) — the raw value is never copied into this object. */
  maskedValue?: string
}

function parseMetadata(row: HrRow): HrRow {
  const raw = pick(row, "metadata")
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as HrRow
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as HrRow
    } catch {
      /* not JSON — ignore */
    }
  }
  return {}
}

export function mapStatutoryIdRow(row: HrRow): StatutoryIdDisplayRow {
  const meta = parseMetadata(row)
  const both = (...keys: string[]) => pick(row, ...keys) ?? pick(meta, ...keys)
  const country = both("country", "countryCode", "country_code", "issuingCountry", "issuing_country")
  return {
    id: String(pick(row, "id") ?? ""),
    employeeId: hrRowEmployeeId(row),
    idKind: pickText(row, "idKind", "id_kind"),
    country: typeof country === "object" || country === undefined ? undefined : String(country),
    issueDate: formatHrDate(both("issueDate", "issue_date", "issuedAt", "issued_at", "issuedOn", "issued_on")),
    expiryDate: formatHrDate(both("expiryDate", "expiry_date", "expiresAt", "expires_at", "validTo", "valid_to")),
    maskedValue: maskStatutoryValue(pick(row, "value")),
  }
}

export function statutoryIdsForEmployee(
  rows: readonly HrRow[],
  employeeId: string | number,
): StatutoryIdDisplayRow[] {
  const target = String(employeeId)
  return rows.filter((r) => hrRowEmployeeId(r) === target).map(mapStatutoryIdRow)
}
