import {
  resolveDocumentViewerManifest,
  type DocumentViewerScope,
} from "./document-viewer"
import { parseSavedImportTask, type ImportTaskFetch } from "./chat-import-task"

export type DocumentImportSource = {
  documentId: string
  versionId: string
  checksum: string
  current: boolean
}

/** Offer only managed CSV/XLSX bytes with an exact, readable version. */
export function documentImportSource(
  scope: DocumentViewerScope,
  documentId: string,
  document: unknown,
  version?: { id: string; row: unknown },
): DocumentImportSource | null {
  if (scope.companyId === null) return null
  try {
    const { source } = resolveDocumentViewerManifest({
      documents: [document],
      versions: version ? [version.row] : [],
      scope,
      documentId,
      versionId: version?.id,
    })
    if (
      !source.versionId ||
      !/\.(csv|xlsx)$/i.test(source.fileName) ||
      ![
        "text/csv",
        "application/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ].includes(source.mimeType) ||
      source.size > 5_000_000
    )
      return null
    return {
      documentId,
      versionId: source.versionId,
      checksum: source.checksum,
      current: !version,
    }
  } catch {
    return null
  }
}

export async function openDocumentImportTask(
  fetcher: ImportTaskFetch,
  companyId: number,
  source: DocumentImportSource,
  signal?: AbortSignal,
) {
  const response = await fetcher("/api/import-tasks/from-document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId, ...source }),
    signal,
  })
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as {
      error?: unknown
    } | null
    throw new Error(
      typeof error?.error === "string"
        ? error.error
        : "The import could not be opened. Try opening this version again.",
    )
  }
  const task = parseSavedImportTask(await response.json(), companyId)
  const reference =
    task.managedDocument ??
    task.preparation?.files.find(
      ({ sourceSha256, managedSelection }) =>
        sourceSha256 === source.checksum &&
        managedSelection?.documentId === source.documentId &&
        managedSelection.versionId === source.versionId,
    )?.managedSelection
  if (
    reference?.documentId !== source.documentId ||
    reference.versionId !== source.versionId ||
    task.files.length !== 1 ||
    task.files[0]?.sha256 !== source.checksum
  ) {
    throw new Error(
      "The saved import does not match the selected document version.",
    )
  }
  return task
}
