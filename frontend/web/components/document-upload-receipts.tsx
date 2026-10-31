"use client"

import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import type { DocumentReceiptRow } from "@/lib/use-document-upload-receipts"
import type { DocumentSubmissionPointer } from "@/lib/document-upload-receipts"

export function DocumentUploadReceipts({ rows, error, onResume }: {
  rows: readonly DocumentReceiptRow[]
  error?: string
  onResume(pointer: DocumentSubmissionPointer, retryIndexing: boolean): Promise<unknown>
}) {
  const { t } = useTranslation()
  if (!rows.length && !error) return null
  return <section className="mb-4 rounded-lg border bg-card p-4" aria-label={t("documents.receipts.title", { defaultValue: "Upload receipts" })}>
    <h2 className="font-medium">{t("documents.receipts.title", { defaultValue: "Upload receipts" })}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{t("documents.receipts.help", { defaultValue: "Files and registered documents remain saved if AI indexing fails. Receipts can be checked after refresh." })}</p>
    {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
    <ul className="mt-3 max-h-80 space-y-3 overflow-y-auto">
      {[...rows].reverse().map(({ pointer, receipt, error: rowError, busy }) => <li key={pointer.submissionId} className="rounded border p-3" data-testid="document-upload-receipt">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="break-all font-medium">{receipt?.fileName ?? pointer.fileName}</span>
          {receipt?.documentId ? <Link className="text-sm underline" href={`/documents/${receipt.documentId}`}>{t("documents.receipts.open", { defaultValue: "Open document" })}</Link> : null}
        </div>
        <ol className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-live="polite">
          <li>{receipt?.fileSaved ? t("documents.receipts.fileSaved", { defaultValue: "File saved" }) : t("documents.receipts.fileUnconfirmed", { defaultValue: "File save not yet confirmed" })}</li>
          <li>{receipt?.documentId ? t("documents.receipts.registered", { defaultValue: "Document registered" }) : t("documents.receipts.registrationPending", { defaultValue: "Document registration pending" })}</li>
          <li>{receipt?.indexing === "superseded" ? t("documents.receipts.sourceSuperseded", { defaultValue: "A newer document version exists; this receipt retains the original file" }) : receipt?.indexing === "completed" ? t("documents.receipts.indexCompleted", { defaultValue: "AI indexing completed" }) : receipt?.indexing === "running" ? t("documents.receipts.indexRunning", { defaultValue: "AI indexing running" }) : receipt?.indexing === "unavailable" ? t("documents.receipts.indexUnavailable", { defaultValue: "AI indexing status unavailable; check this receipt again" }) : receipt?.indexing === "failed" ? t("documents.receipts.indexFailed", { defaultValue: "AI indexing failed" }) : receipt?.indexing === "queued" ? t("documents.receipts.indexQueued", { defaultValue: "AI indexing pending · queued" }) : t("documents.receipts.indexPending", { defaultValue: "AI indexing pending" })}</li>
        </ol>
        <p className="mt-1 break-all text-xs text-muted-foreground">{t("documents.receipts.id", { defaultValue: "Receipt" })}: {pointer.submissionId}</p>
        {rowError ? <p className="mt-2 text-sm text-destructive" role="alert">{rowError}</p> : null}
        <Button type="button" variant="outline" size="sm" className="mt-2" disabled={busy} onClick={() => { void onResume(pointer, true).catch(() => undefined) }}>
          {busy ? t("documents.receipts.checking", { defaultValue: "Checking…" }) : receipt?.documentId && receipt.indexing === "failed" ? t("documents.receipts.retryIndexing", { defaultValue: "Retry indexing" }) : receipt?.documentId && receipt.indexing === "pending" ? t("documents.receipts.resumeIndexing", { defaultValue: "Continue indexing" }) : t("documents.receipts.checkSave", { defaultValue: "Check save receipt" })}
        </Button>
      </li>)}
    </ul>
  </section>
}
