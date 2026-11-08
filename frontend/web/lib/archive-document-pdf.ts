/** Save a rendered ERP PDF through the same recoverable document submission. */
import type { DocumentPdfKind } from "@lumiere/query-hooks/hooks/templates"
import { fetchDocumentPdfBlob } from "@lumiere/query-hooks/hooks/templates"
import type { GeneratedDocumentSubmission, DocumentUploadReceipt } from "./document-upload-receipts"

const RES_MODEL_BY_KIND: Record<DocumentPdfKind, string> = {
  "sale-order": "sale_order",
  "account-move": "account_move",
  "financial-report": "financial_report",
}

export async function archiveRenderedPdfAsDocument(input: {
  kind: DocumentPdfKind
  recordId: number
  name?: string
  saveGenerated(input: GeneratedDocumentSubmission): Promise<DocumentUploadReceipt>
}): Promise<DocumentUploadReceipt> {
  const fileName = `${input.kind.replace(/-/g, "_")}_${input.recordId}.pdf`
  return input.saveGenerated({
    intentKey: `pdf:${input.kind}:${input.recordId}`,
    registration: {
      name: input.name ?? fileName,
      resModel: RES_MODEL_BY_KIND[input.kind], resId: String(input.recordId),
      tagIds: [], isFavorite: false,
    },
    createFile: async () => new File([await fetchDocumentPdfBlob(input.kind, input.recordId)], fileName, { type: "application/pdf" }),
  })
}
