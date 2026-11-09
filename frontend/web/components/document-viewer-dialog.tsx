"use client"

import { useEffect, useRef, useState } from "react"
import { Download, ExternalLink, RefreshCw } from "lucide-react"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { FileIdentity } from "@lumiere/ui/components/file-identity"
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
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { apiFetch } from "../lib/api-fetch"
import {
  DocumentViewerError,
  documentPreview,
  documentPreviewKind,
  readDocumentOfficePreview,
  readDocumentViewerFile,
  readDocumentViewerManifest,
  type DocumentPreview,
  type DocumentViewerManifest,
  type DocumentViewerScope,
  type OfficeDocumentPreview,
} from "../lib/document-viewer"

export type DocumentViewerDialogProps = {
  organizationId: bigint
  documentId: string | null
  versionId?: string
  recordHref?: string
  onOpenChange(open: boolean): void
}

/** One file viewer for Documents and ERP attachment entry points. */
export function DocumentViewerDialog({
  organizationId,
  documentId,
  versionId,
  recordHref,
  onOpenChange,
}: DocumentViewerDialogProps) {
  const session = useErpSession()
  const { currentUser, checkPermission, permissionsReady } = useRBAC()
  const { t } = useTranslation()
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
    <Dialog open={documentId !== null} onOpenChange={onOpenChange}>
      <DialogContent
        size="document"
        className="flex h-[min(90dvh,56rem)] min-w-0 flex-col overflow-hidden"
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
            recordHref={recordHref}
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

type ViewerState =
  | { request: string; status: "loading" }
  | { request: string; status: "error"; error: unknown }
  | {
      request: string
      status: "ready"
      manifest: DocumentViewerManifest
      preview: DocumentPreview
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

function DocumentViewerBody({
  scope,
  documentId,
  initialVersionId,
  includeVersions,
  recordHref,
}: {
  scope: DocumentViewerScope
  documentId: string
  initialVersionId?: string
  includeVersions: boolean
  recordHref?: string
}) {
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
      let preview: DocumentPreview = { kind: "unsupported" }
      const kind = documentPreviewKind(manifest.source.mimeType)
      if (kind === "xlsx" || kind === "docx") {
        preview = await readDocumentOfficePreview(
          manifest.source,
          scope,
          apiFetch,
          controller.signal,
        )
      } else if (kind !== "unsupported") {
        const file = await readDocumentViewerFile(
          manifest.source,
          apiFetch,
          controller.signal,
        )
        preview = documentPreview(manifest.source.mimeType, file.bytes)
        if (
          !controller.signal.aborted &&
          (preview.kind === "image" || preview.kind === "pdf")
        )
          objectUrl = URL.createObjectURL(file.blob)
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
        {active.status === "ready" ? (
          <FileIdentity
            variant="header"
            className="min-w-0 flex-1 basis-48"
            title={active.manifest.name}
            fileName={active.manifest.source.fileName}
            mimetype={active.manifest.source.mimeType}
            size={active.manifest.source.size}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {recordHref && active.status === "ready" ? (
            <Button
              variant="outline"
              size="sm"
              render={<a href={recordHref} />}
              nativeButton={false}
            >
              <ExternalLink aria-hidden />
              {t("documents.viewer.details", {
                defaultValue: "Document details",
              })}
            </Button>
          ) : null}
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
        <FilePreview
          key={request}
          preview={active.preview}
          objectUrl={active.objectUrl}
          fileName={active.manifest.source.fileName}
        />
      )}
    </div>
  )
}

const CSV_PAGE_SIZE = 50
const TEXT_PAGE_SIZE = 80_000

function columnLabel(index: number): string {
  let value = index + 1
  let label = ""
  while (value > 0) {
    value--
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26)
  }
  return label
}

function FilePreview({
  preview,
  objectUrl,
  fileName,
}: {
  preview: DocumentPreview
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
  if (preview.kind === "xlsx") return <WorkbookPreview preview={preview} />
  if (preview.kind === "docx") return <WordPreview preview={preview} />
  if (preview.kind === "unsupported")
    return (
      <p role="status">
        {t("documents.viewer.unsupported", {
          defaultValue: "A preview is not available for this format yet.",
        })}
      </p>
    )
  const pages = Math.max(
    1,
    Math.ceil(
      preview.kind === "csv"
        ? preview.rows.length / CSV_PAGE_SIZE
        : preview.text.length / TEXT_PAGE_SIZE,
    ),
  )
  const start = page * (preview.kind === "csv" ? CSV_PAGE_SIZE : TEXT_PAGE_SIZE)
  return (
    <>
      <div
        className="min-h-0 min-w-0 flex-1 overflow-auto rounded-md border"
        tabIndex={0}
        aria-label={t("documents.viewer.content", {
          defaultValue: "File content",
        })}
      >
        {preview.kind === "text" ? (
          <pre className="m-0 whitespace-pre-wrap break-words p-4 font-mono text-xs">
            {preview.text.slice(start, start + TEXT_PAGE_SIZE)}
          </pre>
        ) : (
          <RecordsPreview
            rows={preview.rows.slice(start, start + CSV_PAGE_SIZE)}
            columns={preview.columns}
            start={start}
            label={t("documents.viewer.csv", { defaultValue: "CSV preview" })}
          />
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-xs text-muted-foreground">
          {preview.kind === "csv"
            ? t("documents.viewer.rows", {
                defaultValue: "Rows {{start}}–{{end}} of {{total}}",
                start: preview.rows.length ? start + 1 : 0,
                end: Math.min(start + CSV_PAGE_SIZE, preview.rows.length),
                total: preview.rows.length,
              })
            : t("documents.viewer.pages", {
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

function RecordsPreview({
  rows,
  columns,
  start = 0,
  label,
}: {
  rows: string[][]
  columns: number
  start?: number
  label: string
}) {
  const { t } = useTranslation()
  if (rows.length === 0)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {t("documents.viewer.empty", {
          defaultValue: "This file contains no records.",
        })}
      </p>
    )
  return (
    <table
      className="w-full border-collapse text-left text-xs"
      aria-label={label}
    >
      <thead className="sticky top-0 bg-muted">
        <tr>
          <th className="border-b border-r px-2 py-1" scope="col">
            #
          </th>
          {Array.from({ length: columns }, (_, index) => (
            <th
              key={index}
              className="min-w-28 border-b border-r px-2 py-1"
              scope="col"
            >
              {columnLabel(index)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={start + rowIndex}>
            <th
              className="border-b border-r bg-muted/50 px-2 py-1 align-top font-normal tabular-nums text-muted-foreground"
              scope="row"
            >
              {start + rowIndex + 1}
            </th>
            {Array.from({ length: columns }, (_, column) => (
              <td
                key={column}
                className="max-w-80 whitespace-pre-wrap break-words border-b border-r px-2 py-1 align-top"
              >
                {row[column] ?? ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function WorkbookPreview({
  preview,
}: {
  preview: Extract<OfficeDocumentPreview, { kind: "xlsx" }>
}) {
  const { t } = useTranslation()
  const [selection, setSelection] = useState("0")
  const sheet = preview.sheets[Number(selection)]
  if (!sheet) return null
  const label = t("documents.viewer.sheet", { defaultValue: "Worksheet" })
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Select
          value={selection}
          onValueChange={setSelection}
        >
          <SelectTrigger
            className="w-auto min-w-32 max-w-full gap-2"
            aria-label={label}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {preview.sheets.map((item, index) => (
              <SelectItem key={index} value={String(index)}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div
        key={selection}
        className="min-h-0 min-w-0 flex-1 overflow-auto rounded-md border"
        tabIndex={0}
        aria-label={sheet.name}
      >
        <RecordsPreview
          rows={sheet.rows}
          columns={sheet.columns}
          label={sheet.name}
        />
      </div>
      {sheet.truncated && (
        <p role="status" className="shrink-0 text-xs text-muted-foreground">
          {t("documents.viewer.sheetTruncated", {
            defaultValue:
              "This worksheet preview is limited. Download the file for the full sheet.",
          })}
        </p>
      )}
    </>
  )
}

function WordPreview({
  preview,
}: {
  preview: Extract<OfficeDocumentPreview, { kind: "docx" }>
}) {
  const { t } = useTranslation()
  return (
    <>
      <div
        className="min-h-0 min-w-0 flex-1 overflow-auto rounded-md border"
        tabIndex={0}
        aria-label={t("documents.viewer.wordContent", {
          defaultValue: "Word document text and tables",
        })}
      >
        <div className="mx-auto max-w-[75ch] space-y-4 p-4 text-sm leading-relaxed sm:p-6">
          {preview.blocks.length === 0 && (
            <p className="text-muted-foreground">
              {t("documents.viewer.wordEmpty", {
                defaultValue: "No document text or tables to preview.",
              })}
            </p>
          )}
          {preview.blocks.map((block, index) =>
            block.kind === "paragraph" ? (
              <p key={index} className="whitespace-pre-wrap break-words">
                {block.text}
              </p>
            ) : (
              <div key={index} className="overflow-auto rounded-sm border">
                <table className="w-full border-collapse text-left text-sm">
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="odd:bg-muted/30">
                        {row.map((cell, column) => (
                          <td
                            key={column}
                            className="min-w-24 max-w-72 whitespace-pre-wrap break-words border-b border-r px-3 py-2 align-top last:border-r-0"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
          )}
        </div>
      </div>
      <p role="status" className="shrink-0 text-xs text-muted-foreground">
        {preview.truncated
          ? t("documents.viewer.wordTruncated", {
              defaultValue:
                "Some content is omitted. Download the file for the full document.",
            })
          : t("documents.viewer.wordPreviewNote", {
              defaultValue: "Shows text and tables from the document body.",
            })}
      </p>
    </>
  )
}
