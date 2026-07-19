/**
 * Archive a rendered sale-order / account-move PDF into the DMS as a Document
 * linked via res_model / res_id.
 */

import type { CreateDocumentParams } from "@lumiere/stdb/types"
import type { DocumentPdfKind } from "@lumiere/query-hooks/hooks/templates"
import { fetchDocumentPdfBlob } from "@lumiere/query-hooks/hooks/templates"
import { uploadDocumentBlob } from "@/lib/document-blob-upload"
import { toCreateDocumentParams } from "@/lib/documents-create-params"

const RES_MODEL_BY_KIND: Record<DocumentPdfKind, string> = {
  "sale-order": "sale_order",
  "account-move": "account_move",
  "financial-report": "financial_report",
}

export async function archiveRenderedPdfAsDocument(input: {
  kind: DocumentPdfKind
  recordId: number
  companyId?: bigint
  name?: string
}): Promise<CreateDocumentParams> {
  const blob = await fetchDocumentPdfBlob(input.kind, input.recordId)
  const fileName = `${input.kind.replace(/-/g, "_")}_${input.recordId}.pdf`
  const file = new File([blob], fileName, { type: "application/pdf" })
  const uploaded = await uploadDocumentBlob({
    file,
    companyId: input.companyId,
  })
  const params = toCreateDocumentParams({
    name: input.name ?? fileName,
    fileName: uploaded.fileName,
    fileSize: uploaded.fileSize,
    mimetype: uploaded.mimetype,
    url: uploaded.url,
    checksum: uploaded.checksum,
    resModel: RES_MODEL_BY_KIND[input.kind],
    resId: BigInt(input.recordId),
  })
  if (!params) {
    throw new Error("Failed to build create_document params after PDF archive upload")
  }
  return params
}
