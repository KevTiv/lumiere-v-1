/**
 * The API server answers 503 with one of these codes while a release is
 * updating the import storage. Nothing was written, so the saved import task
 * stays resumable and the same action can be retried when imports resume.
 */
export const IMPORT_WRITE_PAUSE_CODES = [
  "imports_paused",
  "import_writer_schema_mismatch",
] as const

export class ImportsPausedError extends Error {
  readonly code: string
  constructor(code: string) {
    super("Imports are paused for an update")
    this.name = "ImportsPausedError"
    this.code = code
  }
}

export async function importsPausedFrom(
  response: Pick<Response, "status" | "clone">,
): Promise<ImportsPausedError | null> {
  if (response.status !== 503) return null
  try {
    const body: unknown = await response.clone().json()
    const code =
      body && typeof body === "object"
        ? (body as { code?: unknown }).code
        : undefined
    return typeof code === "string" &&
      (IMPORT_WRITE_PAUSE_CODES as readonly string[]).includes(code)
      ? new ImportsPausedError(code)
      : null
  } catch {
    return null
  }
}
