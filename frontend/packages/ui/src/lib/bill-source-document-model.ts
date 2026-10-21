import { parseStrictU64 } from "@lumiere/erp-shared/u64"

export interface BillSourceDocument {
  id?: unknown
  organizationId?: unknown
  organization_id?: unknown
  companyId?: unknown
  company_id?: unknown
  resModel?: unknown
  res_model?: unknown
  resId?: unknown
  res_id?: unknown
  name?: unknown
  fileName?: unknown
  file_name?: unknown
  checksum?: unknown
  url?: unknown
  fileSize?: unknown
  file_size?: unknown
  mimetype?: unknown
  metadata?: unknown
  ownerId?: unknown
  owner_id?: unknown
  isDeleted?: unknown
  is_deleted?: unknown
}

export function documentOptional(value: unknown): unknown { return value != null && typeof value === "object" && "some" in value ? (value as { some: unknown }).some : value }
export const documentId = (value: unknown) => { const parsed = parseStrictU64(documentOptional(value)); return parsed != null && parsed > 0n ? parsed.toString() : undefined }
export function documentActorId(value: unknown): string {
  const raw = documentOptional(value)
  if (raw != null && typeof raw === "object") { const object = raw as { hex?: unknown; Hex?: unknown; __identity__?: unknown }; return documentActorId(object.hex ?? object.Hex ?? object.__identity__) }
  return typeof raw === "string" ? raw.trim().replace(/^0x/i, "").toLowerCase() : ""
}

export function billSourceDocuments(documents: readonly BillSourceDocument[], scope: { organizationId: bigint | string | number; companyId: bigint | string | number; billId: bigint | string | number }): BillSourceDocument[] | null {
  if (!documentId(scope.organizationId) || !documentId(scope.companyId) || !documentId(scope.billId)) return null
  const linked: BillSourceDocument[] = []
  const ids = new Set<string>()
  for (const document of documents) {
    // Missing projection fields are unknown; explicit null means an unlinked document.
    if (document.resModel === undefined && document.res_model === undefined) return null
    if (documentOptional(document.resModel ?? document.res_model) !== "account_move" || documentId(document.resId ?? document.res_id) !== documentId(scope.billId)) continue
    const organization = documentId(document.organizationId ?? document.organization_id)
    const company = documentId(document.companyId ?? document.company_id)
    if (!organization || !company) return null
    if (organization !== documentId(scope.organizationId) || company !== documentId(scope.companyId)) continue
    const id = documentId(document.id)
    if (!id || ids.has(id)) return null
    ids.add(id)
    if (documentOptional(document.isDeleted ?? document.is_deleted) === true) continue
    linked.push(document)
  }
  return linked
}
