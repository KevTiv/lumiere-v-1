export const CHAT_IMPORT_MAX_FILES = 20
export const CHAT_IMPORT_MAX_FILE_BYTES = 5_000_000
export const CHAT_IMPORT_MAX_TOTAL_BYTES = 20_000_000

export type ChatImportFileProblem =
  | { code: "tooManyFiles" }
  | { code: "unsupportedFile"; fileName: string }
  | { code: "emptyFile"; fileName: string }
  | { code: "fileTooLarge"; fileName: string }
  | { code: "totalTooLarge" }

/** Client admission only; the server must enforce its own byte and format limits. */
export function validateChatImportFiles(files: readonly Pick<File, "name" | "size">[]): ChatImportFileProblem | null {
  if (files.length > CHAT_IMPORT_MAX_FILES) return { code: "tooManyFiles" }
  let totalBytes = 0
  for (const file of files) {
    if (!/\.(csv|xlsx)$/i.test(file.name)) return { code: "unsupportedFile", fileName: file.name }
    if (file.size === 0) return { code: "emptyFile", fileName: file.name }
    if (file.size > CHAT_IMPORT_MAX_FILE_BYTES) return { code: "fileTooLarge", fileName: file.name }
    totalBytes += file.size
  }
  return totalBytes > CHAT_IMPORT_MAX_TOTAL_BYTES ? { code: "totalTooLarge" } : null
}
