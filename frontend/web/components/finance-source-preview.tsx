"use client"

import { useEffect, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useDocuments, useDocumentVersions } from "@lumiere/query-hooks/hooks/documents"
import { useExpenseReceipts } from "@lumiere/query-hooks/hooks/expenses"
import { Button } from "@lumiere/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lumiere/ui/components/card"
import type { EntityRow } from "@lumiere/ui/lib/entity-view-types"
import { linkedBillEvidence, linkedFinanceEvidence, type FinanceEvidence } from "../lib/finance-source-preview"
import { parseAttachmentIds } from "../lib/expenses-create-params"

function EvidenceFile({ file }: { file: FinanceEvidence }) {
  const { t } = useTranslation()
  const identity = `${file.id}:${file.url}:${file.mime}`
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<{ id: string; url?: string; error?: boolean }>({ id: "" })
  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined
    setState({ id: identity })
    if (file.url && /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(file.mime)) {
      void fetch(file.url, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Source unavailable")
          const blob = await response.blob()
          if (controller.signal.aborted) return
          url = URL.createObjectURL(new Blob([blob], { type: file.mime }))
          setState({ id: identity, url })
        }).catch(() => { if (!controller.signal.aborted) setState({ id: identity, error: true }) })
    }
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [identity, file.id, file.url, file.mime, retry])
  const active = state.id === identity ? state : { id: file.id }
  return <div className="flex min-w-0 flex-col gap-3" data-testid="finance-source-file">
    <p className="break-words text-sm font-medium">{file.name}</p>
    {active.url && file.mime.startsWith("image/") ? <img src={active.url} alt={file.name} className="max-h-[60vh] max-w-full object-contain" /> : null}
    {active.url && file.mime === "application/pdf" ? <object aria-label={file.name} data-testid="finance-source-pdf" data={active.url} type="application/pdf" className="h-[55vh] w-full rounded-md border"><p>{t("expenses.capture.attachments.pdfFallback", { defaultValue: "PDF selected. Your browser cannot display its preview." })}</p></object> : null}
    {active.error ? <p role="status">{t("financeReview.sourceUnavailable", { defaultValue: "The source file could not be loaded." })} <Button type="button" variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>{t("common.retry", { defaultValue: "Retry" })}</Button></p> : null}
    {!active.url && !active.error ? <p className="text-sm text-muted-foreground">{t("financeReview.sourceLoading", { defaultValue: "Preview loading or unavailable for this file type. Use the download link when available." })}</p> : null}
    {file.url ? <a href={file.url} download={file.name} className="text-sm underline">{t("financeReview.downloadSource", { defaultValue: "Download source" })}</a> : null}
  </div>
}

function SourcePanel({ files, loading, error, expected = false }: { files: FinanceEvidence[]; loading: boolean; error: boolean; expected?: boolean }) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState("")
  const selected = files.find((file) => file.id === selectedId) ?? files[0]
  if (!loading && !error && files.length === 0) {
    return <section data-testid="finance-source-preview" className="flex min-w-0 flex-col gap-1 rounded-lg border p-3" aria-label={t("financeReview.sourceTitle", { defaultValue: "Source document" })}>
      <p className="text-sm font-medium">{t("financeReview.sourceTitle", { defaultValue: "Source document" })}</p>
      <p className="break-words text-sm text-muted-foreground">{expected
        ? t("financeReview.attachedUnavailable", { defaultValue: "The attached receipt is unavailable in the current company or access scope." })
        : t("financeReview.noSource", { defaultValue: "No source document is available in your current access scope." })}</p>
    </section>
  }
  return <Card data-testid="finance-source-preview" className="min-w-0">
    <CardHeader><CardTitle>{t("financeReview.sourceTitle", { defaultValue: "Source document" })}</CardTitle><CardDescription>{t("financeReview.sourceDescription", { defaultValue: "Saved evidence linked to this record." })}</CardDescription></CardHeader>
    <CardContent className="flex min-w-0 flex-col gap-4">
      {loading ? <p role="status">{t("common.loading")}</p> : error ? <p role="status">{t("financeReview.evidenceUnavailable", { defaultValue: "Evidence is unavailable. This does not mean no document is attached." })}</p> : <>
        {files.length > 1 ? <div className="flex flex-wrap gap-2">{files.map((file) => <Button key={file.id} type="button" className="h-auto max-w-full whitespace-normal break-all text-left" size="sm" variant={file.id === selected?.id ? "default" : "outline"} onClick={() => setSelectedId(file.id)}>{file.name}</Button>)}</div> : null}
        {selected ? <EvidenceFile key={selected.id} file={selected} /> : <p className="text-sm text-muted-foreground">{expected
          ? t("financeReview.attachedUnavailable", { defaultValue: "The attached receipt is unavailable in the current company or access scope." })
          : t("financeReview.noSource", { defaultValue: "No source document is available in your current access scope." })}</p>}
      </>}
    </CardContent>
  </Card>
}

export function BillSourcePreview({ organizationId, companyId, recordId }: { organizationId: bigint; companyId: bigint; recordId: string }) {
  const query = useDocuments(organizationId)
  const versions = useDocumentVersions(organizationId)
  const { files, unavailable } = linkedBillEvidence(query.data ?? [], versions.data ?? [], { organizationId, companyId, recordId })
  return <SourcePanel key={`${organizationId}:${companyId}:${recordId}`} files={files} loading={query.isLoading || versions.isLoading} error={query.isError || versions.isError || unavailable} />
}

export function ExpenseSourcePreview({ organizationId, companyId, record }: { organizationId: bigint; companyId: bigint; record: EntityRow }) {
  const query = useExpenseReceipts(organizationId)
  const receiptIds = parseAttachmentIds(record).map(String)
  const files = linkedFinanceEvidence(query.data ?? [], { organizationId, companyId, receiptIds, employeeId: String(record.employeeId ?? record.employee_id ?? "") })
  return <SourcePanel key={`${organizationId}:${companyId}:${String(record.id)}`} files={files} loading={receiptIds.length > 0 && query.isLoading} error={receiptIds.length > 0 && query.isError} expected={receiptIds.length > 0} />
}
