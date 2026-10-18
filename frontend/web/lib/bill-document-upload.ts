import type { CreateDocumentParams } from "@lumiere/stdb/types"
import { billSourceDocuments, documentActorId, documentId, documentOptional, type BillSourceDocument } from "@lumiere/ui/lib/bill-source-document-model"
import type { DocumentBlobUploadResult } from "./document-blob-upload"

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
  if (!match || match[1] !== String(scope.organizationId) || uploaded.url !== `/api/documents/blobs/object/${match[1]}/${match[2]}/${match[3]}` || !/^[0-9a-f]{64}$/i.test(uploaded.checksum) || uploaded.fileSize !== BigInt(file.size) || uploaded.mimetype !== file.type || uploaded.fileName !== canonicalName) throw new Error("The completed managed upload does not match this file or organization")
}

export function resolveBillDocumentAttempt(documents: readonly BillSourceDocument[], scope: BillDocumentScope, uploaded: DocumentBlobUploadResult, expectedId?: string): string | null {
  const linked = billSourceDocuments(documents, scope)
  if (!linked) return null
  const matches = linked.filter((document) => {
    let metadata: unknown
    try { metadata = JSON.parse(String(documentOptional(document.metadata) ?? "")) } catch { return false }
    const provenance = metadata != null && typeof metadata === "object" ? metadata as Record<string, unknown> : null
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

/** A managed upload followed by an exact linked-document readback. Unknown linking never retries automatically. */
export async function uploadBillSourceDocument(args: {
  file: File
  scope: BillDocumentScope
  isCurrent: () => boolean
  upload: (args: { file: File; companyId: bigint }) => Promise<DocumentBlobUploadResult>
  create: (params: CreateDocumentParams) => Promise<{ resource: string; id: string }>
  readDocuments: () => Promise<readonly BillSourceDocument[]>
  onAttempt: (attempt: BillDocumentAttempt) => void
}): Promise<void> {
  const { file, scope } = args
  if (!scope.actorId || !documentId(scope.organizationId) || !documentId(scope.companyId) || !documentId(scope.billId) || !args.isCurrent()) throw new Error("The bill scope or document permissions changed. Reopen this bill before attaching a file.")
  if (scope.companyId > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("This company ID cannot be represented safely by the managed upload API")
  if (file.size <= 0 || file.size > 20 * 1024 * 1024 || !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a non-empty PDF, PNG, JPEG or WebP file up to 20 MB.")
  let uploaded: DocumentBlobUploadResult | undefined
  let linkingStarted = false
  let createdId: string | undefined
  args.onAttempt({ phase: "pending" })
  try {
    uploaded = await args.upload({ file, companyId: scope.companyId })
    validateManagedUpload(uploaded, file, scope)
    if (!args.isCurrent()) throw new Error("The bill scope or document permissions changed before linking. Reopen this bill and review its documents.")
    args.onAttempt({ phase: "pending", uploaded })
    linkingStarted = true
    const ref = await args.create({
      name: file.name,
      description: undefined,
      fileName: uploaded.fileName,
      fileSize: uploaded.fileSize,
      mimetype: uploaded.mimetype,
      url: uploaded.url,
      checksum: uploaded.checksum,
      folderId: undefined,
      resModel: "account_move",
      resId: BigInt(scope.billId),
      partnerId: documentId(scope.partnerId) ? BigInt(documentId(scope.partnerId)!) : undefined,
      tagIds: [],
      isFavorite: false,
      classificationId: undefined,
      retentionDays: undefined,
      fiscalKind: undefined,
      residencyRegion: undefined,
      metadata: JSON.stringify({ source: "accounting_bill_intake", object_key: uploaded.objectKey, uploaded_by: scope.actorId }),
    })
    if (ref.resource !== "documents" || !documentId(ref.id)) throw new Error("The attachment operation returned an unexpected document reference")
    createdId = ref.id
    args.onAttempt({ phase: "pending", uploaded, documentId: createdId })
    const documents = await args.readDocuments()
    const id = resolveBillDocumentAttempt(documents, scope, uploaded, ref.id)
    if (!id) throw new Error("The supplier document could not be verified on this bill. Refresh its documents before uploading again.")
    args.onAttempt({ phase: "attached", uploaded, documentId: id })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    args.onAttempt({ phase: linkingStarted ? "unknown" : "error", uploaded, documentId: createdId, message })
    throw cause
  }
}
