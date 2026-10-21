"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import type { ModuleDataState } from "../lib/module-data-state"
import { ModuleDataNotice } from "../pages/module-data-notice"
import { Button } from "../components/button"
import { Input } from "../components/input"
import { Label } from "../components/label"
import { billSourceDocuments, documentId as id, documentOptional as optional, type BillSourceDocument } from "../lib/bill-source-document-model"

export interface BillSourceDocumentsProps {
  organizationId: bigint | number | string
  companyId: bigint | number | string
  billId: bigint | number | string
  documents: readonly BillSourceDocument[]
  sourceState: ModuleDataState
  uploadState?: { phase: "idle" | "pending" | "unknown" | "error"; message?: string }
  onUpload?: (file: File) => Promise<void>
  onRefresh?: () => void
}

export function BillSourceDocuments(props: BillSourceDocumentsProps) {
  return <ScopedBillSourceDocuments key={`${props.organizationId}:${props.companyId}:${props.billId}`} {...props} />
}

function ScopedBillSourceDocuments(props: BillSourceDocumentsProps) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const linked = useMemo(() => props.sourceState.status === "ready" ? billSourceDocuments(props.documents, { organizationId: props.organizationId, companyId: props.companyId, billId: props.billId }) : null, [props.documents, props.organizationId, props.companyId, props.billId, props.sourceState.status])
  const busy = submitting || props.uploadState?.phase === "pending"
  const blocked = busy || props.uploadState?.phase === "unknown" || props.sourceState.status !== "ready" || linked == null
  return <section className="space-y-3 rounded-md border bg-muted/20 p-3" aria-label={t("accounting.billDocuments.title", { defaultValue: "Supplier documents and receipts" })}>
    <h4 className="text-sm font-medium">{t("accounting.billDocuments.title", { defaultValue: "Supplier documents and receipts" })}</h4>
    {props.sourceState.status !== "ready" ? props.sourceState.status === "loading" ? <p role="status" className="text-sm">{t("common.loading", { defaultValue: "Loading…" })}</p> : <ModuleDataNotice state={props.sourceState} /> : linked == null ? <p role="alert" className="text-sm text-destructive">{t("accounting.billDocuments.scopeUnavailable", { defaultValue: "Document links or ownership could not be verified. Refresh before attaching a file." })}</p> : <>
      {linked.length ? <ul className="space-y-1 text-sm">{linked.map((document) => <li key={String(document.id)}><a className="text-primary underline" href={`/documents/${id(document.id)}`}>{String(optional(document.name) ?? optional(document.fileName ?? document.file_name) ?? `#${String(document.id)}`)}</a></li>)}</ul> : <p className="text-sm text-muted-foreground">{t("accounting.billDocuments.empty", { defaultValue: "No supplier documents linked to this bill." })}</p>}
      {props.onUpload ? <div className="space-y-2">
        <Label htmlFor={`bill-source-file-${String(props.billId)}`}>{t("accounting.billDocuments.file", { defaultValue: "Receipt or supplier document (PDF or image, up to 20 MB)" })}</Label>
        <Input id={`bill-source-file-${String(props.billId)}`} type="file" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" disabled={blocked} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setLocalError(null) }} />
        <Button type="button" variant="outline" size="sm" disabled={blocked || !file} onClick={async () => {
          if (!file || !props.onUpload || blocked) return
          if (file.size <= 0 || file.size > 20 * 1024 * 1024 || !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(file.type)) { setLocalError(t("accounting.billDocuments.invalidFile", { defaultValue: "Choose a non-empty PDF, PNG, JPEG or WebP file up to 20 MB." })); return }
          setSubmitting(true); setLocalError(null)
          try { await props.onUpload(file); setFile(null) } catch (cause) { setLocalError(cause instanceof Error ? cause.message : String(cause)) } finally { setSubmitting(false) }
        }}>{busy ? t("accounting.billDocuments.uploading", { defaultValue: "Attaching…" }) : t("accounting.billDocuments.attach", { defaultValue: "Attach to this bill" })}</Button>
      </div> : <p className="text-sm text-muted-foreground">{t("accounting.billDocuments.readOnly", { defaultValue: "Document creation permission is required to attach files." })}</p>}
    </>}
    {props.uploadState?.phase === "unknown" ? <p role="alert" className="text-sm">{t("accounting.billDocuments.unknown", { defaultValue: "Attachment submission is unverified. Refresh documents to check this attempt before uploading again." })}</p> : null}
    {localError || props.uploadState?.message ? <p role="alert" className="text-sm text-destructive">{localError || props.uploadState?.message}</p> : null}
    {props.onRefresh ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={props.onRefresh}>{t("accounting.billDocuments.refresh", { defaultValue: "Refresh documents" })}</Button> : null}
  </section>
}
