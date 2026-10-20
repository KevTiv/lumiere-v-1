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
