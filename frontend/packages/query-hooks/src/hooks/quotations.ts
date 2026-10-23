"use client"

import { responseErrorMessage } from "@lumiere/api-client/response-error"
import { apiFetch } from "../http"

export interface QuotationDocumentInput {
  organizationId: number
  companyId: string
  orderId: string
  templateId: string
}

export interface QuotationDocumentPreview {
  html: string
  revision: string
  templateId: string
  templateName: string
  orderId: string
  reference: string
}

export interface GeneratedQuotationDocument {
  documentId: string
  downloadUrl: string
  fileName: string
  checksum: string
  revision: string
}

type QuotationTransport = (path: string, init?: RequestInit) => Promise<Response>

function exactId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n
}

function revision(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

function quotationPath(input: QuotationDocumentInput, action: "preview" | "generate") {
  if (!Number.isSafeInteger(input.organizationId) || input.organizationId <= 0 ||
    !exactId(input.companyId) || !exactId(input.orderId) || !exactId(input.templateId)) {
    throw new Error("The quotation's organization, company or record is no longer available.")
  }
  return `/api/documents/quotations/${input.orderId}/${action}`
}

interface PreviewWire {
  html?: unknown
  revision?: unknown
  templateId?: unknown
  templateName?: unknown
  orderId?: unknown
  reference?: unknown
}

/** The server compiles the saved project and resolves only authorized quotation fields. */
export async function previewQuotationDocument(
  input: QuotationDocumentInput,
  signal?: AbortSignal,
  fetcher: QuotationTransport = apiFetch,
): Promise<QuotationDocumentPreview> {
  const response = await fetcher(quotationPath(input, "preview"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId: input.companyId, templateId: input.templateId }),
    signal,
  })
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  const body: PreviewWire | null = await response.json()
  if (!body || typeof body.html !== "string" || new TextEncoder().encode(body.html).length > 6 * 1024 * 1024 ||
    !revision(body.revision) || body.templateId !== input.templateId || body.orderId !== input.orderId ||
    typeof body.templateName !== "string" || typeof body.reference !== "string") {
    throw new Error("The server returned an invalid quotation preview.")
  }
  return { html: body.html, revision: body.revision, templateId: input.templateId,
    templateName: body.templateName, orderId: input.orderId, reference: body.reference }
}

interface GeneratedWire {
  documentId?: unknown
  downloadUrl?: unknown
  fileName?: unknown
  checksum?: unknown
  revision?: unknown
}

/** Generated exports are pinned to a managed object in the current organization. */
export function isQuotationDownloadUrl(value: unknown, organizationId: number, checksum: string): value is string {
  if (typeof value !== "string" || !revision(checksum)) return false
  const match = value.match(/^\/api\/documents\/blobs\/object\/([1-9]\d*)\/([a-z][a-z0-9-]*)\/([a-zA-Z0-9-]+)\?sha256=([a-f0-9]{64})$/)
  return match !== null && match[1] === String(organizationId) && match[4] === checksum
}

/** Save the exact reviewed revision; a concurrent record or template edit is rejected. */
export async function generateQuotationDocument(
  input: QuotationDocumentInput,
  expectedRevision: string,
  fetcher: QuotationTransport = apiFetch,
): Promise<GeneratedQuotationDocument> {
  const path = quotationPath(input, "generate")
  if (!revision(expectedRevision)) throw new Error("Preview the quotation before saving a PDF.")
  const response = await fetcher(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId: input.companyId, templateId: input.templateId, expectedRevision }),
  })
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  const body: GeneratedWire | null = await response.json()
  if (!body || !exactId(body.documentId) || !revision(body.checksum) || body.revision !== expectedRevision ||
    !isQuotationDownloadUrl(body.downloadUrl, input.organizationId, body.checksum) ||
    typeof body.fileName !== "string" || !/^[a-zA-Z0-9_.-]+\.pdf$/.test(body.fileName)) {
    throw new Error("The saved quotation could not be confirmed. Check Documents before trying again.")
  }
  return { documentId: body.documentId, downloadUrl: body.downloadUrl, fileName: body.fileName,
    checksum: body.checksum, revision: expectedRevision }
}

/** Download saved bytes; this never invokes the template renderer again. */
export async function downloadQuotationDocument(output: GeneratedQuotationDocument, organizationId: number, signal?: AbortSignal): Promise<void> {
  if (!isQuotationDownloadUrl(output.downloadUrl, organizationId, output.checksum)) {
    throw new Error("The saved quotation download is unavailable.")
  }
  const response = await apiFetch(output.downloadUrl, { signal })
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  const blob = await response.blob()
  signal?.throwIfAborted()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = output.fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
