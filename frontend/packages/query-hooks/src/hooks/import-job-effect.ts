import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type ImportJobProjection = {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly tableName?: unknown
  readonly table_name?: unknown
  readonly status?: unknown
  readonly totalRows?: unknown
  readonly total_rows?: unknown
  readonly importedRows?: unknown
  readonly imported_rows?: unknown
  readonly errorRows?: unknown
  readonly error_rows?: unknown
  readonly metadata?: unknown
}

export type ImportJobEffect = {
  readonly ref: CanonicalRecordRef
  readonly importedRows: number
  readonly errorRows: number
  readonly status: string
}

/**
 * Content identity of one import, matching `import_content_sha256` on the server:
 * SHA-256 over the table name, a newline and the CSV with a leading BOM removed,
 * CRLF normalized to LF and surrounding ASCII whitespace trimmed.
 */
export async function importContentSha256(tableName: string, csvData: string): Promise<string> {
  const normalized = csvData
    .replace(/^﻿+/, "")
    .replace(/\r\n/g, "\n")
    .replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "")
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${tableName}\n${normalized}`))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function jobContentSha256(metadata: unknown): string | null {
  const raw = typeof metadata === "string"
    ? metadata
    : metadata && typeof metadata === "object" && "some" in metadata && typeof (metadata as { some: unknown }).some === "string"
      ? (metadata as { some: string }).some
      : null
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    const hash = parsed && typeof parsed === "object" ? (parsed as { content_sha256?: unknown }).content_sha256 : undefined
    return typeof hash === "string" ? hash : null
  } catch {
    return null
  }
}

function count(value: unknown): number {
  return Number(parseStrictU64(value) ?? 0n)
}

/**
 * COV-22: resolve the import job that committed this content in the organization.
 * The server never commits one content twice, so more than one committing job is
 * an invariant failure. When nothing committed, the newest rejected job for the
 * same content is not an effect: `null` (callers report the rejection).
 */
export function resolveCommittedImportJob(
  jobs: readonly ImportJobProjection[],
  organizationId: bigint,
  tableName: string,
  contentSha256: string,
): ImportJobEffect | null {
  const committed = jobs.filter(
    (job) =>
      String(job.tableName ?? job.table_name ?? "") === tableName
      && parseStrictU64(job.organizationId ?? job.organization_id) === organizationId
      && jobContentSha256(job.metadata) === contentSha256
      && count(job.importedRows ?? job.imported_rows) > 0
      && String(job.status ?? "") !== "rolled_back",
  )
  if (committed.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one committed import job, found ${committed.length}`)
  }
  const job = committed[0]
  const id = job ? parseStrictU64(job.id) : undefined
  if (!job || id == null) return null
  return {
    ref: { resource: "import-jobs", id: id.toString() },
    importedRows: count(job.importedRows ?? job.imported_rows),
    errorRows: count(job.errorRows ?? job.error_rows),
    status: String(job.status ?? ""),
  }
}
