"use client"

import { createContext, useCallback, useContext, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { X } from "lucide-react"
import { Button } from "../components/button"
import { FileUploadField } from "../components/file-upload-field"
import { FileIdentity } from "../components/file-identity"

/** Uploads one file as a document filed on the host record and resolves the created document id. */
export type ChatterUploadFn = (file: File, host: { resModel: string; resId: bigint }) => Promise<bigint>

/** A hook (supplied by the app) returning the uploader for an organization, or undefined when it has none. */
export type UseChatterUploader = (organizationId: number) => ChatterUploadFn | undefined

const noUploader: UseChatterUploader = () => undefined

const ChatterUploaderContext = createContext<UseChatterUploader>(noUploader)

/** `useUploader` must be a stable module-level hook function. */
export const ChatterUploaderProvider = ChatterUploaderContext.Provider

export function useChatterUploader(organizationId: number): ChatterUploadFn | undefined {
  return useContext(ChatterUploaderContext)(organizationId)
}

export type AttachmentStatus = "queued" | "uploading" | "done" | "error"

export interface AttachmentItem {
  key: string
  file: File
  status: AttachmentStatus
  documentId?: bigint
  error?: string
}

export function attachmentKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

/** Appends files not already in the list (same name, size, mtime). */
export function addAttachmentFiles(items: readonly AttachmentItem[], files: readonly File[]): AttachmentItem[] {
  const seen = new Set(items.map((i) => i.key))
  const next = [...items]
  for (const file of files) {
    const key = attachmentKey(file)
    if (seen.has(key)) continue
    seen.add(key)
    next.push({ key, file, status: "queued" })
  }
  return next
}

/** The files of a form `file` field value (FileList | File | File[] | null). */
export function filesFromFormValue(value: unknown): File[] {
  if (value instanceof File) return [value]
  if (typeof FileList !== "undefined" && value instanceof FileList) return Array.from(value)
  if (Array.isArray(value)) return value.filter((v): v is File => v instanceof File)
  return []
}

/**
 * Items for the selected files, carrying over the result of an earlier attempt (so files that
 * already uploaded are not uploaded twice when a submit is retried).
 */
export function itemsForFiles(files: readonly File[], previous: readonly AttachmentItem[]): AttachmentItem[] {
  const prior = new Map(previous.map((i) => [i.key, i]))
  return addAttachmentFiles([], files).map((i) => {
    const old = prior.get(i.key)
    return old?.status === "done" ? old : i
  })
}

export function removeAttachment(items: readonly AttachmentItem[], key: string): AttachmentItem[] {
  return items.filter((i) => i.key !== key)
}

/** Document ids of every uploaded item, in selection order. */
export function attachmentDocumentIds(items: readonly AttachmentItem[]): bigint[] {
  return items.flatMap((i) => (i.status === "done" && i.documentId != null ? [i.documentId] : []))
}

export function allAttachmentsDone(items: readonly AttachmentItem[]): boolean {
  return items.every((i) => i.status === "done")
}

/**
 * Uploads every queued or failed item one after another, reporting each state change. Items
 * already uploaded are not uploaded again. Resolves the final list; a failure marks that item
 * `error` and carries on with the rest.
 */
export async function uploadPendingAttachments(
  items: readonly AttachmentItem[],
  upload: ChatterUploadFn,
  host: { resModel: string; resId: bigint },
  onChange: (items: AttachmentItem[]) => void,
): Promise<AttachmentItem[]> {
  let current = [...items]
  const set = (key: string, patch: Partial<AttachmentItem>) => {
    current = current.map((i) => (i.key === key ? { ...i, ...patch } : i))
    onChange(current)
  }
  for (const item of items) {
    if (item.status === "done") continue
    set(item.key, { status: "uploading", error: undefined })
    try {
      const documentId = await upload(item.file, host)
      set(item.key, { status: "done", documentId })
    } catch (e) {
      set(item.key, { status: "error", error: e instanceof Error ? e.message : String(e) })
    }
  }
  return current
}

export function useChatterAttachments(
  upload: ChatterUploadFn | undefined,
  host: { resModel: string; resId: bigint },
) {
  const [items, setItems] = useState<AttachmentItem[]>([])
  const ref = useRef<AttachmentItem[]>([])
  const update = useCallback((next: AttachmentItem[]) => {
    ref.current = next
    setItems(next)
  }, [])

  const add = useCallback((files: readonly File[]) => update(addAttachmentFiles(ref.current, files)), [update])
  const remove = useCallback((key: string) => update(removeAttachment(ref.current, key)), [update])
  const reset = useCallback(() => update([]), [update])

  /** Uploads what is left; resolves the document ids when every file is uploaded, otherwise null. */
  const uploadAll = useCallback(async (): Promise<bigint[] | null> => {
    if (ref.current.length === 0) return []
    if (!upload) return null
    const result = await uploadPendingAttachments(ref.current, upload, host, update)
    return allAttachmentsDone(result) ? attachmentDocumentIds(result) : null
  }, [upload, host.resModel, host.resId, update]) // eslint-disable-line react-hooks/exhaustive-deps

  return { items, add, remove, reset, uploadAll }
}

export function ChatterAttachmentPicker({
  items,
  onAdd,
  onRemove,
  disabled,
}: {
  items: readonly AttachmentItem[]
  onAdd: (files: File[]) => void
  onRemove: (key: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const chooserRef = useRef<HTMLDivElement>(null)
  return (
    <div className="space-y-1" data-testid="record-chatter-attachments">
      <div ref={chooserRef}>
        <FileUploadField
          multiple
          disabled={disabled}
          aria-label={t("crm.chatter.attachFiles", { defaultValue: "Attach files" })}
          chooseLabel={t("crm.chatter.chooseFiles", { defaultValue: "Choose files" })}
          data-testid="record-chatter-attach-input"
          onSelect={onAdd}
        />
      </div>
      {items.length > 0 ? (
        <ul className="space-y-1">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-start justify-between gap-2 rounded-md border px-2 py-2 text-sm"
              data-testid={`record-chatter-attachment-${item.status}`}
            >
              <div className="min-w-0 flex-1">
                <FileIdentity
                  fileName={item.file.name}
                  mimetype={item.file.type}
                  size={item.file.size}
                  status={t(`crm.chatter.attachmentStatus.${item.status}`, {
                    defaultValue: { queued: "Selected", uploading: "Uploading…", done: "Uploaded", error: "Upload failed" }[item.status],
                  })}
                />
                {item.error ? <p role="alert" className="mt-1 text-xs text-destructive [overflow-wrap:anywhere]">{item.error}</p> : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={item.status === "uploading"}
                aria-label={t("crm.chatter.removeNamedAttachment", { defaultValue: "Remove {{name}}", name: item.file.name })}
                data-testid="record-chatter-attachment-remove"
                onClick={() => {
                  chooserRef.current?.querySelector("button")?.focus()
                  onRemove(item.key)
                }}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
