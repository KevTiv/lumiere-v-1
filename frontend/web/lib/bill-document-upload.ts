import { billDocumentContentType } from "@lumiere/erp-shared/document-file-profile"
import { billSourceDocuments, documentActorId, documentId, documentOptional, type BillSourceDocument } from "@lumiere/ui/lib/bill-source-document-model"
import type { DocumentBlobUploadResult } from "./document-blob-upload"
import type { DocumentRegistration, DocumentUploadReceipt } from "./document-upload-receipts"

export interface BillDocumentScope { organizationId: bigint; companyId: bigint; billId: bigint | number | string; partnerId?: unknown; actorId?: string }
export interface BillDocumentAttempt {
  phase: "pending" | "unknown" | "error" | "attached"
  uploaded?: DocumentBlobUploadResult
  documentId?: string
  message?: string
}

function validateManagedUpload(uploaded: DocumentBlobUploadResult, file: File, scope: BillDocumentScope): void {
  const match = /^org-([1-9]\d*)\/([A-Za-z0-9_-]{1,32})\/([0-9a-fA-F]{32})$/.exec(uploaded.objectKey)
  const baseName = file.name.replace(/\/+$/, "").split("/").pop() || "upload.bin"
  const cleaned = [...baseName].map((character) => /^[A-Za-z0-9. _-]$/.test(character) ? character : "_").join("")
  const canonicalName = cleaned.trim() ? cleaned : "upload.bin"
  if (!match || match[1] !== String(scope.organizationId) || uploaded.url !== `/api/documents/blobs/object/${match[1]}/${match[2]}/${match[3]}` || !/^[0-9a-f]{64}$/i.test(uploaded.checksum) || uploaded.fileSize !== BigInt(file.size) || uploaded.mimetype !== billDocumentContentType(file) || uploaded.fileName !== canonicalName) throw new Error("The completed managed upload does not match this file or organization")
}

export function resolveBillDocumentAttempt(documents: readonly BillSourceDocument[], scope: BillDocumentScope, uploaded: DocumentBlobUploadResult, expectedId?: string): string | null {
  const linked = billSourceDocuments(documents, scope)
  if (!linked) return null
  const matches = linked.filter((document) => {
    let metadata: unknown
    try { metadata = JSON.parse(String(documentOptional(document.metadata) ?? "")) } catch { return false }
    const provenance = metadata != null && typeof metadata === "object" ? metadata as { source?: unknown; object_key?: unknown; uploaded_by?: unknown } : null
    return String(documentOptional(document.checksum) ?? "").toLowerCase() === uploaded.checksum.toLowerCase() &&
      documentOptional(document.url) === uploaded.url &&
      documentId(document.fileSize ?? document.file_size) === String(uploaded.fileSize) &&
      documentOptional(document.mimetype) === uploaded.mimetype &&
      documentOptional(document.fileName ?? document.file_name) === uploaded.fileName &&
      provenance?.source === "accounting_bill_intake" && provenance.object_key === uploaded.objectKey && provenance.uploaded_by === scope.actorId &&
      documentActorId(document.ownerId ?? document.owner_id) === documentActorId(scope.actorId) && Boolean(documentActorId(scope.actorId)) &&
      (expectedId == null || documentId(document.id) === expectedId)
  })
  return matches.length === 1 ? documentId(matches[0]!.id) ?? null : null
}

/** Common document saving owns retries; bill intake additionally verifies the exact ERP link. */
export async function uploadBillSourceDocument(args: {
  file: File
  scope: BillDocumentScope
  isCurrent: () => boolean
  submit(file: File, registration: DocumentRegistration): Promise<DocumentUploadReceipt>
  readDocuments: () => Promise<readonly BillSourceDocument[]>
  onAttempt: (attempt: BillDocumentAttempt) => void
}): Promise<void> {
  const { file, scope } = args
  if (!scope.actorId || !documentId(scope.organizationId) || !documentId(scope.companyId) || !documentId(scope.billId) || !args.isCurrent()) throw new Error("The bill scope or document permissions changed. Reopen this bill before attaching a file.")
  if (scope.companyId > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("This company ID cannot be represented safely by the managed upload API")
  billDocumentContentType(file)
  let uploaded: DocumentBlobUploadResult | undefined
  let createdId: string | undefined
  args.onAttempt({ phase: "pending" })
  try {
    const receipt = await args.submit(file, {
      name: file.name, resModel: "account_move", resId: String(scope.billId),
      partnerId: documentId(scope.partnerId), tagIds: [], isFavorite: false,
      metadata: JSON.stringify({ source: "accounting_bill_intake" }),
    })
    uploaded = {
      objectKey: receipt.objectKey, url: receipt.url, checksum: receipt.checksum,
      fileName: receipt.fileName, fileSize: BigInt(receipt.fileSize), mimetype: receipt.mimetype,
    }
    validateManagedUpload(uploaded, file, scope)
    if (!receipt.fileSaved || !receipt.documentId || receipt.registration.resModel !== "account_move" || receipt.registration.resId !== String(scope.billId)) {
      throw new Error("The attachment receipt does not confirm this bill's document")
    }
    createdId = receipt.documentId
    args.onAttempt({ phase: "pending", uploaded, documentId: createdId })
    if (!args.isCurrent()) throw new Error("The bill scope or document permissions changed. Reopen this bill and review its saved documents.")
    const documents = await args.readDocuments()
    if (!args.isCurrent()) throw new Error("The bill scope or document permissions changed during document readback")
    const id = resolveBillDocumentAttempt(documents, scope, uploaded, createdId)
    if (!id) throw new Error("The supplier document could not be verified on this bill. Refresh its documents before uploading again.")
    args.onAttempt({ phase: "attached", uploaded, documentId: id })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    args.onAttempt({ phase: uploaded ? "unknown" : "error", uploaded, documentId: createdId, message })
    throw cause
  }
}
