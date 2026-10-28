import type { HumanTaskRow } from "@lumiere/query-hooks/hooks/approvals"

function positiveId(value: string | null): number | null {
  if (value == null || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export type ApprovalInboxTarget = { model: string; resId: number }

export function approvalInboxTarget(model: string | null, resId: string | null): ApprovalInboxTarget | null {
  const normalizedModel = model?.trim()
  const id = positiveId(resId)
  return normalizedModel && id != null ? { model: normalizedModel, resId: id } : null
}

export function approvalTaskMatchesTarget(row: HumanTaskRow, target: ApprovalInboxTarget): boolean {
  const model = row.subjectModel ?? row.subject_model ?? row.summary?.subjectModel ?? row.model
  const id = row.subjectId ?? row.subject_id ?? row.summary?.subjectId ?? row.resId ?? row.res_id
  return String(model ?? "") === target.model && Number(id) === target.resId
}

/** Names supported subject kinds without showing internal workflow node keys as business titles. */
export function approvalSubjectKind(model: string | undefined): "purchaseOrder" | "salesOrder" | "accountingDocument" | "payment" | "expenseReport" | "aiDraft" | "record" {
  switch (model) {
    case "purchase_order": return "purchaseOrder"
    case "sale_order": return "salesOrder"
    case "account_move": return "accountingDocument"
    case "account_payment":
    case "payment_transaction": return "payment"
    case "expense_sheet": return "expenseReport"
    case "ai_action_draft": return "aiDraft"
    default: return "record"
  }
}
