import { parseStrictU64 } from "@lumiere/erp-shared/u64"

export interface BatchChoice { value: string; label: string; description?: string }
export interface BatchScopeRow {
  id?: unknown; organizationId?: unknown; organization_id?: unknown
  companyId?: unknown; company_id?: unknown
}
export interface BatchEvidenceRow extends BatchScopeRow {
  messageBatchId?: unknown; message_batch_id?: unknown
  contactId?: unknown; contact_id?: unknown
  renderedSubject?: unknown; rendered_subject?: unknown
  renderedBody?: unknown; rendered_body?: unknown
  status?: unknown
  failureReason?: unknown; failure_reason?: unknown
}
export interface BatchReviewEnvelope extends BatchScopeRow {
  templateId?: unknown; template_id?: unknown; channel?: unknown; status?: unknown
  subjectModel?: unknown; subject_model?: unknown
  recipientCount?: unknown; recipient_count?: unknown
  excludedCount?: unknown; excluded_count?: unknown
  metadata?: unknown
}

export interface BatchExclusion {
  model: "contact" | "account_move"
  recordId: string
  contactId: string | null
  reason: string
}
export interface BatchExclusionEvidence extends BatchScopeRow { exclusions?: unknown }

const exclusionReasons: { [reason: string]: string } = {
  contact_inactive: "The contact is deleted or merged.",
  channel_opted_out: "The contact opted out of this channel.",
  no_eligible_primary_identity: "No eligible primary contact identity is available.",
  invoice_unavailable: "The invoice is unavailable.",
  invoice_not_outstanding_posted_customer_invoice: "The invoice is outside the selected scope or is not an outstanding posted customer invoice.",
  invoice_has_no_contact: "The invoice has no customer contact.",
  contact_unavailable: "The customer contact is unavailable.",
}

export function batchExclusionReason(reason: string): string | null {
  return Object.hasOwn(exclusionReasons, reason) ? exclusionReasons[reason] : null
}

/** Only the complete creation-time snapshot is evidence of why rows were excluded. */
export function batchExclusions(batch: BatchReviewEnvelope, evidence: readonly BatchExclusionEvidence[] = []): BatchExclusion[] | null {
  const count = parseStrictU64(batch.excludedCount ?? batch.excluded_count)
  if (count == null) return null
  const matching = evidence.filter((row) => parseStrictU64(row.id) === parseStrictU64(batch.id)
    && parseStrictU64(row.organizationId ?? row.organization_id) === parseStrictU64(batch.organizationId ?? batch.organization_id)
    && parseStrictU64(row.companyId ?? row.company_id) === parseStrictU64(batch.companyId ?? batch.company_id))
  if (matching.length !== 1) return count === 0n ? [] : null
  try {
    const rows = matching[0].exclusions
    if (!Array.isArray(rows) || BigInt(rows.length) !== count) return null
    const result: BatchExclusion[] = []
    for (const row of rows) {
      if (!row || typeof row !== "object" || !["contact", "account_move"].includes(row.model)
        || typeof row.recordId !== "string" || (parseStrictU64(row.recordId) ?? 0n) <= 0n
        || (row.contactId !== null && (typeof row.contactId !== "string" || (parseStrictU64(row.contactId) ?? 0n) <= 0n))
        || typeof row.reason !== "string" || !batchExclusionReason(row.reason)) return null
      result.push({ model: row.model, recordId: row.recordId, contactId: row.contactId, reason: row.reason })
    }
    if (new Set(result.map((row) => `${row.model}:${row.recordId}`)).size !== result.length) return null
    return result
  } catch { return null }
}

export interface ProviderEvidenceRow extends BatchScopeRow {
  operationalMessageId?: unknown; operational_message_id?: unknown
  providerMessageId?: unknown; provider_message_id?: unknown
  direction?: unknown; status?: unknown
}

export function messageFailureReason(message: BatchEvidenceRow): string | null {
  let value = message.failureReason ?? message.failure_reason
  if (value && typeof value === "object" && "some" in value) value = value.some
  return typeof value === "string" && value.trim() ? value : null
}

/** Provider-only conversation fields corroborate the exact saved operational row. */
export function messageProviderEvidence(message: BatchEvidenceRow, rows: readonly ProviderEvidenceRow[], organizationId: bigint, companyId: bigint): { status: "accepted" | "delivered" | "failed"; providerMessageId: string } | null {
  const id = parseStrictU64(message.id)
  if (!id || !batchInScope(message, organizationId, companyId)) return null
  const matching = rows.filter((row) => batchInScope(row, organizationId, companyId)
    && parseStrictU64(row.companyId ?? row.company_id) === parseStrictU64(message.companyId ?? message.company_id)
    && parseStrictU64(row.operationalMessageId ?? row.operational_message_id) === id && row.direction === "outbound")
  if (matching.length !== 1) return null
  const row = matching[0]
  let provider = row.providerMessageId ?? row.provider_message_id
  if (provider && typeof provider === "object" && "some" in provider) provider = provider.some
  const operationalStatus = typeof message.status === "object" && message.status && "tag" in message.status ? message.status.tag : message.status
  if (typeof provider !== "string" || !provider.trim() || typeof operationalStatus !== "string" || operationalStatus.toLowerCase() !== row.status) return null
  if (row.status !== "sent" && row.status !== "delivered" && row.status !== "failed") return null
  return { status: row.status === "sent" ? "accepted" : row.status, providerMessageId: provider }
}

/** Search changes visibility only; selection remains owned by the form. */
export function filterBatchChoices(options: readonly BatchChoice[], search: string): BatchChoice[] {
  const query = search.trim().toLocaleLowerCase()
  return options.filter((option) => !query || `${option.label} ${option.description ?? ""}`.toLocaleLowerCase().includes(query))
}

/** Organization-wide batches remain visible alongside the selected company's batches. */
export function batchInScope(row: BatchScopeRow, organizationId: bigint, companyId: bigint): boolean {
  if (organizationId <= 0n || companyId <= 0n || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId) return false
  if (!Object.hasOwn(row, "companyId") && !Object.hasOwn(row, "company_id")) return false
  const rawCompany = row.companyId ?? row.company_id
  const company = parseStrictU64(rawCompany)
  return rawCompany == null || (typeof rawCompany === "object" && "none" in rawCompany) || company === companyId
}

/** Rendered messages are saved evidence; never manufacture a preview from a mutable template. */
export function messagesForBatch(rows: readonly BatchEvidenceRow[], batch: BatchScopeRow, organizationId: bigint, companyId: bigint): BatchEvidenceRow[] {
  const batchId = parseStrictU64(batch.id)
  if (!batchId || !batchInScope(batch, organizationId, companyId)) return []
  const batchCompany = parseStrictU64(batch.companyId ?? batch.company_id)
  return rows.filter((row) => batchInScope(row, organizationId, companyId)
    && parseStrictU64(row.messageBatchId ?? row.message_batch_id) === batchId
    && parseStrictU64(row.companyId ?? row.company_id) === batchCompany)
}

export function batchEvidenceComplete(rows: readonly BatchEvidenceRow[], recipientCount: unknown): boolean {
  const expected = parseStrictU64(recipientCount)
  if (!expected || BigInt(rows.length) !== expected) return false
  const ids = rows.map((row) => parseStrictU64(row.id))
  return ids.every((id) => id != null && id > 0n) && new Set(ids).size === rows.length
    && rows.every((row) => (parseStrictU64(row.contactId ?? row.contact_id) ?? 0n) > 0n
      && typeof (row.renderedBody ?? row.rendered_body) === "string")
}
