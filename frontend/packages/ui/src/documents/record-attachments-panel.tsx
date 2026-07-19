"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type RecordAttachmentRow = {
  id: string | number | bigint
  name?: string | null
  fileName?: string | null
  file_name?: string | null
  mimetype?: string | null
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
  title?: string
  emptyLabel?: string
  uploadLabel?: string
  disabled?: boolean
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
  title = "Attachments",
  emptyLabel = "No attachments yet",
  uploadLabel = "Upload",
  disabled,
}: RecordAttachmentsPanelProps) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    <div className="space-y-3 rounded-md border border-border p-3" data-testid="record-attachments-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {resModel} #{String(resId)}
        </span>
      </div>

      {linked.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {linked.map((d) => {
            const label = d.name || d.fileName || d.file_name || `Document ${String(d.id)}`
            const href = d.url || undefined
            return (
              <li key={String(d.id)} className="flex items-center justify-between gap-2">
                {href ? (
                  <a className="text-primary underline-offset-2 hover:underline" href={href} target="_blank" rel="noreferrer">
                    {label}
                  </a>
                ) : (
                  <span>{label}</span>
                )}
                <span className="text-xs text-muted-foreground">{d.mimetype || ""}</span>
              </li>
            )
          })}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="attach-name">Name</Label>
          <Input
            id="attach-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Attachment name"
            disabled={disabled || pending}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="attach-file">File</Label>
          <Input
            id="attach-file"
            type="file"
            data-testid="record-attachments-file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={disabled || pending}
          />
        </div>
        <Button
          type="button"
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
