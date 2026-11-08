import { documentFileContentType } from "@lumiere/erp-shared/document-file-profile"

export const EXPENSE_RECEIPT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp"

/** Validate the declaration before queuing it. Storage validates the actual file bytes. */
export function expenseReceiptContentType(
  file: Pick<File, "name" | "type" | "size">,
): string {
  if (!/\.(?:pdf|png|jpe?g|webp)$/i.test(file.name)) {
    throw new Error("Choose a PDF, PNG, JPEG or WebP receipt.")
  }
  return documentFileContentType(file, "expense_receipt")
}
