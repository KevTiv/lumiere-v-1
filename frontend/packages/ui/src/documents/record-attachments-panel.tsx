"use client"

import { useId, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { FileUploadField } from "../components/file-upload-field"
import { FileIdentity } from "../components/file-identity"
import { documentRelatedRecordLabel } from "../lib/file-metadata"
import type { ModuleDataState } from "../lib/module-data-state"
import { ModuleDataNotice } from "../pages/module-data-notice"
import { DOCUMENT_FILE_ACCEPT } from "@lumiere/erp-shared/document-file-profile"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type RecordAttachmentRow = {
  id: string | number | bigint
  name?: string | null
  fileName?: string | null
  file_name?: string | null
  mimetype?: string | null
  fileSize?: unknown
  file_size?: unknown
  url?: string | null
  resModel?: string | null
  res_model?: string | null
  resId?: string | number | bigint | null
  res_id?: string | number | bigint | null
  isDeleted?: boolean | null
  is_deleted?: boolean | null
}

export type RecordAttachmentsPanelProps = {
  resModel: string
  resId: bigint | number
  documents: RecordAttachmentRow[]
  onUpload: (file: File, meta: { name: string }) => Promise<void>
  onOpen?: (documentId: string) => void
  title?: string
  emptyLabel?: string
  uploadLabel?: string
  disabled?: boolean
  dataState?: ModuleDataState
}

function rowResModel(row: RecordAttachmentRow): string {
  return String(row.resModel ?? row.res_model ?? "")
}

function rowResId(row: RecordAttachmentRow): string {
  const v = row.resId ?? row.res_id
  return v == null ? "" : String(v)
}

function rowDeleted(row: RecordAttachmentRow): boolean {
  return Boolean(row.isDeleted ?? row.is_deleted)
}

/**
 * List + upload attachments linked to an ERP record via `res_model` / `res_id`.
 */
export function RecordAttachmentsPanel({
  resModel,
  resId,
  documents,
  onUpload,
  onOpen,
  title = "Attachments",
  emptyLabel = "No attachments yet",
  uploadLabel = "Upload",
  disabled,
  dataState,
}: RecordAttachmentsPanelProps) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  const linked = useMemo(() => {
    const idStr = String(resId)
    return documents.filter(
      (d) =>
        !rowDeleted(d) &&
        rowResModel(d) === resModel &&
        rowResId(d) === idStr,
    )
  }, [documents, resModel, resId])

  return (
    <div
      className="@container/attachments space-y-3 rounded-md border border-border p-3 [overflow-wrap:anywhere]"
      data-testid="record-attachments-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {documentRelatedRecordLabel(resModel, t)} #{String(resId)}
        </span>
      </div>

      {dataState && dataState.status !== "ready" ? (
        dataState.status === "loading"
          ? <p role="status" className="text-sm text-muted-foreground">{t("documents.attachments.loading", { defaultValue: "Loading attachments…" })}</p>
          : <ModuleDataNotice state={dataState} />
      ) : linked.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {linked.map((document) => (
            <li key={String(document.id)} className="min-w-0 py-2">
              <FileIdentity
                title={document.name}
                fileName={document.fileName || document.file_name}
                mimetype={document.mimetype}
                size={document.fileSize ?? document.file_size}
                status={!onOpen && !document.url ? t("documents.attachments.unavailable", { defaultValue: "File unavailable" }) : undefined}
                onOpen={onOpen ? () => onOpen(String(document.id)) : undefined}
                href={document.url || undefined}
                linkTarget="_blank"
                linkRel="noreferrer"
              />
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 @lg/attachments:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] @lg/attachments:items-start">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${inputId}-name`}>Name</Label>
          <Input
            id={`${inputId}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Attachment name"
            disabled={disabled || pending}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${inputId}-file`}>File</Label>
          <FileUploadField
            id={`${inputId}-file`}
            accept={DOCUMENT_FILE_ACCEPT}
            data-testid="record-attachments-file"
            chooseLabel={t("documents.attachments.choose", { defaultValue: "Choose file" })}
            disabled={disabled || pending}
            files={file ? [{ id: "selected", name: file.name, mimetype: file.type, size: file.size }] : []}
            onSelect={([picked]) => { if (picked) { setFile(picked); setError(null) } }}
            onRemove={() => { setFile(null); setError(null) }}
          />
        </div>
        <Button
          type="button"
          className="h-auto min-h-8 max-w-full whitespace-normal @lg/attachments:mt-6"
          disabled={disabled || pending || !file}
          onClick={async () => {
            if (!file) return
            setPending(true)
            setError(null)
            try {
              await onUpload(file, {
                name: name.trim() || file.name,
              })
              setFile(null)
              setName("")
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            } finally {
              setPending(false)
            }
          }}
        >
          {pending ? "Uploading…" : uploadLabel}
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
