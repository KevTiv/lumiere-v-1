/**
 * DMS object-storage upload: presign → PUT bytes → complete (sha-256 verify).
 * Returns fields ready for `create_document` / `add_document_version`.
 */

export type DocumentBlobUploadResult = {
  url: string
  objectKey: string
  fileSize: bigint
  checksum: string
  mimetype: string
  fileName: string
  /** Present for text/* / JSON / XML blobs (search index seed). */
  extractedText?: string
}

export type DocumentBlobUploadOptions = {
  file: File
  companyId?: bigint
  residency?: string
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest("SHA-256", buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; detail?: string }
    return body.error || body.detail || res.statusText
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
}

export async function uploadDocumentBlob(
  options: DocumentBlobUploadOptions,
): Promise<DocumentBlobUploadResult> {
  const { file, companyId, residency } = options
  if (!file || file.size <= 0) {
    throw new Error("A non-empty file is required")
  }

  const checksum = await sha256Hex(file)
  const contentType = file.type || "application/octet-stream"

  const presignRes = await fetch("/api/documents/blobs/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      contentType,
      contentLength: file.size,
      companyId: companyId !== undefined ? Number(companyId) : undefined,
      checksum,
      residency,
    }),
  })
  if (!presignRes.ok) {
    throw new Error(await readError(presignRes))
  }
  const presign = (await presignRes.json()) as {
    objectKey: string
    uploadUrl: string
    publicUrl: string
    headers?: Record<string, string>
  }

  const putHeaders = new Headers()
  if (presign.headers) {
    for (const [k, v] of Object.entries(presign.headers)) {
      putHeaders.set(k, v)
    }
  }
  if (!putHeaders.has("Content-Type")) {
    putHeaders.set("Content-Type", contentType)
  }

  const putRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: putHeaders,
    body: file,
  })
  if (!putRes.ok) {
    throw new Error(await readError(putRes))
  }

  const completeRes = await fetch("/api/documents/blobs/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      objectKey: presign.objectKey,
      checksum,
    }),
  })
  if (!completeRes.ok) {
    throw new Error(await readError(completeRes))
  }
  const completed = (await completeRes.json()) as {
    url: string
    objectKey: string
    fileSize: number
    checksum: string
    mimetype: string
    fileName: string
    extractedText?: string
  }

  return {
    url: completed.url,
    objectKey: completed.objectKey,
    fileSize: BigInt(completed.fileSize),
    checksum: completed.checksum,
    mimetype: completed.mimetype,
    fileName: completed.fileName,
    extractedText: completed.extractedText,
  }
}

/** Extract the first File from a ModularForm `file` field value (FileList | File | null). */
export function firstFileFromFormValue(value: unknown): File | null {
  if (value instanceof File) return value
  if (typeof FileList !== "undefined" && value instanceof FileList) {
    return value.length > 0 ? value.item(0) : null
  }
  if (Array.isArray(value) && value[0] instanceof File) return value[0]
  return null
}
