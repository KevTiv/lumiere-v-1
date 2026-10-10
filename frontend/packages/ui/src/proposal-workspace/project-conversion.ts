export const PROJECT_BILL_TYPES = ["customer_task", "customer_project", "no"] as const
export const PROJECT_PRICING_TYPES = ["task_rate", "fixed_rate", "employee_rate"] as const

export interface ProjectConversionInput {
  billType: (typeof PROJECT_BILL_TYPES)[number]
  pricingType: (typeof PROJECT_PRICING_TYPES)[number]
}

function unwrapSome(value: unknown): unknown {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    if ("some" in value) return (value as { some: unknown }).some
    if ("none" in value && Object.keys(value).length === 1) return null
  }
  return value
}

function statusTag(value: unknown): string {
  const v = unwrapSome(value)
  if (v != null && typeof v === "object") {
    const tag = (v as { tag?: unknown }).tag
    if (typeof tag === "string") return tag
    const keys = Object.keys(v)
    if (keys.length === 1) return keys[0]!
  }
  return v == null ? "" : String(v)
}

/**
 * `convert_proposal_to_project` only accepts an Awarded proposal that has no project yet. The
 * proposal row is the source of truth (the reducer re-checks); an unknown row is never convertible.
 */
export function canConvertProposalToProject(
  proposal: Record<string, unknown> | null | undefined,
): boolean {
  if (proposal == null) return false
  if (statusTag(proposal.status).toLowerCase() !== "awarded") return false
  const projectId = unwrapSome(proposal.projectId ?? proposal.project_id)
  return projectId == null
}

/** The reducer validates both values against fixed lists; a cancelled dialog or unknown choice is null. */
export function parseProjectConversionInput(
  values: Record<string, unknown> | null | undefined,
): ProjectConversionInput | null {
  if (values == null) return null
  const billType = String(values.billType ?? "").trim()
  const pricingType = String(values.pricingType ?? "").trim()
  if (!(PROJECT_BILL_TYPES as readonly string[]).includes(billType)) return null
  if (!(PROJECT_PRICING_TYPES as readonly string[]).includes(pricingType)) return null
  return { billType, pricingType } as ProjectConversionInput
}
