import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import {
  AmbiguousOperationEffectError,
  type CanonicalRecordRef,
} from "./operation-effect"

type Row = Record<string, unknown>

function optionValue(value: unknown): { present: boolean; value?: unknown } {
  if (value == null) return { present: false }
  if (typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    if ("none" in object || object.tag === "none") return { present: false }
    if ("some" in object) return { present: true, value: object.some }
    if (object.tag === "some") return { present: true, value: object.value }
  }
  return { present: true, value }
}

function exactRow(rows: readonly Row[], organizationId: bigint, id: bigint): Row | null {
  const matches = rows.filter(
    (row) =>
      parseStrictU64(row.id) === id &&
      parseStrictU64(row.organizationId ?? row.organization_id) === organizationId,
  )
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one record ${id}, found ${matches.length}`)
  }
  return matches[0] ?? null
}

function sameScalar(actual: unknown, expected: unknown): boolean {
  const left = optionValue(actual)
  const right = optionValue(expected)
  if (!right.present) return true
  if (!left.present) return false
  return String(left.value ?? "") === String(right.value ?? "")
}

/** Resolve an update only when the exact category reads back every requested field. */
export function resolveKnowledgeCategoryUpdateEffect(
  rows: readonly Row[],
  organizationId: bigint,
  categoryId: bigint,
  params: Row,
): CanonicalRecordRef | null {
  const row = exactRow(rows, organizationId, categoryId)
  if (!row) return null
  const fields = [
    ["name", "name"],
    ["description", "description"],
    ["color", "color"],
    ["sequence", "sequence"],
  ] as const
  if (fields.some(([param, field]) => !sameScalar(row[field], params[param]))) return null
  return { resource: "knowledge-categories", id: categoryId.toString() }
}

/** Resolve deletion only when no row with the same global id remains. */
export function resolveKnowledgeCategoryDeleteEffect(
  rows: readonly Row[],
  _organizationId: bigint,
  categoryId: bigint,
): CanonicalRecordRef | null {
  const sameId = rows.filter((row) => parseStrictU64(row.id) === categoryId)
  if (sameId.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected at most one category ${categoryId}, found ${sameId.length}`)
  }
  if (sameId.length === 1) return null
  return { resource: "knowledge-categories", id: categoryId.toString() }
}

function identityText(value: unknown): string {
  if (typeof value === "string") return value.trim().toLowerCase()
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    return identityText(object.__identity__ ?? object.identity ?? object.value)
  }
  return String(value ?? "").trim().toLowerCase()
}

/** Resolve member removal only from the exact article's canonical member list. */
export function resolveArticleMemberRemovalEffect(
  rows: readonly Row[],
  organizationId: bigint,
  articleId: bigint,
  member: string,
): CanonicalRecordRef | null {
  const row = exactRow(rows, organizationId, articleId)
  if (!row) return null
  const members = row.memberIds ?? row.member_ids
  if (!Array.isArray(members)) return null
  if (members.some((value) => identityText(value) === identityText(member))) return null
  return { resource: "knowledge-articles", id: articleId.toString() }
}

/** Resolve the one newly scheduled retention job in the same organization. */
export function resolveRetentionPurgeScheduleEffect(
  beforeIds: ReadonlySet<bigint>,
  rows: readonly Row[],
  organizationId: bigint,
): CanonicalRecordRef | null {
  const matches = rows.filter((row) => {
    const id = parseStrictU64(row.scheduledId ?? row.scheduled_id)
    return (
      id !== undefined &&
      !beforeIds.has(id) &&
      parseStrictU64(row.organizationId ?? row.organization_id) === organizationId
    )
  })
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one new retention purge job, found ${matches.length}`,
    )
  }
  const id = parseStrictU64(matches[0]?.scheduledId ?? matches[0]?.scheduled_id)
  return id === undefined
    ? null
    : { resource: "document-retention-purge-jobs", id: id.toString() }
}
