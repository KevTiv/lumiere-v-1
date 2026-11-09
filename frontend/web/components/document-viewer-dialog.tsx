"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Download, RefreshCw } from "lucide-react"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@lumiere/ui/components/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import {
  SpreadsheetGrid,
  type SpreadsheetSource,
  type SpreadsheetAction,
  type SpreadsheetSelection,
} from "@lumiere/ui/documents/spreadsheet-grid"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { cn } from "@lumiere/ui/lib/utils"
import { apiFetch } from "../lib/api-fetch"
import {
  DocumentCsvError,
  DocumentViewerError,
  documentPreview,
  documentPreviewKind,
  readDocumentViewerFile,
  readDocumentViewerManifest,
  type DocumentCsvOptions,
  type DocumentPreview,
  type DocumentViewerManifest,
  type DocumentViewerScope,
} from "../lib/document-viewer"
import {
  useDocumentSelectionActions,
  type DocumentSelection,
} from "../lib/document-selection-actions"
import {
  DocumentWorkbookError,
  readDocumentWorkbook,
  type DocumentWorkbook,
} from "../lib/document-workbook"

export type DocumentViewerDialogProps = {
  organizationId: bigint
  documentId: string | null
  versionId?: string
  onOpenChange(open: boolean): void
}

/** One file viewer for Documents and ERP attachment entry points. */
export function DocumentViewerDialog({
  organizationId,
  documentId,
  versionId,
  onOpenChange,
}: DocumentViewerDialogProps) {
  const session = useErpSession()
  const { currentUser, checkPermission, permissionsReady } = useRBAC()
  const { t } = useTranslation()
  const [fullscreenTarget, setFullscreenTarget] = useState<string | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const opening = useRef<{ target: string; scope: string } | null>(null)
  const permissionRevision = useRef({ checkPermission, revision: 0 })
  if (permissionRevision.current.checkPermission !== checkPermission) {
    permissionRevision.current = {
      checkPermission,
      revision: permissionRevision.current.revision + 1,
    }
  }
  const scopeKey = JSON.stringify([
    String(organizationId),
    session.organizationId,
    session.identity,
    session.activeCompanyId,
  ])
  const target = JSON.stringify([documentId, versionId])
  const fullscreen = documentId !== null && fullscreenTarget === target
  if (documentId === null) opening.current = null
  else if (opening.current?.target !== target) {
    if (opening.current === null)
      returnFocusRef.current =
        typeof document !== "undefined" &&
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
    opening.current = { target, scope: scopeKey }
  }
  const companyId = session.activeCompanyId
  const scopeReady =
    organizationId > 0n &&
    String(session.organizationId) === String(organizationId) &&
    Boolean(session.identity) &&
    session.identity !== "unknown" &&
    session.activeCompanyReady === true &&
    (companyId === null ||
      (typeof companyId === "number" &&
        Number.isSafeInteger(companyId) &&
        companyId > 0 &&
        session.companyIds?.includes(companyId) === true))
  const permissionReady =
    permissionsReady && currentUser?.id === session.identity
  const currentScope = opening.current?.scope === scopeKey
  const canRead =
    scopeReady && permissionReady && checkPermission("document", "read").allowed
  const includeVersions = checkPermission("document_version", "read").allowed

  return (
    <Dialog
      open={documentId !== null}
      onOpenChange={(open, details) => {
        if (!open && fullscreen && details.reason === "escape-key") {
          details.cancel()
          setFullscreenTarget(null)
          return
        }
        if (!open) setFullscreenTarget(null)
        onOpenChange(open)
      }}
    >
      <DialogContent
        className={cn(
          "flex min-w-0 flex-col overflow-hidden",
          fullscreen
            ? "h-dvh max-h-dvh max-w-none gap-2 rounded-none sm:max-w-none"
            : "h-[min(90dvh,56rem)] max-h-[calc(100dvh-1rem)] sm:max-w-5xl",
        )}
        initialFocus={titleRef}
        finalFocus={() =>
          returnFocusRef.current?.isConnected ? returnFocusRef.current : true
        }
      >
        <DialogHeader className="shrink-0 pr-10">
          <DialogTitle ref={titleRef} tabIndex={-1}>
            {t("documents.viewer.title", { defaultValue: "File preview" })}
          </DialogTitle>
          <DialogDescription>
            {t("documents.viewer.description", {
              defaultValue: "View a saved file and its permitted versions.",
            })}
          </DialogDescription>
        </DialogHeader>
        {!currentScope ? (
          <p role="alert">
            {t("documents.viewer.scopeChanged", {
              defaultValue:
                "Your workspace changed. Close this preview and reopen the file.",
            })}
          </p>
        ) : !scopeReady || !permissionReady ? (
          <p role="status">
            {t("common.loading", { defaultValue: "Loading…" })}
          </p>
        ) : !canRead ? (
          <p role="alert">
            {t("documents.viewer.denied", {
              defaultValue: "You do not have access to this file.",
            })}
          </p>
        ) : documentId ? (
          <DocumentViewerBody
            key={`${scopeKey}:${target}:${permissionRevision.current.revision}:${includeVersions}`}
            documentId={documentId}
            initialVersionId={versionId}
            includeVersions={includeVersions}
            fullscreen={fullscreen}
            onSelectionComplete={() => {
              setFullscreenTarget(null)
              onOpenChange(false)
            }}
            onFullscreenChange={(next) =>
              setFullscreenTarget(next ? target : null)
            }
            scope={{
              organizationId,
              companyId:
                typeof companyId === "number" ? BigInt(companyId) : null,
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

type ViewerPreview =
  | Exclude<DocumentPreview, { kind: "csv" }>
  | { kind: "csv-source"; bytes: Uint8Array }
  | { kind: "spreadsheet"; workbook: DocumentWorkbook }
  | { kind: "preview-error"; error: unknown }

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

type ViewerState =
  | { request: string; status: "loading" }
  | { request: string; status: "error"; error: unknown }
  | {
      request: string
      status: "ready"
      manifest: DocumentViewerManifest
      preview: ViewerPreview
      objectUrl?: string
    }

type DownloadAttempt = {
  controller: AbortController
  url?: string
  timer?: ReturnType<typeof setTimeout>
}

function errorMessage(
  error: unknown,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (error instanceof DocumentWorkbookError) {
    switch (error.reason) {
      case "unsupported":
        return t("documents.spreadsheet.unsupported", {
          defaultValue: "This workbook format cannot be previewed.",
        })
      case "unreadable":
        return t("documents.spreadsheet.unreadable", {
          defaultValue: "The workbook could not be read as a spreadsheet.",
        })
      case "workerUnavailable":
        return t("documents.spreadsheet.unavailable", {
          defaultValue: "Spreadsheet preview is temporarily unavailable.",
        })
      case "rangeTooLarge":
        return t("documents.spreadsheet.rangeTooLarge", {
          defaultValue: "This part of the workbook exceeds the preview limit.",
        })
    }
  }
  const code = error instanceof DocumentViewerError ? error.code : "request"
  switch (code) {
    case "denied":
      return t("documents.viewer.denied", {
        defaultValue: "You do not have access to this file.",
      })
    case "unavailable":
      return t("documents.viewer.unavailable", {
        defaultValue:
          "This file or version is unavailable in your current access scope.",
      })
    case "integrity":
      return t("documents.viewer.changed", {
        defaultValue:
          "The saved file details changed. Reload the preview before continuing.",
      })
    case "tooLarge":
      return t("documents.viewer.tooLarge", {
        defaultValue: "This file exceeds the preview limit.",
      })
    case "invalid":
      return t("documents.viewer.invalid", {
        defaultValue: "The file preview could not be verified.",
      })
    default:
      return t("documents.viewer.failed", {
        defaultValue: "The file could not be loaded. Try again.",
      })
  }
}

function previewOnlyFailure(error: unknown) {
  return (
    error instanceof DocumentViewerError &&
    (error.code === "invalid" ||
      error.code === "tooLarge" ||
      error.code === "request")
  )
}

function DocumentViewerBody({
  scope,
  documentId,
  initialVersionId,
  includeVersions,
  fullscreen,
  onFullscreenChange,
  onSelectionComplete,
}: {
  scope: DocumentViewerScope
  documentId: string
  initialVersionId?: string
  includeVersions: boolean
  fullscreen: boolean
  onFullscreenChange(fullscreen: boolean): void
  onSelectionComplete(): void
}) {
  const selectionActions = useDocumentSelectionActions()
  const { t } = useTranslation()
  const [selectedVersion, setSelectedVersion] = useState(
    initialVersionId ?? "current",
  )
  const [reload, setReload] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const [state, setState] = useState<ViewerState>({
    request: "",
    status: "loading",
  })
  const download = useRef<DownloadAttempt | null>(null)
  const request = `${selectedVersion}:${reload}`
  const requestRef = useRef(request)
  requestRef.current = request
  const active =
    state.request === request ? state : { request, status: "loading" as const }

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    setState({ request, status: "loading" })
    const load = async () => {
      const manifest = await readDocumentViewerManifest({
        scope,
        documentId,
        versionId: selectedVersion === "current" ? undefined : selectedVersion,
        includeVersions,
        fetcher: apiFetch,
        signal: controller.signal,
      })
      let preview: ViewerPreview = { kind: "unsupported" }
      const mimeType = manifest.source.mimeType
      const kind = documentPreviewKind(mimeType)
      if (mimeType === XLSX_MIME) {
        try {
          const workbook = await readDocumentWorkbook(
            manifest.source,
            scope,
            apiFetch,
            controller.signal,
            selectedVersion === "current",
          )
          preview = { kind: "spreadsheet", workbook }
        } catch (error) {
          if (!previewOnlyFailure(error)) throw error
          preview = { kind: "preview-error", error }
        }
      } else if (kind !== "unsupported") {
        const file = await readDocumentViewerFile(
          manifest.source,
          apiFetch,
          controller.signal,
        )
        if (kind === "csv") {
          preview = { kind: "csv-source", bytes: file.bytes }
        } else {
          const parsed = documentPreview(mimeType, file.bytes)
          if (parsed.kind !== "csv") preview = parsed
          if (
            !controller.signal.aborted &&
            (preview.kind === "image" || preview.kind === "pdf")
          )
            objectUrl = URL.createObjectURL(file.blob)
        }
      }
      if (!controller.signal.aborted)
        setState({ request, status: "ready", manifest, preview, objectUrl })
    }
    void load().catch((error: unknown) => {
      if (!controller.signal.aborted)
        setState({ request, status: "error", error })
    })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [
    scope.organizationId,
    scope.companyId,
    documentId,
    includeVersions,
    selectedVersion,
    reload,
    request,
  ])

  useEffect(() => {
    const refresh = () => setReload((value) => value + 1)
    const visibility = () => {
      if (document.visibilityState === "visible") refresh()
    }
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [])

  useEffect(() => {
    setDownloading(false)
    return () => {
      const attempt = download.current
      attempt?.controller.abort()
      if (attempt?.url) URL.revokeObjectURL(attempt.url)
      if (attempt?.timer) clearTimeout(attempt.timer)
      download.current = null
    }
  }, [request])

  const downloadFile = async () => {
    if (active.status !== "ready" || download.current) return
    const shown = active.manifest.source
    const attempt: DownloadAttempt = {
      controller: new AbortController(),
    }
    download.current = attempt
    setDownloading(true)
    try {
      const manifest = await readDocumentViewerManifest({
        scope,
        documentId,
        versionId: selectedVersion === "current" ? undefined : selectedVersion,
        includeVersions,
        fetcher: apiFetch,
        signal: attempt.controller.signal,
      })
      const current = manifest.source
      if (
        current.url !== shown.url ||
        current.versionId !== shown.versionId ||
        current.checksum !== shown.checksum ||
        current.size !== shown.size ||
        current.mimeType !== shown.mimeType
      )
        throw new DocumentViewerError("integrity")
      const file = await readDocumentViewerFile(
        current,
        apiFetch,
        attempt.controller.signal,
      )
      if (attempt.controller.signal.aborted || requestRef.current !== request)
        return
      attempt.url = URL.createObjectURL(file.blob)
      const link = document.createElement("a")
      link.href = attempt.url
      link.download = current.fileName
      document.body.append(link)
      link.click()
      link.remove()
      // Revoke after the browser has accepted the download; unmount also cleans up.
      attempt.timer = setTimeout(() => {
        if (attempt.url) URL.revokeObjectURL(attempt.url)
        if (download.current === attempt) download.current = null
      }, 1000)
    } catch (error) {
      if (
        !attempt.controller.signal.aborted &&
        requestRef.current === request
      ) {
        if (active.objectUrl) URL.revokeObjectURL(active.objectUrl)
        setState({ request, status: "error", error })
      }
    } finally {
      if (!attempt.controller.signal.aborted) setDownloading(false)
      if (!attempt.url && download.current === attempt) download.current = null
    }
  }

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
      data-testid="document-viewer"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          {active.status === "ready" ? (
            <>
              <h3 className="break-words font-medium">
                {active.manifest.name}
              </h3>
              <p className="break-all text-xs text-muted-foreground">
                {active.manifest.source.fileName}
              </p>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {active.status === "error" && selectedVersion !== "current" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSelectedVersion("current")}
            >
              {t("documents.viewer.currentVersion", {
                defaultValue: "Current version",
              })}
            </Button>
          ) : null}
          {active.status === "ready" &&
          includeVersions &&
          active.manifest.versions.length > 0 ? (
            <Select
              value={selectedVersion}
              onValueChange={setSelectedVersion}
              disabled={downloading}
            >
              <SelectTrigger
                className="w-44"
                aria-label={t("documents.viewer.version", {
                  defaultValue: "File version",
                })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">
                  {t("documents.viewer.currentVersion", {
                    defaultValue: "Current version",
                  })}
                </SelectItem>
                {active.manifest.versions.map((version) => (
                  <SelectItem
                    key={version.versionId}
                    value={version.versionId!}
                  >
                    {t("documents.viewer.versionNumber", {
                      defaultValue: "Version {{number}}",
                      number: version.versionNumber,
                    })}
                    {version.isCurrent
                      ? ` (${t("documents.viewer.current", { defaultValue: "current" })})`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={active.status === "loading" || downloading}
            onClick={() => setReload((value) => value + 1)}
          >
            <RefreshCw aria-hidden="true" />
            {t("documents.viewer.reload", { defaultValue: "Reload preview" })}
          </Button>
          {active.status === "ready" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={downloading}
              onClick={() => void downloadFile()}
            >
              <Download aria-hidden="true" />
              {downloading
                ? t("documents.viewer.downloading", {
                    defaultValue: "Preparing download…",
                  })
                : t("documents.viewer.download", {
                    defaultValue: "Download file",
                  })}
            </Button>
          ) : null}
        </div>
      </div>
      {active.status === "loading" ? (
        <p role="status">
          {t("documents.viewer.loading", {
            defaultValue: "Checking access and loading the file…",
          })}
        </p>
      ) : active.status === "error" ? (
        <p role="alert" className="text-destructive">
          {errorMessage(active.error, t)}
        </p>
      ) : (
        <ActivePreview
          key={request}
          preview={active.preview}
          objectUrl={active.objectUrl}
          source={active.manifest.source}
          fullscreen={fullscreen}
          onFullscreenChange={onFullscreenChange}
          onReadError={(error) => {
            if (requestRef.current !== request) return
            if (previewOnlyFailure(error)) {
              setState({
                ...active,
                preview: { kind: "preview-error", error },
              })
            } else {
              setState({ request, status: "error", error })
            }
          }}
          onSelectionAction={
            selectionActions && active.manifest.source.versionId
              ? async (action, selection, signal, parsing) => {
                  await selectionActions(
                    action,
                    {
                      ...scope,
                      source: active.manifest.source,
                      includeVersions,
                      ...selection,
                      parsing,
                    },
                    signal,
                  )
                  if (!signal.aborted && requestRef.current === request)
                    onSelectionComplete()
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

const TEXT_PAGE_SIZE = 80_000

type ActivePreviewProps = {
  preview: ViewerPreview
  objectUrl?: string
  source: DocumentViewerManifest["source"]
  fullscreen: boolean
  onFullscreenChange(fullscreen: boolean): void
  onReadError(error: unknown): void
  onSelectionAction?(
    action: SpreadsheetAction,
    selection: SpreadsheetSelection,
    signal: AbortSignal,
    parsing?: DocumentSelection["parsing"],
  ): Promise<void>
}

function ActivePreview({
  preview,
  objectUrl,
  source,
  ...grid
}: ActivePreviewProps) {
  const { t } = useTranslation()
  const workbook = preview.kind === "spreadsheet" ? preview.workbook : null
  const workbookSource = useMemo<SpreadsheetSource | null>(
    () =>
      workbook && {
        sheets: workbook.sheets,
        readRange: workbook.readRange,
        search: (sheetId, query, after, direction, signal) =>
          workbook.search(sheetId, query, direction, after, signal),
      },
    [workbook],
  )

  if (preview.kind === "preview-error") {
    return (
      <div className="rounded-md border bg-muted/20 p-4 text-sm">
        <p role="alert" className="font-medium text-destructive">
          {errorMessage(preview.error, t)}
        </p>
        <p className="mt-1 text-muted-foreground">
          {t("documents.spreadsheet.previewRecovery", {
            defaultValue:
              "Reload the preview to retry, or download the original file.",
          })}
        </p>
      </div>
    )
  }
  if (workbookSource)
    return (
      <SpreadsheetGrid
        {...grid}
        source={workbookSource}
        label={t("documents.spreadsheet.xlsxPreview", {
          defaultValue: "Spreadsheet preview",
        })}
      />
    )
  if (preview.kind === "csv-source")
    return (
      <CsvPreview {...grid} bytes={preview.bytes} mimeType={source.mimeType} />
    )
  if (preview.kind === "spreadsheet") return null
  return (
    <FilePreview
      preview={preview}
      objectUrl={objectUrl}
      fileName={source.fileName}
    />
  )
}

function CsvPreview({
  bytes,
  mimeType,
  onSelectionAction,
  ...grid
}: Omit<ActivePreviewProps, "preview" | "objectUrl" | "source"> & {
  bytes: Uint8Array
  mimeType: string
}) {
  const { t } = useTranslation()
  const [delimiter, setDelimiter] =
    useState<NonNullable<DocumentCsvOptions["delimiter"]>>("auto")
  const [encoding, setEncoding] =
    useState<NonNullable<DocumentCsvOptions["encoding"]>>("auto")
  const [headings, setHeadings] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const parsed = useMemo(() => {
    try {
      const preview = documentPreview(mimeType, bytes, { delimiter, encoding })
      return preview.kind === "csv"
        ? { preview }
        : { error: new DocumentViewerError("invalid") }
    } catch (error) {
      return { error }
    }
  }, [bytes, mimeType, delimiter, encoding])
  const preview = parsed.preview
  const sheetName = t("documents.spreadsheet.csvSheet", {
    defaultValue: "CSV records",
  })
  const source = useMemo<SpreadsheetSource | null>(() => {
    if (!preview) return null
    const { rows, columns } = preview
    return {
      sheets: [
        {
          id: "csv",
          name: sheetName,
          rowCount: rows.length,
          columnCount: columns,
        },
      ],
      async readRange(_sheet, rect, signal) {
        signal.throwIfAborted()
        const cells = []
        for (
          let row = rect.rowStart;
          row < rect.rowStart + rect.rowCount;
          row++
        ) {
          for (
            let column = rect.columnStart;
            column < rect.columnStart + rect.columnCount;
            column++
          ) {
            const value = rows[row]?.[column]
            if (value !== undefined && value !== "")
              cells.push({ row, column, displayValue: value, kind: "text" })
          }
        }
        return { cells }
      },
      async search(_sheet, query, after, direction, signal) {
        signal.throwIfAborted()
        const needle = query.toLowerCase()
        const step = direction === "next" ? 1 : -1
        const size = rows.length * columns
        const cursor = after
          ? after.row * columns + after.column
          : direction === "next"
            ? -1
            : size
        for (let offset = 1; offset <= size; offset++) {
          const index = cursor + offset * step
          const wrapped = index < 0 || index >= size
          const position = (index + size) % size
          const row = Math.floor(position / columns)
          const column = position % columns
          if (rows[row]?.[column]?.toLowerCase().includes(needle))
            return { match: { row, column }, wrapped }
        }
        return { match: null, wrapped: false }
      },
    }
  }, [preview, sheetName])

  const optionsLabel = t("documents.spreadsheet.csvOptions", {
    defaultValue: "CSV options",
  })
  const delimiterLabel = t("documents.spreadsheet.delimiter", {
    defaultValue: "Delimiter",
  })
  const encodingLabel = t("documents.spreadsheet.encoding", {
    defaultValue: "Encoding",
  })
  const automatic = t("documents.spreadsheet.automatic", {
    defaultValue: "Auto detect",
  })
  const delimiters = [
    { value: "auto", label: automatic },
    {
      value: ",",
      label: t("documents.spreadsheet.comma", { defaultValue: "Comma" }),
    },
    {
      value: ";",
      label: t("documents.spreadsheet.semicolon", {
        defaultValue: "Semicolon",
      }),
    },
    {
      value: "\t",
      label: t("documents.spreadsheet.tab", { defaultValue: "Tab" }),
    },
  ] as const
  const encodings = [
    { value: "auto", label: automatic },
    { value: "utf-8", label: "UTF-8" },
    { value: "utf-16le", label: "UTF-16 LE" },
    { value: "utf-16be", label: "UTF-16 BE" },
    { value: "windows-1252", label: "Windows-1252" },
  ] as const
  const settings = (
    <div
      role="group"
      aria-label={optionsLabel}
      className="flex flex-wrap items-center gap-2 text-xs"
    >
      <label className="flex items-center gap-1.5">
        {delimiterLabel}
        <Select
          value={delimiter}
          onValueChange={(value) => {
            const match = delimiters.find((choice) => choice.value === value)
            if (match) setDelimiter(match.value)
          }}
        >
          <SelectTrigger aria-label={delimiterLabel} className="h-8 max-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {delimiters.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-1.5">
        {encodingLabel}
        <Select
          value={encoding}
          onValueChange={(value) => {
            const match = encodings.find((choice) => choice.value === value)
            if (match) setEncoding(match.value)
          }}
        >
          <SelectTrigger aria-label={encodingLabel} className="h-8 max-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {encodings.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex min-h-8 items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={headings}
          onChange={(event) => setHeadings(event.target.checked)}
        />
        {t("documents.spreadsheet.firstRowHeadings", {
          defaultValue: "Use first row as headings",
        })}
      </label>
    </div>
  )
  if (!preview || !source) {
    const diagnostic =
      parsed.error instanceof DocumentCsvError ? parsed.error.diagnostic : null
    const message =
      diagnostic?.code === "unknownEncoding" ||
      diagnostic?.code === "invalidEncoding"
        ? t("documents.spreadsheet.csvEncodingError", {
            defaultValue:
              "The CSV could not be decoded. Choose a different encoding.",
          })
        : diagnostic?.code === "unexpectedQuote" ||
            diagnostic?.code === "unterminatedQuote"
          ? t("documents.spreadsheet.csvQuoteError", {
              defaultValue:
                "Invalid CSV quoting at row {{row}}, column {{column}}. Check the delimiter or download the original file.",
              row: diagnostic.row,
              column: diagnostic.column,
            })
          : errorMessage(parsed.error, t)
    return (
      <div className="space-y-3 rounded-md border bg-muted/20 p-3">
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
        {settings}
      </div>
    )
  }
  const ambiguous = preview.diagnostics.some(
    (item) => item.code === "ambiguousDelimiter",
  )
  return (
    <SpreadsheetGrid
      key={JSON.stringify([delimiter, encoding])}
      {...grid}
      label={t("documents.viewer.csv", { defaultValue: "CSV preview" })}
      source={source}
      columnHeading={
        headings ? (column) => preview.rows[0]?.[column] : undefined
      }
      onSelectionAction={
        onSelectionAction
          ? (action, selection, signal) =>
              onSelectionAction(
                action,
                { ...selection, sheetName: "CSV" },
                signal,
                {
                  delimiter: preview.delimiter,
                  encoding: preview.encoding,
                  ...(headings ? { headerRow: 1 } : {}),
                },
              )
          : undefined
      }
      options={
        <>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={showOptions}
            onClick={() => setShowOptions((shown) => !shown)}
          >
            {optionsLabel}
          </Button>
          {showOptions ? (
            <div className="order-last w-full">{settings}</div>
          ) : null}
          {ambiguous ? (
            <p
              role="status"
              className="order-last w-full text-xs text-muted-foreground"
            >
              {t("documents.spreadsheet.ambiguousDelimiter", {
                defaultValue:
                  "More than one delimiter fits. Use CSV options to verify how the columns are separated.",
              })}
            </p>
          ) : null}
        </>
      }
    />
  )
}

function FilePreview({
  preview,
  objectUrl,
  fileName,
}: {
  preview: Exclude<DocumentPreview, { kind: "csv" }>
  objectUrl?: string
  fileName: string
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(0)
  if (preview.kind === "image")
    return (
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-md border bg-muted/20 p-3">
        <img
          src={objectUrl}
          alt={fileName}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    )
  if (preview.kind === "pdf")
    return (
      <object
        data={objectUrl}
        type="application/pdf"
        aria-label={fileName}
        className="min-h-64 w-full flex-1 rounded-md border"
        data-testid="document-viewer-pdf"
      >
        <p>
          {t("documents.viewer.pdfFallback", {
            defaultValue:
              "Your browser cannot show this PDF. Use Download file to open it.",
          })}
        </p>
      </object>
    )
  if (preview.kind === "unsupported")
    return (
      <p role="status">
        {t("documents.viewer.unsupported", {
          defaultValue: "A preview is not available for this format yet.",
        })}
      </p>
    )
  const pages = Math.max(1, Math.ceil(preview.text.length / TEXT_PAGE_SIZE))
  const start = page * TEXT_PAGE_SIZE
  return (
    <>
      <div
        className="min-h-0 min-w-0 flex-1 overflow-auto rounded-md border"
        tabIndex={0}
        aria-label={t("documents.viewer.content", {
          defaultValue: "File content",
        })}
      >
        <pre className="m-0 whitespace-pre-wrap break-words p-4 font-mono text-xs">
          {preview.text.slice(start, start + TEXT_PAGE_SIZE)}
        </pre>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-xs text-muted-foreground">
          {t("documents.viewer.pages", {
            defaultValue: "Page {{page}} of {{total}}",
            page: page + 1,
            total: pages,
          })}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            {t("common.previous", { defaultValue: "Previous" })}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page + 1 >= pages}
            onClick={() => setPage((value) => value + 1)}
          >
            {t("common.next", { defaultValue: "Next" })}
          </Button>
        </div>
      </div>
    </>
  )
}
