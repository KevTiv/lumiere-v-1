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
}
export interface BatchReviewEnvelope extends BatchScopeRow {
  templateId?: unknown; template_id?: unknown; channel?: unknown; status?: unknown
  subjectModel?: unknown; subject_model?: unknown
  recipientCount?: unknown; recipient_count?: unknown
  excludedCount?: unknown; excluded_count?: unknown
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
