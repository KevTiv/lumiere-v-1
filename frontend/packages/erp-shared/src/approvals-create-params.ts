/**
 * Maps Approvals module payloads to SpacetimeDB Create*Params types.
 */

import type { CreateApprovalRuleParams } from "@lumiere/stdb/types"

import { optionalBigIntU64 } from "./form-coercion"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

export function toCreateApprovalRuleParams(
  formData: Record<string, unknown>,
): CreateApprovalRuleParams | null {
  const name = String(formData.name ?? "").trim()
  const model = String(formData.model ?? "").trim()
  const action = String(formData.action ?? "").trim()
  const ruleType = String(formData.ruleType ?? formData.rule_type ?? "").trim()
  const threshold = Number(formData.threshold ?? 0)
  if (!name || !model || !action || !ruleType || !Number.isFinite(threshold) || threshold <= 0) {
    return null
  }
  return {
    name,
    description: optionalTrimmedString(formData.description),
    model,
    action,
    ruleType,
    threshold,
    approverRoleId: optionalBigIntU64(formData.approverRoleId ?? formData.approver_role_id),
    sequence: Math.max(0, Math.trunc(Number(formData.sequence ?? 10))),
    isActive: formData.isActive !== false,
    metadata: optionalTrimmedString(formData.metadata),
  }
}
