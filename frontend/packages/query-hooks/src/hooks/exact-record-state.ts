import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import {
  AmbiguousOperationEffectError,
  type CanonicalRecordRef,
} from "./operation-effect"

export type ExactRecordStateProjection = {
  id?: unknown
  organizationId?: unknown
  organization_id?: unknown
} & Record<string, unknown>

export function enumState(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase()
  if (!value || typeof value !== "object") return ""
  const row = value as Record<string, unknown>
  if (typeof row.tag === "string") return row.tag.toLowerCase()
  const keys = Object.keys(row)
  return keys.length === 1 ? String(keys[0]).toLowerCase() : ""
}

/** Resolve one exact tenant record only when its requested semantic state is visible. */
export function resolveExactRecordState(
  rows: readonly ExactRecordStateProjection[],
  organizationId: bigint,
  id: bigint,
  resource: string,
  matchesState: (row: ExactRecordStateProjection) => boolean,
  href?: string,
): CanonicalRecordRef | null {
  const matches = rows.filter(
    (row) =>
      parseStrictU64(row.id) === id &&
      parseStrictU64(row.organizationId ?? row.organization_id) === organizationId,
  )
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one ${resource} record ${id}, found ${matches.length}`,
    )
  }
  const row = matches[0]
  if (!row || !matchesState(row)) return null
  return {
    resource,
    id: id.toString(),
    ...(href ? { href } : {}),
  }
}
