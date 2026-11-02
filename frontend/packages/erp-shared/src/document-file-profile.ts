export const DOCUMENT_FILE_ACCEPT =
  ".csv,.txt,.text,.log,.md,.markdown,.json,.pdf,.png,.jpg,.jpeg,.webp,.xlsx"
export const BILL_DOCUMENT_FILE_HINT =
  "Receipt or supplier document (PDF up to 16 MiB; PNG, JPEG or WebP up to 20 MiB)"
export const BILL_DOCUMENT_IMAGE_HINT =
  "Images must be non-animated, at most 4096 pixels per side and 4 megapixels."

const PROFILE_BY_EXTENSION: Record<string, { type: string; maximum: number }> =
  {
    csv: { type: "text/csv", maximum: 2_000_000 },
    txt: { type: "text/plain", maximum: 2_000_000 },
    text: { type: "text/plain", maximum: 2_000_000 },
    log: { type: "text/plain", maximum: 2_000_000 },
    md: { type: "text/markdown", maximum: 2_000_000 },
    markdown: { type: "text/markdown", maximum: 2_000_000 },
    json: { type: "application/json", maximum: 2_000_000 },
    pdf: { type: "application/pdf", maximum: 16 * 1024 * 1024 },
    png: { type: "image/png", maximum: 20 * 1024 * 1024 },
    jpg: { type: "image/jpeg", maximum: 20 * 1024 * 1024 },
    jpeg: { type: "image/jpeg", maximum: 20 * 1024 * 1024 },
    webp: { type: "image/webp", maximum: 20 * 1024 * 1024 },
    xlsx: {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      maximum: 5_000_000,
    },
  }

/** Declaration preflight only; the server independently inspects the actual bytes. */
export function documentFileContentType(
  file: Pick<File, "name" | "type" | "size">,
  purpose = "document",
): string {
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? ""
  const profile = PROFILE_BY_EXTENSION[extension]
  if (!profile)
    throw new Error(
      "Choose a supported CSV, text, JSON, PDF, PNG, JPEG, WebP or XLSX file.",
    )
  const declared = file.type.toLowerCase()
  const matches =
    !declared ||
    declared === profile.type ||
    (extension === "csv" && declared === "application/csv")
  if (!matches)
    throw new Error("The file type does not match its filename extension.")
  const branding = purpose === "branding"
  if (branding && !["image/png", "image/jpeg"].includes(profile.type))
    throw new Error("Branding requires a PNG or JPEG image.")
  const maximum = branding ? 2 * 1024 * 1024 : profile.maximum
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > maximum)
    throw new Error("The file is empty or exceeds the supported size limit.")
  return declared || profile.type
}

export function billDocumentContentType(
  file: Pick<File, "name" | "type" | "size">,
): string {
  if (!/\.(?:pdf|png|jpe?g|webp)$/i.test(file.name) || file.size <= 0) {
    throw new Error(
      "Choose a non-empty PDF up to 16 MiB, or PNG, JPEG or WebP up to 20 MiB.",
    )
  }
  const type = documentFileContentType(file)
  if (
    !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(type)
  ) {
    throw new Error("Choose a PDF, PNG, JPEG or WebP supplier document.")
  }
  return type
}
