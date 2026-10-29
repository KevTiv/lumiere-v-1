"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Archive, ArrowRight, Calculator, CheckCircle2, Clock, Download, FileText, MoreHorizontal, Send } from "lucide-react"
import { cn } from "@/lib/utils"
import { invoiceStatusBadgeClass } from "../lib/theme-colors"
import type { AccountMove } from "../lib/accounting-types"
import { microsSinceEpochToDate, moveTypeIsInvoiceOrRefund } from "../lib/accounting-move-utils"
import { useTranslation } from "@lumiere/i18n"
import { formatInvoiceMoney, InvoiceDocument, readInvoiceDocumentContent } from "./invoice-document"
import type { InvoiceDocumentSnapshot } from "@lumiere/erp-shared/invoice-personalization"
import type { ModuleDataState } from "../lib/module-data-state"
import { ModuleDataNotice } from "../pages/module-data-notice"

function formatTimestamp(ts?: { microsSinceUnixEpoch: bigint } | null, long = false): string {
  if (!ts) return "—"
  return new Date(Number(ts.microsSinceUnixEpoch) / 1000).toLocaleDateString(undefined, long
    ? { month: "long", day: "numeric", year: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" })
}

function moveStateStr(state: unknown): string {
  if (state != null && typeof state === "object" && "tag" in state) return String((state as { tag: string }).tag)
  return String(state ?? "")
}

interface InvoiceDetailModalProps {
  invoice: (AccountMove & { metadata?: string | null }) | null
  open: boolean
  onClose: () => void
  currencyCode?: string
  currencyId?: string
  draftPersonalization?: InvoiceDocumentSnapshot | null
  draftPersonalizationState?: ModuleDataState
  organizationId?: number
  onPostDraft?: () => void
  onCreateCreditNote?: () => void
  onRecordPayment?: () => void
  onRecalculateTotals?: () => void
  onDownloadPdf?: () => void
  onArchivePdf?: () => void
  onSendEmail?: () => void
  postDraftPending?: boolean
  recordPaymentPending?: boolean
  recalculateTotalsPending?: boolean
  downloadPdfPending?: boolean
  archivePdfPending?: boolean
  sendEmailPending?: boolean
}

export function InvoiceDetailModal({ invoice, open, onClose, currencyCode, currencyId, draftPersonalization, draftPersonalizationState, organizationId, onPostDraft, onCreateCreditNote, onRecordPayment, onRecalculateTotals, onDownloadPdf, onArchivePdf, onSendEmail, postDraftPending, recordPaymentPending, recalculateTotalsPending, downloadPdfPending, archivePdfPending, sendEmailPending }: InvoiceDetailModalProps) {
  const { t } = useTranslation()
  if (!invoice) return null
  const state = moveStateStr(invoice.state)
  const paymentState = moveStateStr(invoice.paymentState)
  const isDraft = state === "Draft"
  const isPosted = state === "Posted"
  const moveType = moveStateStr(invoice.moveType)
  const isBill = moveType === "InInvoice" || moveType === "InRefund"
  const outgoing = moveType === "OutInvoice" || moveType === "OutRefund"
  const documentContent = readInvoiceDocumentContent(invoice.metadata, organizationId, outgoing)
  const personalization = outgoing && isDraft && draftPersonalization ? draftPersonalization : documentContent.personalization
  const draftProfileReady = !outgoing || draftPersonalizationState == null || draftPersonalizationState.status === "ready"
  const due = microsSinceEpochToDate(invoice.invoiceDateDue)
  const daysUntilDue = due ? Math.ceil((due.getTime() - Date.now()) / 86_400_000) : null
  const balance = invoice.amountResidual ?? 0
  const currency = { code: currencyCode, id: currencyId }
  const money = (value: number | null | undefined) => formatInvoiceMoney(value, currency)
  const paid = invoice.amountTotal != null && invoice.amountResidual != null
    ? invoice.amountTotal - invoice.amountResidual : null
  const canRecordPayment = Boolean(onRecordPayment) && isPosted && balance > 0
  const canCreateCreditNote = Boolean(onCreateCreditNote) && isPosted && moveType === "OutInvoice"
  const status = state === "Cancelled" ? "cancelled" : isDraft ? "draft" : paymentState === "Paid" ? "paid"
    : balance > 0 && daysUntilDue !== null && daysUntilDue < 0 ? "overdue" : paymentState === "InPayment" || paymentState === "Partial" ? "partial" : "sent"
  const hasMoreActions = Boolean(onSendEmail || onArchivePdf || (isDraft && moveTypeIsInvoiceOrRefund(invoice.moveType) && onRecalculateTotals))

  return <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
    <DialogContent className="flex max-h-[94dvh] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl" data-testid="invoice-detail-modal">
      <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 sm:px-6">
        <div className="flex flex-wrap items-center gap-3"><DialogTitle className="break-words text-xl font-semibold tracking-tight">{invoice.name || (isBill ? t("accounting.manualInvoice.billTitle", { defaultValue: "Vendor bill" }) : t("accounting.manualInvoice.invoiceTitle", { defaultValue: "Invoice" }))}</DialogTitle><Badge className={invoiceStatusBadgeClass[status]}>{t(`accounting.states.${status}`)}</Badge></div>
        <DialogDescription>{invoice.invoicePartnerDisplayName ?? t("accounting.generalLedgerView.partnerValue", { defaultValue: "Partner #{{value1}}", value1: invoice.partnerId })}</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 bg-muted/30 p-4 sm:p-6">{isDraft && outgoing ? <><ModuleDataNotice state={draftPersonalizationState} /><p className="mb-3 text-xs text-muted-foreground">{t("accounting.invoiceDetailModal.postingCapturesTheLatestCompanyInvoiceSettingsShownInThis", { defaultValue: "Posting captures the latest company invoice settings shown in this review." })}</p></> : null}<InvoiceDocument title={isBill ? t("accounting.manualInvoice.billTitle", { defaultValue: "Vendor bill" }) : moveType === "OutRefund" ? t("accounting.invoices.creditNote", { defaultValue: "Credit note" }) : t("accounting.manualInvoice.invoiceTitle", { defaultValue: "Invoice" })} reference={invoice.name} partnerLabel={isBill ? t("accounting.workflowGuide.vendor", { defaultValue: "Vendor" }) : t("accounting.invoices.billTo")} partner={invoice.invoicePartnerDisplayName ?? t("accounting.generalLedgerView.partnerValue", { defaultValue: "Partner #{{value1}}", value1: invoice.partnerId })} date={formatTimestamp(invoice.invoiceDate, true)} dueDate={formatTimestamp(invoice.invoiceDateDue, true)} currency={currency} subtotal={invoice.amountUntaxed ?? null} tax={invoice.amountTax ?? null} total={invoice.amountTotal ?? null} personalization={personalization} notes={documentContent.notes} personalizationError={documentContent.personalizationError} draft={isDraft} />{invoice.ref ? <p className="mt-3 break-words text-xs text-muted-foreground">{t("accounting.invoiceDetailModal.copy.referenceValue", { defaultValue: "Reference: {{ref}}", ref: invoice.ref })}</p> : null}</div>
        <aside className="order-first space-y-6 border-b p-5 lg:order-none lg:border-b-0 lg:border-l lg:p-6">
          <section>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("accounting.invoices.balanceDue")}</p><p className={cn("mt-2 break-words text-2xl font-semibold tabular-nums", invoice.amountResidual == null ? "text-muted-foreground" : balance > 0 ? "text-foreground" : "text-success")}>{money(invoice.amountResidual)}</p>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="size-4 shrink-0" />{t("accounting.invoices.amountPaid")}: {money(paid)}</div>
            {balance > 0 && daysUntilDue !== null ? <div className="mt-3 flex items-center gap-2 text-xs"><Clock className="size-4 shrink-0 text-muted-foreground" /><span>{daysUntilDue < 0 ? t("accounting.invoices.daysOverdue", { count: Math.abs(daysUntilDue) }) : t("accounting.invoices.daysRemaining", { count: daysUntilDue })}</span></div> : null}
          </section>
          <section className="space-y-3 border-t pt-5"><h3 className="text-sm font-semibold">{t("accounting.invoiceDetailModal.nextAction", { defaultValue: "Next action" })}</h3><p className="text-xs leading-relaxed text-muted-foreground">{isDraft ? t("accounting.invoiceDetailModal.reviewTheDocumentThenPostItToTheLedger", { defaultValue: "Review the document, then post it to the ledger." }) : canRecordPayment ? t("accounting.invoiceDetailModal.recordAPaymentToReduceTheOutstandingBalance", { defaultValue: "Record a payment to reduce the outstanding balance." }) : state === "Cancelled" ? t("accounting.invoiceDetailModal.thisDocumentHasBeenCancelled", { defaultValue: "This document has been cancelled." }) : invoice.amountResidual != null && balance <= 0 ? t("accounting.invoiceDetailModal.noOutstandingBalanceRemainsOnThisDocument", { defaultValue: "No outstanding balance remains on this document." }) : t("accounting.invoiceDetailModal.reviewThisDocumentSStatusAndAvailableActions", { defaultValue: "Review this document’s status and available actions." })}</p>
            {isDraft && onPostDraft ? <Button type="button" className="w-full justify-between" data-testid="invoice-detail-post-draft" disabled={postDraftPending || !draftProfileReady || Boolean(documentContent.personalizationError)} onClick={onPostDraft}>{t("accounting.invoices.invoiceActions.postDraft")}<ArrowRight className="size-4" /></Button> : null}
            {canRecordPayment ? <Button type="button" className="w-full justify-between" disabled={recordPaymentPending} onClick={onRecordPayment}>{t("accounting.invoices.invoiceActions.recordPayment")}<ArrowRight className="size-4" /></Button> : null}
            {onDownloadPdf ? <Button type="button" variant="outline" className="w-full justify-start gap-2" disabled={downloadPdfPending} onClick={onDownloadPdf}><Download className="size-4" />{t("accounting.invoices.invoiceActions.download")}</Button> : null}
            {canCreateCreditNote ? <Button type="button" variant="ghost" className="w-full justify-start gap-2" data-testid="invoice-detail-create-credit-note" onClick={onCreateCreditNote}><FileText className="size-4" />{t("accounting.invoices.invoiceActions.createCreditNote")}</Button> : null}
            {hasMoreActions ? <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="w-full justify-between">{t("accounting.invoiceDetailModal.moreActions", { defaultValue: "More actions" })}<MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
              {onSendEmail ? <DropdownMenuItem disabled={sendEmailPending} onSelect={onSendEmail}><Send />{t("accounting.invoiceDetailModal.reviewEmail", { defaultValue: "Review email" })}</DropdownMenuItem> : null}
              {onArchivePdf ? <DropdownMenuItem disabled={archivePdfPending} onSelect={onArchivePdf}><Archive />{t("accounting.invoiceDetailModal.archiveToDocuments", { defaultValue: "Archive to Documents" })}</DropdownMenuItem> : null}
              {isDraft && moveTypeIsInvoiceOrRefund(invoice.moveType) && onRecalculateTotals ? <DropdownMenuItem disabled={recalculateTotalsPending} onSelect={onRecalculateTotals}><Calculator />{t("accounting.invoices.invoiceActions.recalculateTotals")}</DropdownMenuItem> : null}
            </DropdownMenuContent></DropdownMenu> : null}
          </section>
          {invoice.invoiceOrigin ? <section className="border-t pt-5"><h3 className="text-xs font-medium text-muted-foreground">{t("accounting.invoices.origin")}</h3><p className="mt-2 break-words text-sm">{invoice.invoiceOrigin}</p></section> : null}
          <section className="border-t pt-5"><h3 className="text-xs font-medium text-muted-foreground">{t("accounting.invoices.activity")}</h3><p className="mt-2 text-sm">{t("accounting.invoices.invoiceCreated")}</p><p className="mt-1 text-xs text-muted-foreground">{t("accounting.invoices.createdOn", { date: formatTimestamp(invoice.createDate) })}</p></section>
        </aside>
      </div>
    </DialogContent>
  </Dialog>
}
