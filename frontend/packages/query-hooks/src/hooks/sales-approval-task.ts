import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import type { HumanTaskRow } from "./approvals"
import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

type Scope = { organizationId: bigint; companyId: bigint }

function tag(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    if ("tag" in value && typeof value.tag === "string") return value.tag
    const keys = Object.keys(value)
    if (keys.length === 1) return keys[0]!
  }
  return ""
}

function subjectModel(row: HumanTaskRow): string {
  return String(row.subjectModel ?? row.subject_model ?? row.summary?.subjectModel ?? row.model ?? "")
}

function subjectId(row: HumanTaskRow): bigint | null {
  return parseStrictU64(
    row.subjectId ?? row.subject_id ?? row.summary?.subjectId ?? row.resId ?? row.res_id,
  ) ?? null
}

export interface SaleOrderApprovalTaskRef extends CanonicalRecordRef {
  readonly resource: "workflow-human-tasks"
  readonly href: string
  readonly row: HumanTaskRow
}

/**
 * Resolve the one active human task guarding a sale order. Subject, tenant and
 * company are all required; duplicate active tasks are an invariant failure.
 */
export function resolveSaleOrderApprovalTask(
  rows: readonly HumanTaskRow[],
  scope: Scope,
  orderId: bigint,
): SaleOrderApprovalTaskRef | null {
  const matches = rows.filter((row) => {
    const status = tag(row.status)
    return (
      (status === "Open" || status === "Claimed") &&
      subjectModel(row) === "sale_order" &&
      subjectId(row) === orderId &&
      parseStrictU64(row.organizationId ?? row.organization_id) === scope.organizationId &&
      parseStrictU64(row.companyId ?? row.company_id) === scope.companyId
    )
  })
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one active approval task for sale order ${orderId}, found ${matches.length}`,
    )
  }
  const row = matches[0]
  if (!row) return null
  const id = parseStrictU64(row.id)
  if (id == null || id === 0n) throw new Error("Sale-order approval task has no canonical ID")
  return {
    resource: "workflow-human-tasks",
    id: id.toString(),
    href: `/approvals?taskId=${encodeURIComponent(id.toString())}`,
    row,
  }
}
