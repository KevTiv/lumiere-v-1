import {
  parseStrictU64,
  scalarToU64,
  type ScalarId,
} from "@lumiere/erp-shared/u64"
import { resolveUniqueRow, type CanonicalRecordRef } from "./operation-effect"

export type DocumentLocationAction =
  | {
      kind: "moveFolder" | "restoreFolder"
      id: ScalarId
      parentId: ScalarId | null
    }
  | { kind: "trashFolder"; id: ScalarId }
  | { kind: "moveDocument"; id: ScalarId; folderId: ScalarId | null }

/** Untrusted fields needed to recognize one authorized HTTP readback row. */
interface DocumentLocationRow {
  id?: unknown
  organizationId?: unknown
  organization_id?: unknown
  companyId?: unknown
  company_id?: unknown
  parentId?: unknown
  parent_id?: unknown
  folderId?: unknown
  folder_id?: unknown
}

function positiveId(value: ScalarId): bigint {
  const id = scalarToU64(value)
  if (id === 0n)
    throw new RangeError("A document or folder ID must be positive")
  return id
}

/** Validate all inputs before read-before-dispatch can recognize an existing effect. */
export function normalizeDocumentLocationAction(
  action: DocumentLocationAction,
): DocumentLocationAction {
  const id = positiveId(action.id)
  if (action.kind === "trashFolder") return { ...action, id }
  if (action.kind === "moveDocument")
    return {
      ...action,
      id,
      folderId: action.folderId === null ? null : positiveId(action.folderId),
    }
  return {
    ...action,
    id,
    parentId: action.parentId === null ? null : positiveId(action.parentId),
  }
}

function canonicalId(
  row: DocumentLocationRow,
  camel: keyof DocumentLocationRow,
  snake: keyof DocumentLocationRow,
  nullable = false,
): bigint | null | undefined {
  const parse = (value: unknown) =>
    value === null && nullable ? null : parseStrictU64(value)
  if (!(camel in row) && !(snake in row)) return undefined
  const value = parse(camel in row ? row[camel] : row[snake])
  if (
    value === 0n ||
    (camel in row && snake in row && value !== parse(row[snake]))
  )
    return undefined
  return value
}

export function documentLocationResource(
  action: DocumentLocationAction,
): string {
  return action.kind === "moveDocument"
    ? "documents"
    : action.kind === "trashFolder"
      ? "document-folders-deleted"
      : "document-folders"
}

/** Resolve only a visible exact record; an omitted destination is never proof of root. */
export function resolveDocumentLocationEffect(
  rows: readonly DocumentLocationRow[],
  organizationId: bigint,
  companyId: bigint,
  action: DocumentLocationAction,
): CanonicalRecordRef | null {
  action = normalizeDocumentLocationAction(action)
  const row = resolveUniqueRow(
    rows,
    (candidate) =>
      parseStrictU64(candidate.id) === parseStrictU64(action.id) &&
      canonicalId(candidate, "organizationId", "organization_id") ===
        organizationId,
  )
  if (!row) return null
  const company = canonicalId(row, "companyId", "company_id", true)
  if (company !== null && company !== companyId) return null
  if (action.kind !== "trashFolder") {
    const camel = action.kind === "moveDocument" ? "folderId" : "parentId"
    const snake = action.kind === "moveDocument" ? "folder_id" : "parent_id"
    const actual = canonicalId(row, camel, snake, true)
    const expected =
      action.kind === "moveDocument" ? action.folderId : action.parentId
    if (
      expected === null ? actual !== null : actual !== parseStrictU64(expected)
    )
      return null
  }
  return { resource: documentLocationResource(action), id: String(action.id) }
}
