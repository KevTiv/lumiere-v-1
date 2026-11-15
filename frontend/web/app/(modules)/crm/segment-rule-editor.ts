import { nullableBigIntU64, unwrapSome } from "@lumiere/erp-shared/form-coercion"
import type { SegmentRuleField, SegmentRuleOp, SetContactSegmentRulesParams } from "@lumiere/stdb/types"
import type { EntityRow } from "@lumiere/ui/lib/entity-view-types"

type Field = SegmentRuleField["tag"]
type Operator = SegmentRuleOp["tag"]

export const maxSegmentRules = 16
export const segmentOperators = {
  CountryCode: ["Eq", "Neq", "Contains"],
  City: ["Eq", "Neq", "Contains"],
  Industry: ["Eq", "Neq", "Contains"],
  IsCustomer: ["IsTrue", "IsFalse"],
  IsProspect: ["IsTrue", "IsFalse"],
  IsVendor: ["IsTrue", "IsFalse"],
  TagId: ["Eq", "Neq"],
} as const satisfies Record<Field, readonly Operator[]>

export interface SegmentRuleDraft {
  field: Field
  operator: Operator
  value: string
}

export function segmentRuleNeedsValue(field: Field) {
  return !field.startsWith("Is")
}

function enumName(value: unknown) {
  return String(value != null && typeof value === "object" && "tag" in value ? value.tag : value ?? "")
}

export function savedSegmentRules(rows: readonly EntityRow[], segmentId: bigint) {
  const rowSegment = (row: EntityRow) => nullableBigIntU64(row.segmentId ?? row.segment_id)
  const selected = rows
    .filter((row) => rowSegment(row) === segmentId)
    .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0))
  const drafts = selected.map((row): SegmentRuleDraft | null => {
    const field = enumName(row.field) as Field
    const operator = enumName(row.op) as Operator
    const operators = Object.hasOwn(segmentOperators, field) ? segmentOperators[field] as readonly Operator[] : []
    if (!operators.includes(operator)) return null
    const raw = field === "TagId" ? row.valueId ?? row.value_id : row.valueText ?? row.value_text
    return { field, operator, value: segmentRuleNeedsValue(field) ? String(unwrapSome(raw) ?? "") : "" }
  })
  const metadata = selected.map((row) => {
    const value = unwrapSome(row.metadata)
    return value != null && typeof value === "object" && "none" in value ? null : value ?? null
  })
  const shared = metadata[0] ?? null
  const fingerprint = JSON.stringify(selected.map((row, index) => [String(row.id), drafts[index], metadata[index]]))
  return {
    rules: drafts.flatMap((rule) => rule ? [rule] : []),
    fingerprint,
    metadata: typeof shared === "string" ? shared : undefined,
    canEdit: rows.every((row) => rowSegment(row) != null) &&
      drafts.every((rule) => rule != null) &&
      (typeof shared === "string" || shared == null) &&
      metadata.every((value) => value === shared),
  }
}

export function segmentRuleReplacement(
  drafts: readonly SegmentRuleDraft[],
  metadata?: string,
): SetContactSegmentRulesParams | null {
  if (drafts.length > maxSegmentRules) return null
  const rules: SetContactSegmentRulesParams["rules"] = []
  for (const draft of drafts) {
    if (!(segmentOperators[draft.field] as readonly Operator[]).includes(draft.operator)) return null
    const valueId = draft.field === "TagId" ? nullableBigIntU64(draft.value) : null
    const valueText = draft.field !== "TagId" && segmentRuleNeedsValue(draft.field) ? draft.value : undefined
    if ((draft.field === "TagId" && !valueId) || (valueText !== undefined && !valueText.trim())) return null
    rules.push({ field: { tag: draft.field }, op: { tag: draft.operator }, valueText, valueId: valueId ?? undefined })
  }
  return { replaceAll: true, rules, metadata }
}
