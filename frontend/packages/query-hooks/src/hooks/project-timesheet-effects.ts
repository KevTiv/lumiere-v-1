import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type TimesheetEffectProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly validationStatus?: unknown
  readonly validation_status?: unknown
  readonly timesheetInvoiceId?: unknown
  readonly timesheet_invoice_id?: unknown
}

export type TimesheetValidationStatus = "draft" | "validated" | "rejected"

function exactTimesheet(
  rows: readonly TimesheetEffectProjection[],
  organizationId: bigint,
  companyId: bigint | null | undefined,
  id: bigint,
): TimesheetEffectProjection | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === id)
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one timesheet ${id}, found ${matches.length}`)
  }
  const row = matches[0]
  if (!row) return null
  if (parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId) return null
  if (companyId != null && parseStrictU64(row.companyId ?? row.company_id) !== companyId) return null
  return row
}

/**
 * COV-10: every requested timesheet id resolves to exactly one row in the same organization
 * (and company when given) whose `validation_status` is the expected one. All-or-nothing: a
 * batch where any id is missing, out of scope or in another status is no effect. Requires
 * `validation_status` in the `timesheets` projection.
 */
export function resolveTimesheetStatusEffects(
  rows: readonly TimesheetEffectProjection[],
  organizationId: bigint,
  companyId: bigint | null | undefined,
  ids: readonly bigint[],
  expected: TimesheetValidationStatus,
): CanonicalRecordRef[] | null {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return null
  const refs: CanonicalRecordRef[] = []
  for (const id of unique) {
    const row = exactTimesheet(rows, organizationId, companyId, id)
    if (!row || String(row.validationStatus ?? row.validation_status ?? "") !== expected) return null
    refs.push({ resource: "timesheets", id: id.toString() })
  }
  return refs
}

/**
 * COV-10 billing handoff: every billed timesheet carries a `timesheet_invoice_id` and they all
 * point at the same invoice (one `bill_timesheets` call creates one invoice). Returns that
 * invoice id, or `null` when any timesheet is unbilled or the batch is split.
 */
export function resolveTimesheetBillingEffect(
  rows: readonly TimesheetEffectProjection[],
  organizationId: bigint,
  companyId: bigint | null | undefined,
  ids: readonly bigint[],
): bigint | null {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return null
  let invoiceId: bigint | null = null
  for (const id of unique) {
    const row = exactTimesheet(rows, organizationId, companyId, id)
    const linked = row ? parseStrictU64(row.timesheetInvoiceId ?? row.timesheet_invoice_id) : undefined
    if (linked == null || linked === 0n) return null
    if (invoiceId != null && invoiceId !== linked) return null
    invoiceId = linked
  }
  return invoiceId
}
