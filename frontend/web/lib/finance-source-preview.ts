/** Only the current organization's authenticated blob endpoint can be previewed. */
export function financeSourceUrl(value: unknown, organizationId: bigint): string | null {
  if (typeof value !== "string") return null
  const match = /^\/api\/documents\/blobs\/object\/(\d+)\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9-]+)$/.exec(value)
  return match && BigInt(match[1]!) === organizationId ? value : null
}

/** Receipt rows store the producer's object key, not a document URL. */
export function financeReceiptSourceUrl(value: unknown, organizationId: bigint): string | null {
  if (typeof value !== "string") return null
  const match = /^org-(\d+)\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9-]+)$/.exec(value)
  return match ? financeSourceUrl(`/api/documents/blobs/object/${match[1]}/${match[2]}/${match[3]}`, organizationId) : null
}

export type FinanceEvidence = { id: string; name: string; url: string | null; mime: string }
function field(row: unknown, key: string): unknown {
  return row != null && typeof row === "object" ? Reflect.get(row, key) : undefined
}
const cell = (row: unknown, camel: string, snake: string) => field(row, camel) ?? field(row, snake)
const text = (value: unknown) => typeof value === "string" ? value : ""
function id(value: unknown): string | null {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) return null
  if (!["string", "number", "bigint"].includes(typeof value)) return null
  const raw = String(value)
  return /^[1-9]\d*$/.test(raw) ? raw : null
}

/** Exact owned relations only; never associate evidence by name, date, or amount. */
export function linkedFinanceEvidence(rows: readonly unknown[], scope: {
  organizationId: bigint; companyId: bigint; recordId?: string; receiptIds?: readonly string[]; employeeId?: string
}): FinanceEvidence[] {
  if (scope.organizationId <= 0n || scope.companyId <= 0n) return []
  return rows.filter((row) => id(field(row, "id")) !== null && id(cell(row, "organizationId", "organization_id")) === String(scope.organizationId)
    && id(cell(row, "companyId", "company_id")) === String(scope.companyId)
    && !cell(row, "isDeleted", "is_deleted")
    && (scope.receiptIds
      ? scope.receiptIds.includes(id(field(row, "id")) ?? "") && id(cell(row, "employeeId", "employee_id")) === scope.employeeId
      : cell(row, "resModel", "res_model") === "account_move" && id(cell(row, "resId", "res_id")) === scope.recordId))
    .map((row) => ({
      id: id(field(row, "id")) ?? "", name: text(field(row, "name")) || text(cell(row, "fileName", "file_name")) || "Document",
      url: scope.receiptIds ? financeReceiptSourceUrl(cell(row, "storageKey", "storage_key"), scope.organizationId) : financeSourceUrl(field(row, "url"), scope.organizationId),
      mime: text(field(row, "mimetype")) || text(cell(row, "mimeType", "mime_type")),
    }))
}

/** Use the owner's explicit current-version flag. Ambiguous versions never become a preview. */
export function linkedBillEvidence(documents: readonly unknown[], versions: readonly unknown[], scope: {
  organizationId: bigint; companyId: bigint; recordId: string
}): { files: FinanceEvidence[]; unavailable: boolean } {
  const parents = linkedFinanceEvidence(documents, scope)
  let unavailable = false
  const files = parents.flatMap((parent) => {
    const current = versions.filter((version) => id(cell(version, "organizationId", "organization_id")) === String(scope.organizationId)
      && id(cell(version, "documentId", "document_id")) === parent.id
      && cell(version, "isCurrent", "is_current") === true)
    if (current.length !== 1) { unavailable = true; return [] }
    const version = current[0]
    const url = financeSourceUrl(field(version, "url"), scope.organizationId)
    const mime = text(field(version, "mimetype"))
    if (!url || !mime) { unavailable = true; return [] }
    return [{ ...parent, url, mime, name: text(cell(version, "fileName", "file_name")) || parent.name }]
  })
  return { files, unavailable }
}
