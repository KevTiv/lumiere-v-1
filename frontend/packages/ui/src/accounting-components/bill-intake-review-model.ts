import type { AccountMove } from "../lib/accounting-types"
import { stbEnumTag } from "../lib/accounting-move-utils"
import { kpiDate } from "../lib/kpi-tiles"
import { worklistId } from "./accounting-worklist-model"

export type BillIntakeIssue = "supplier" | "reference" | "invoice-date" | "lines" | "line-values" | "balance" | "total"
export interface BillIntakeItem { bill: AccountMove; issues: BillIntakeIssue[]; lineCount: number }
export interface BillIntakeReviewModel { available: boolean; items: BillIntakeItem[] }

/** Canonical parent/line joins only; incomplete scope must never become an empty, healthy queue. */
export function billIntakeReview(args: {
  organizationId: bigint | number | string
  companyId: bigint | number | string
  bills: readonly AccountMove[]
  lines: readonly Record<string, unknown>[]
}): BillIntakeReviewModel {
  const org = worklistId(args.organizationId)
  const company = worklistId(args.companyId)
  const unavailable: BillIntakeReviewModel = { available: false, items: [] }
  if (!org || !company) return unavailable
  const ids = new Set<string>()
  const draftBills: AccountMove[] = []
  for (const bill of args.bills) {
    if (!worklistId(bill.organizationId) || !worklistId(bill.companyId)) return unavailable
    if (worklistId(bill.organizationId) !== org || worklistId(bill.companyId) !== company) continue
    const id = worklistId(bill.id)
    if (!id || ids.has(id)) return unavailable
    ids.add(id)
    const type = stbEnumTag(bill.moveType).replaceAll("_", "").toLowerCase()
    if (!["ininvoice", "inrefund"].includes(type)) continue
    const state = stbEnumTag(bill.state).toLowerCase()
    if (!["draft", "posted", "cancelled", "cancel"].includes(state)) return unavailable
    if (state === "draft") draftBills.push(bill)
  }
  const linesByMove = new Map<string, Record<string, unknown>[]>()
  const lineIds = new Set<string>()
  for (const line of args.lines) {
    const lineOrg = worklistId(line.organizationId ?? line.organization_id)
    const lineCompany = worklistId(line.companyId ?? line.company_id)
    if (!lineOrg || !lineCompany) return unavailable
    if (lineOrg !== org || lineCompany !== company) continue
    const moveId = worklistId(line.moveId ?? line.move_id)
    const id = worklistId(line.id)
    if (!moveId || !id || lineIds.has(id)) return unavailable
    lineIds.add(id)
    const entries = linesByMove.get(moveId) ?? []
    entries.push(line)
    linesByMove.set(moveId, entries)
  }

  const items = draftBills.map((bill): BillIntakeItem => {
    const issues: BillIntakeIssue[] = []
    if (!worklistId(bill.partnerId)) issues.push("supplier")
    const supplierReference = bill.ref ?? (bill as AccountMove & { ref_?: unknown }).ref_
    if (typeof supplierReference !== "string" || !supplierReference.trim()) issues.push("reference")
    const invoiceDate = kpiDate(bill.invoiceDate)
    if (!invoiceDate || !Number.isFinite(invoiceDate.getTime())) issues.push("invoice-date")
    const lines = linesByMove.get(String(bill.id)) ?? []
    if (!lines.length) issues.push("lines")
    let debit = 0
    let credit = 0
    let invalidLines = false
    for (const line of lines) {
      if (!worklistId(line.accountId ?? line.account_id) ||
        typeof line.debit !== "number" || !Number.isFinite(line.debit) || line.debit < 0 ||
        typeof line.credit !== "number" || !Number.isFinite(line.credit) || line.credit < 0 ||
        (line.debit > 0 && line.credit > 0)) {
        invalidLines = true
        continue
      }
      debit += line.debit
      credit += line.credit
    }
    if (invalidLines) issues.push("line-values")
    else if (lines.length && (!Number.isFinite(debit) || !Number.isFinite(credit) || Math.abs(debit - credit) > 0.005)) issues.push("balance")
    if (typeof bill.amountTotal !== "number" || !Number.isFinite(bill.amountTotal) || bill.amountTotal <= 0) issues.push("total")
    return { bill, issues, lineCount: lines.length }
  })
  return { available: true, items: items.sort((a, b) => b.issues.length - a.issues.length) }
}
