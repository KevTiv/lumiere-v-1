import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { apiFetch } from "../http"

export interface RetentionPreviewDocument { id: string; name: string; companyId: string | null; purgeAfterMicros: string }
export interface RetentionPreview {
  organizationId: string; scope: "organization"; delaySeconds: number
  evaluatedAtMicros: string; cutoffMicros: string; fingerprint: string
  documents: RetentionPreviewDocument[]; unreviewableCount: number; heldCount: number
  complete: true; canProceed: boolean
}

interface PreviewFields {
  organizationId?: unknown; scope?: unknown; delaySeconds?: unknown
  evaluatedAtMicros?: unknown; cutoffMicros?: unknown; fingerprint?: unknown
  documents?: unknown; unreviewableCount?: unknown; heldCount?: unknown; complete?: unknown; canProceed?: unknown
}
interface DocumentFields { id?: unknown; name?: unknown; companyId?: unknown; purgeAfterMicros?: unknown }
function isObject(value: unknown): value is object { return value != null && typeof value === "object" && !Array.isArray(value) }
function exactTimestamp(value: unknown): value is string { return typeof value === "string" && /^-?\d+$/.test(value) && BigInt(value) >= -(2n ** 63n) && BigInt(value) < 2n ** 63n }

/** Incomplete or inconsistent evidence must never enable a destructive action. */
export function decodeRetentionPreview(value: unknown, organizationId: bigint, delaySeconds: number): RetentionPreview {
  const invalid = () => new Error("The complete retention purge scope could not be verified. Refresh the preview before continuing.")
  if (!isObject(value) || !("data" in value) || !isObject(value.data)) throw invalid()
  const data: PreviewFields = value.data
  if (data.organizationId !== organizationId.toString() || data.scope !== "organization" || data.delaySeconds !== delaySeconds
    || !exactTimestamp(data.evaluatedAtMicros) || !exactTimestamp(data.cutoffMicros)
    || BigInt(data.cutoffMicros) !== BigInt(data.evaluatedAtMicros) + BigInt(delaySeconds) * 1_000_000n
    || typeof data.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.fingerprint)
    || data.complete !== true || !Array.isArray(data.documents)
    || typeof data.unreviewableCount !== "number" || !Number.isSafeInteger(data.unreviewableCount) || data.unreviewableCount < 0
    || typeof data.heldCount !== "number" || !Number.isSafeInteger(data.heldCount) || data.heldCount < 0
    || typeof data.canProceed !== "boolean" || data.canProceed !== (data.unreviewableCount === 0)) throw invalid()
  const documents: RetentionPreviewDocument[] = []
  for (const candidate of data.documents) {
    if (!isObject(candidate)) throw invalid()
    const row: DocumentFields = candidate
    if (typeof row.id !== "string" || (parseStrictU64(row.id) ?? 0n) <= 0n
      || typeof row.name !== "string" || (row.companyId !== null && (typeof row.companyId !== "string" || (parseStrictU64(row.companyId) ?? 0n) <= 0n))
      || !exactTimestamp(row.purgeAfterMicros) || BigInt(row.purgeAfterMicros) > BigInt(data.cutoffMicros)) throw invalid()
    documents.push({ id: row.id, name: row.name, companyId: row.companyId, purgeAfterMicros: row.purgeAfterMicros })
  }
  if (new Set(documents.map((row) => row.id)).size !== documents.length) throw invalid()
  return { organizationId: organizationId.toString(), scope: "organization", delaySeconds, evaluatedAtMicros: data.evaluatedAtMicros,
    cutoffMicros: data.cutoffMicros, fingerprint: data.fingerprint, documents, unreviewableCount: data.unreviewableCount,
    heldCount: data.heldCount, complete: true, canProceed: data.canProceed }
}

export async function readRetentionPreview(organizationId: bigint, delaySeconds: number): Promise<RetentionPreview> {
  if (organizationId <= 0n || !Number.isSafeInteger(delaySeconds) || delaySeconds < 0) throw new Error("Invalid retention preview scope")
  const response = await apiFetch(`/api/documents/retention/preview?delaySeconds=${delaySeconds}`, { cache: "no-store" })
  if (!response.ok) throw new Error("The retention purge preview could not be loaded. No purge was requested.")
  return decodeRetentionPreview(await response.json(), organizationId, delaySeconds)
}

export function assertRetentionPreviewUnchanged(reviewed: RetentionPreview, current: RetentionPreview): void {
  if (!reviewed.canProceed || !current.canProceed || reviewed.organizationId !== current.organizationId
    || reviewed.delaySeconds !== current.delaySeconds || reviewed.fingerprint !== current.fingerprint) {
    throw new Error("The affected documents or legal holds changed. Reopen and review a fresh purge preview.")
  }
}
