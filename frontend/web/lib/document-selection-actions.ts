"use client"

import { createContext, useContext } from "react"
import { apiFetch } from "./api-fetch"
import {
  readDocumentViewerFile,
  readDocumentViewerManifest,
  type DocumentViewerSource,
} from "./document-viewer"
import {
  importPreparationSchema,
  type ImportPreparation,
} from "./import-preparation"

export type DocumentSelectionAction = "explain" | "check" | "prepare"

export type DocumentSelection = {
  organizationId: bigint
  companyId: bigint | null
  source: Pick<
    DocumentViewerSource,
    | "documentId"
    | "versionId"
    | "fileName"
    | "mimeType"
    | "checksum"
    | "url"
    | "size"
  >
  includeVersions: boolean
  sheetName: string
  range: {
    firstRow: number
    lastRow: number
    firstColumn: number
    lastColumn: number
  }
  text: string
  parsing?: {
    delimiter?: "," | ";" | "\t" | "|"
    encoding?: string
    headerRow?: number
  }
}

export type DocumentSelectionDraft = {
  scope: string
  action: "explain" | "check"
  selection: DocumentSelection
  id: string
  text: string
}

export const DocumentSelectionActionsContext = createContext<
  | ((
      action: DocumentSelectionAction,
      selection: DocumentSelection,
      signal?: AbortSignal,
    ) => Promise<void>)
  | null
>(null)

export function useDocumentSelectionActions() {
  return useContext(DocumentSelectionActionsContext)
}

export function documentSelectionMatchesScope(
  selection: DocumentSelection,
  organizationId: number | null | undefined,
  companyId: number | null | undefined,
): boolean {
  return (
    organizationId != null &&
    companyId != null &&
    String(selection.organizationId) === String(organizationId) &&
    (selection.companyId === null ||
      String(selection.companyId) === String(companyId))
  )
}

function documentSelectionSheetName(selection: DocumentSelection): string {
  return /^(?:text|application)\/csv$/.test(selection.source.mimeType)
    ? "CSV"
    : selection.sheetName
}

export function documentSelectionLabel(selection: DocumentSelection): string {
  const { firstRow, lastRow, firstColumn, lastColumn } = selection.range
  return `${selection.source.fileName} · ${selection.sheetName} · R${firstRow}C${firstColumn}:R${lastRow}C${lastColumn}`
}

export function documentSelectionQuestion(
  action: "explain" | "check",
  selection: DocumentSelection,
): string {
  return `${action === "explain" ? "Explain" : "Check for issues in"} the selected cells (${documentSelectionLabel(selection)}).`
}

export function documentSelectionAnalysisReference(
  selection: DocumentSelection,
) {
  const { source, range, parsing } = selection
  if (!source.versionId)
    throw new Error("A saved document version is required.")
  const rows = range.lastRow - range.firstRow + 1
  const columns = range.lastColumn - range.firstColumn + 1
  if (
    rows <= 0 ||
    columns <= 0 ||
    rows > 200 ||
    columns > 100 ||
    rows * columns > 5000
  )
    throw new Error("Select a smaller spreadsheet range for the assistant.")
  return {
    documentId: source.documentId,
    versionId: source.versionId,
    current: !selection.includeVersions,
    checksum: source.checksum,
    sheetName: documentSelectionSheetName(selection),
    ...range,
    ...parsing,
  }
}

/** Renew access to the exact managed bytes before handing a selection to another workflow. */
export async function readDocumentSelectionFile(
  selection: DocumentSelection,
  signal: AbortSignal,
): Promise<Blob> {
  const { source, organizationId, companyId, includeVersions } = selection
  const manifest = await readDocumentViewerManifest({
    scope: { organizationId, companyId },
    documentId: source.documentId,
    versionId: includeVersions ? source.versionId : undefined,
    includeVersions,
    fetcher: apiFetch,
    signal,
  })
  const actual = manifest.source
  if (
    !source.versionId ||
    actual.versionId !== source.versionId ||
    actual.checksum !== source.checksum ||
    actual.fileName !== source.fileName ||
    actual.url !== source.url ||
    actual.mimeType !== source.mimeType ||
    actual.size !== source.size
  ) {
    throw new Error(
      "The selected document version is unavailable. Reopen the file and select its cells again.",
    )
  }
  return (await readDocumentViewerFile(actual, apiFetch, signal)).blob
}

export function documentSelectionPreparation(
  selection: DocumentSelection,
): ImportPreparation {
  const { source, range, parsing } = selection
  if (!source.versionId)
    throw new Error("A saved document version is required.")
  if (!/\.(csv|xlsx)$/i.test(source.fileName) || source.size > 5_000_000)
    throw new Error(
      "Choose a CSV or XLSX version of at most 5 MB for import preparation.",
    )
  const result = importPreparationSchema.safeParse({
    version: 1,
    files: [
      {
        fileName: source.fileName,
        sourceSha256: source.checksum,
        delimiter: parsing?.delimiter,
        managedSelection: {
          documentId: source.documentId,
          versionId: source.versionId,
          current: !selection.includeVersions,
          sheetName: documentSelectionSheetName(selection),
          ...range,
          encoding: parsing?.encoding,
          headerRow: parsing?.headerRow,
        },
      },
    ],
  })
  if (!result.success)
    throw new Error(
      "Select up to 5,000 cells within the first 200 source columns for preparation.",
    )
  return result.data
}
