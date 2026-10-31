import { z } from "zod"
import type { CreateDocumentParams } from "@lumiere/stdb/types"
import { uploadDocumentBlob } from "./document-blob-upload"

const id = z.string().regex(/^[1-9]\d*$/).refine((value) => BigInt(value) <= 18446744073709551615n)
const optionalId = id.nullish()
export const documentRegistrationSchema = z.object({
  name: z.string().trim().min(1).max(500),
  description: z.string().max(8_000).nullish(),
  folderId: optionalId,
  resModel: z.string().max(100).nullish(),
  resId: optionalId,
  partnerId: optionalId,
  tagIds: z.array(id).max(100).default([]),
  isFavorite: z.boolean().default(false),
  classificationId: optionalId,
  retentionDays: z.number().int().nonnegative().max(4294967295).nullish(),
  fiscalKind: z.string().max(100).nullish(),
  residencyRegion: z.string().max(100).nullish(),
}).strict()

export type DocumentRegistration = z.infer<typeof documentRegistrationSchema>

export function documentRegistrationFromParams(params: CreateDocumentParams): DocumentRegistration {
  return documentRegistrationSchema.parse({
    name: params.name, description: params.description, folderId: params.folderId?.toString(),
    resModel: params.resModel, resId: params.resId?.toString(), partnerId: params.partnerId?.toString(),
    tagIds: params.tagIds.map(String), isFavorite: params.isFavorite,
    classificationId: params.classificationId?.toString(), retentionDays: params.retentionDays,
    fiscalKind: params.fiscalKind, residencyRegion: params.residencyRegion,
  })
}
const submissionId = z.string().regex(/^[0-9a-f]{32}$/)
const checksum = z.string().regex(/^[0-9a-f]{64}$/)
export const documentUploadReceiptSchema = z.object({
  submissionId,
  objectKey: z.string().regex(/^org-[1-9]\d*\/[A-Za-z0-9_-]{1,32}\/[0-9a-f]{32}$/),
  url: z.string(),
  fileName: z.string(),
  fileSize: id,
  mimetype: z.string(),
  checksum,
  fileSaved: z.boolean(),
  bytesUploaded: z.boolean(),
  registration: documentRegistrationSchema,
  registrationState: z.enum(["registered", "unconfirmed"]),
  documentId: id.nullable(),
  indexing: z.enum(["pending", "failed", "queued", "superseded"]),
}).strict()
export type DocumentUploadReceipt = z.infer<typeof documentUploadReceiptSchema>

const pointerSchema = z.object({
  submissionId,
  residency: z.string().optional(),
  fileName: z.string(),
  checksum,
  requestHash: checksum,
}).strict()
export type DocumentSubmissionPointer = z.infer<typeof pointerSchema>
export interface DocumentUploadScope { organizationId: bigint; companyId: bigint; actorId: string }
export interface ReceiptStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function documentReceiptStorageKey(scope: DocumentUploadScope): string {
  return `lumiere:document-submissions:v1:${JSON.stringify([String(scope.organizationId), String(scope.companyId), scope.actorId])}`
}

export function loadDocumentSubmissionPointers(storage: ReceiptStorage, scope: DocumentUploadScope): DocumentSubmissionPointer[] {
  const raw = storage.getItem(documentReceiptStorageKey(scope))
  if (!raw) return []
  return z.array(pointerSchema).max(500).parse(JSON.parse(raw))
}

export function saveDocumentSubmissionPointer(storage: ReceiptStorage, scope: DocumentUploadScope, pointer: DocumentSubmissionPointer): void {
  const existing = loadDocumentSubmissionPointers(storage, scope)
  if (!existing.some((item) => item.submissionId === pointer.submissionId)) {
    if (existing.length >= 500) throw new Error("The saved submission list is full. Export or clear completed receipts before starting another upload.")
    storage.setItem(documentReceiptStorageKey(scope), JSON.stringify([...existing, pointer]))
  }
}

async function hash(bytes: BufferSource): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function prepareDocumentSubmission(file: File, registration: DocumentRegistration, residency?: string): Promise<DocumentSubmissionPointer> {
  return {
    submissionId: crypto.randomUUID().replaceAll("-", ""),
    residency,
    fileName: file.name,
    checksum: await hash(await file.arrayBuffer()),
    requestHash: await hash(new TextEncoder().encode(JSON.stringify(documentRegistrationSchema.parse(registration)))),
  }
}

export function findDocumentSubmission(pointers: readonly DocumentSubmissionPointer[], candidate: DocumentSubmissionPointer): DocumentSubmissionPointer | undefined {
  return pointers.find((pointer) => pointer.fileName === candidate.fileName && pointer.checksum === candidate.checksum && pointer.requestHash === candidate.requestHash && pointer.residency === candidate.residency)
}

export async function readDocumentUploadReceipt(scope: DocumentUploadScope, pointer: DocumentSubmissionPointer): Promise<DocumentUploadReceipt | null> {
  const query = new URLSearchParams({ companyId: String(scope.companyId), submissionId: pointer.submissionId })
  if (pointer.residency) query.set("residency", pointer.residency)
  const response = await fetch(`/api/documents/blobs/receipt?${query}`, { cache: "no-store" })
  if (response.status === 404) return null
  if (!response.ok) throw new Error("The saved submission could not be checked. Your receipt is retained; refresh to try again.")
  const receipt = documentUploadReceiptSchema.parse(await response.json())
  const key = /^org-([1-9]\d*)\/([^/]+)\/([0-9a-f]{32})$/.exec(receipt.objectKey)
  if (!key || key[1] !== String(scope.organizationId) || receipt.submissionId !== pointer.submissionId || receipt.checksum !== pointer.checksum || receipt.url !== `/api/documents/blobs/object/${key[1]}/${key[2]}/${key[3]}` || (receipt.registrationState === "registered") !== (receipt.documentId !== null)) {
    throw new Error("The saved submission does not match this file or workspace")
  }
  return receipt
}

export function documentRegistrationParams(receipt: DocumentUploadReceipt): CreateDocumentParams {
  const form = receipt.registration
  return {
    name: form.name,
    description: form.description ?? undefined,
    fileName: receipt.fileName,
    fileSize: BigInt(receipt.fileSize),
    mimetype: receipt.mimetype,
    url: receipt.url,
    checksum: receipt.checksum,
    folderId: form.folderId ? BigInt(form.folderId) : undefined,
    resModel: form.resModel ?? undefined,
    resId: form.resId ? BigInt(form.resId) : undefined,
    partnerId: form.partnerId ? BigInt(form.partnerId) : undefined,
    tagIds: form.tagIds.map(BigInt),
    isFavorite: form.isFavorite,
    classificationId: form.classificationId ? BigInt(form.classificationId) : undefined,
    retentionDays: form.retentionDays ?? undefined,
    fiscalKind: form.fiscalKind ?? undefined,
    residencyRegion: form.residencyRegion ?? undefined,
    metadata: JSON.stringify({ uploadSubmissionId: receipt.submissionId }),
  }
}

export interface DocumentSubmissionPorts {
  assertCurrent(): void
  read(): Promise<DocumentUploadReceipt | null>
  create(params: CreateDocumentParams): Promise<{ resource: string; id: string }>
  index(documentId: string): Promise<unknown>
  changed(receipt: DocumentUploadReceipt): void
}

/** Recovery dispatches only the unfinished stage. File/record saves remain successful when AI fails. */
export async function resumeDocumentSubmission(ports: DocumentSubmissionPorts, options: { retryIndexing?: boolean } = {}): Promise<DocumentUploadReceipt> {
  ports.assertCurrent()
  let receipt = await ports.read()
  ports.assertCurrent()
  if (!receipt) throw new Error("Reselect the original file to resume this upload. Its submission ID is retained.")
  if (!receipt.fileSaved && receipt.bytesUploaded) {
    const response = await fetch("/api/documents/blobs/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objectKey: receipt.objectKey, checksum: receipt.checksum }) })
    if (!response.ok) throw new Error("The stored file could not be verified. Keep this receipt and retry the file check.")
    receipt = await ports.read()
    ports.assertCurrent()
  }
  if (!receipt?.fileSaved) throw new Error("Reselect the original file to finish uploading its bytes.")
  ports.changed(receipt)
  if (!receipt.documentId) {
    ports.assertCurrent()
    await ports.create(documentRegistrationParams(receipt))
    ports.assertCurrent()
    receipt = await ports.read()
    ports.assertCurrent()
    if (!receipt?.documentId) throw new Error("The file is saved; document registration is not yet confirmed. Check this receipt before retrying.")
    ports.changed(receipt)
  }
  if (receipt.indexing === "pending" || (receipt.indexing === "failed" && options.retryIndexing)) {
    ports.assertCurrent()
    try {
      await ports.index(receipt.documentId!)
      ports.assertCurrent()
      receipt = { ...receipt, indexing: "queued" }
    } catch {
      // The server captures authorized ingestion failures durably. A lost
      // response remains unknown locally until its receipt is checked again.
      ports.assertCurrent()
      receipt = { ...receipt, indexing: "pending" }
    }
    try {
      const current = await ports.read()
      ports.assertCurrent()
      if (current?.documentId === receipt.documentId) receipt = current
    } catch { ports.assertCurrent() }
    ports.changed(receipt)
  }
  return receipt
}

export async function uploadDocumentSubmission(file: File, scope: DocumentUploadScope, pointer: DocumentSubmissionPointer, registration: DocumentRegistration): Promise<void> {
  await uploadDocumentBlob({ file, companyId: scope.companyId, residency: pointer.residency, submissionId: pointer.submissionId, registration })
}
