import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type FormConfigEffectProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly moduleId?: unknown
  readonly module_id?: unknown
  readonly formId?: unknown
  readonly form_id?: unknown
  readonly isActive?: unknown
  readonly is_active?: unknown
  readonly configVersion?: unknown
  readonly config_version?: unknown
}

export type ImportJobEffectProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly tableName?: unknown
  readonly table_name?: unknown
  readonly status?: unknown
  readonly metadata?: unknown
}

export interface ImportJobRecordRef {
  resource: "import-jobs"
  id: string
  href: string
}

/** Exact form configuration identity: (organization, module, form). */
function exactFormConfig(
  rows: readonly FormConfigEffectProjection[],
  organizationId: bigint,
  moduleId: string,
  formId: string,
): FormConfigEffectProjection | null {
  const matches = rows.filter(
    (row) =>
      parseStrictU64(row.organizationId ?? row.organization_id) === organizationId &&
      String(row.moduleId ?? row.module_id ?? "") === moduleId &&
      String(row.formId ?? row.form_id ?? "") === formId,
  )
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one form configuration, found ${matches.length}`)
  }
  return matches[0] ?? null
}

/** The published version of a form before a publish, or null when it does not exist yet. */
export function formConfigVersion(
  rows: readonly FormConfigEffectProjection[],
  organizationId: bigint,
  moduleId: string,
  formId: string,
): number | null {
  const row = exactFormConfig(rows, organizationId, moduleId, formId)
  return row ? Number(row.configVersion ?? row.config_version) : null
}

/**
 * COV-22: a publish is proven when the exact (module, form) reads back active at
 * exactly the next config_version (1 for a first publish).
 */
export function resolveFormPublishEffect(
  rows: readonly FormConfigEffectProjection[],
  organizationId: bigint,
  moduleId: string,
  formId: string,
  priorVersion: number | null,
): CanonicalRecordRef | null {
  const row = exactFormConfig(rows, organizationId, moduleId, formId)
  if (!row) return null
  if ((row.isActive ?? row.is_active) !== true) return null
  if (Number(row.configVersion ?? row.config_version) !== (priorVersion ?? 0) + 1) return null
  const id = parseStrictU64(row.id)
  return id === undefined ? null : { resource: "form-configs", id: id.toString() }
}

/** Lowercase hex SHA-256 of the exact UTF-8 text sent to the import reducer. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function jobSha256(metadata: unknown): string | null {
  if (typeof metadata !== "string") return null
  try {
    const parsed: unknown = JSON.parse(metadata)
    if (parsed && typeof parsed === "object" && "sha256" in parsed) {
      const value = (parsed as { sha256?: unknown }).sha256
      return typeof value === "string" ? value : null
    }
  } catch {
    return null
  }
  return null
}

/**
 * COV-22: an import commit is proven by the job stamped with the file's SHA-256
 * for this entity. Jobs that imported nothing (`failed`) are not a commit.
 */
export function resolveImportCommitEffect(
  jobs: readonly ImportJobEffectProjection[],
  organizationId: bigint,
  tableName: string,
  sha256: string,
): ImportJobRecordRef | null {
  const matches = jobs.filter(
    (job) =>
      parseStrictU64(job.organizationId ?? job.organization_id) === organizationId &&
      String(job.tableName ?? job.table_name ?? "") === tableName &&
      ["success", "partial"].includes(String(job.status ?? "")) &&
      jobSha256(job.metadata) === sha256,
  )
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one import job, found ${matches.length}`)
  }
  const id = parseStrictU64(matches[0]?.id)
  return id === undefined
    ? null
    : { resource: "import-jobs", id: id.toString(), href: `/settings/import-jobs/${id}` }
}
