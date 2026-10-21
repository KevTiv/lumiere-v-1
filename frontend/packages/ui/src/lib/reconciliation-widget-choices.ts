import { parseStrictU64 } from "@lumiere/erp-shared/u64"

export interface ReconciliationScope {
  organizationId: string
  companyId: string
}

export interface ReconciliationAccountRow {
  id: unknown
  organizationId?: unknown
  companyId?: unknown
  code?: unknown
  name?: unknown
  deprecated?: unknown
}

export interface ReconciliationPartnerRow {
  id: unknown
  organizationId?: unknown
  companyId?: unknown
  name?: unknown
  displayName?: unknown
  isActive?: unknown
}

export interface ReconciliationMoveLineRow {
  id: unknown
  organizationId?: unknown
  companyId?: unknown
  accountId?: unknown
  partnerId?: unknown
  moveId?: unknown
  moveName?: unknown
  name?: unknown
  debit?: unknown
  credit?: unknown
}

export interface ReconciliationSelection {
  accountId?: unknown
  partnerId?: unknown
  moveLineIds?: unknown
  mode?: unknown
}

export function reconciliationId(value: unknown): string | null {
  if (!/^[1-9]\d*$/.test(String(value ?? ""))) return null
  const parsed = parseStrictU64(value)
  return parsed != null && parsed > 0n ? String(parsed) : null
}

function uniqueRows<Row extends { id: unknown }>(rows: readonly Row[]): Row[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const id = reconciliationId(row.id)
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return rows.filter((row) => counts.get(reconciliationId(row.id) ?? "") === 1)
}

function inScope(row: { organizationId?: unknown; companyId?: unknown }, scope: ReconciliationScope): boolean {
  return reconciliationId(scope.organizationId) !== null && reconciliationId(scope.companyId) !== null
    && reconciliationId(row.organizationId) === scope.organizationId
    && reconciliationId(row.companyId) === scope.companyId
}

export function reconciliationAccountChoices(rows: readonly ReconciliationAccountRow[], scope: ReconciliationScope) {
  return uniqueRows(rows.filter((row) => inScope(row, scope) && row.deprecated !== true))
    .map((row) => ({ value: String(row.id), label: [row.code, row.name].filter(Boolean).join(" — ") || `#${String(row.id)}` }))
}

export function reconciliationPartnerChoices(rows: readonly ReconciliationPartnerRow[], scope: ReconciliationScope) {
  return uniqueRows(rows.filter((row) =>
    reconciliationId(scope.companyId) !== null && reconciliationId(scope.organizationId) !== null
    && reconciliationId(row.organizationId) === scope.organizationId
    && (row.companyId == null || reconciliationId(row.companyId) === scope.companyId)
    && row.isActive !== false,
  )).map((row) => ({ value: String(row.id), label: String(row.displayName ?? row.name ?? `#${String(row.id)}`) }))
}

/** Match the chosen account/partner and current company exactly; never choose by amounts or labels. */
export function reconciliationMoveLineChoices(
  rows: readonly ReconciliationMoveLineRow[], scope: ReconciliationScope, selection: ReconciliationSelection,
): ReconciliationMoveLineRow[] {
  const accountId = reconciliationId(selection.accountId)
  const partnerId = selection.partnerId == null || selection.partnerId === "" ? null : reconciliationId(selection.partnerId)
  if (!accountId || (selection.partnerId != null && selection.partnerId !== "" && !partnerId)) return []
  return uniqueRows(rows.filter((row) => inScope(row, scope)
    && reconciliationId(row.accountId) === accountId
    && (partnerId === null || reconciliationId(row.partnerId) === partnerId)))
}

export function reconciliationSelectedIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []
}

export type ReconciliationSelectionIssue = "loading" | "account" | "partner" | "lines" | "staleLines" | "mode"

export function reconciliationSelectionIssue(
  selection: ReconciliationSelection,
  context: ReconciliationScope & {
    ready: boolean
    accounts: readonly ReconciliationAccountRow[]
    partners: readonly ReconciliationPartnerRow[]
    lines: readonly ReconciliationMoveLineRow[]
    existingMode?: string
    /** Only the exact existing-widget edit path may clear its journal item set. */
    allowEmpty?: boolean
  },
): ReconciliationSelectionIssue | null {
  if (!context.ready) return "loading"
  if (!reconciliationAccountChoices(context.accounts, context).some((option) => option.value === selection.accountId)) return "account"
  if (selection.partnerId != null && selection.partnerId !== ""
    && !reconciliationPartnerChoices(context.partners, context).some((option) => option.value === selection.partnerId)) return "partner"
  const selected = reconciliationSelectedIds(selection.moveLineIds)
  if (!Array.isArray(selection.moveLineIds) || selected.length !== selection.moveLineIds.length
    || (!context.allowEmpty && selected.length === 0) || new Set(selected).size !== selected.length || selected.some((id) => reconciliationId(id) === null)) return "lines"
  const choices = new Set(reconciliationMoveLineChoices(context.lines, context, selection).map((line) => String(line.id)))
  if (selected.some((id) => !choices.has(id))) return "staleLines"
  if (selection.mode !== "bank" && selection.mode !== "manual"
    && (!context.existingMode || selection.mode !== context.existingMode)) return "mode"
  return null
}
