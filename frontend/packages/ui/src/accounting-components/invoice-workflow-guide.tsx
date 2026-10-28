"use client"

import { useTranslation } from "@lumiere/i18n"
import { Button } from "../components/button"

export interface InvoiceWorkflowGuideProps {
  /** Display state supplied by the record's canonical accounting read. */
  stage: "draft" | "posted" | "paid" | "cancelled" | "unavailable"
  isBill: boolean
  amountDue: string
  primaryAction?: { label: string; onClick: () => void; blockedReason?: string; pending?: boolean }
  onReviewLines: () => void
  paymentsHref: string
  onViewPayments?: () => void
  onRefresh?: () => void
  error?: string | null
}

/** Explains the next step without inferring email delivery or executing transitions. */
export function InvoiceWorkflowGuide({ stage, isBill, amountDue, primaryAction, onReviewLines, paymentsHref, onViewPayments, onRefresh, error }: InvoiceWorkflowGuideProps) {
  const { t } = useTranslation()
  const tr = (key: string, defaultValue: string) => t(`accounting.workflowGuide.${key}`, { defaultValue })
  const heading = stage === "draft" ? tr("draftTitle", "Review this draft before posting")
    : stage === "posted" ? tr("postedTitle", "Review the outstanding balance")
    : stage === "paid" ? tr("paidTitle", "Payment complete")
    : stage === "cancelled" ? tr("cancelledTitle", "This document is cancelled")
    : tr("unavailableTitle", "Refresh this document before continuing")
  const hint = stage === "draft" ? tr("draftHint", "Check the party, dates, items and taxes. Saving a draft does not post it to the ledger. Posting creates the accounting entry.")
    : stage === "posted" ? isBill
      ? tr("billHint", "Apply a payment already posted in Payments, or open Payments to record one. Applying a payment updates this bill’s outstanding balance; it does not send money to your vendor.")
      : tr("invoiceHint", "Apply a payment already posted in Payments, or open Payments to record one. Applying a payment updates this invoice’s outstanding balance; it does not charge your customer.")
    : stage === "paid" ? tr("paidHint", "Review linked payments for the allocation history. Bank matching is a separate step in Banking.")
    : stage === "cancelled" ? tr("cancelledHint", "No posting or payment action is available for this cancelled document.")
    : tr("unavailableHint", "The current accounting state or balance is unavailable. Refresh and review the saved record before taking another action.")
  return <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4 sm:p-5" aria-label={tr("label", "Next accounting step")} data-testid="invoice-workflow-guide">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{tr("label", "Next accounting step")}</p>
    <h2 className="text-base font-semibold">{heading}</h2>
    <p className="max-w-3xl text-sm text-muted-foreground">{hint}</p>
    {stage === "posted" ? <p className="text-sm font-medium tabular-nums">{tr("amountDue", "Amount due")}: {amountDue}</p> : null}
    {!isBill && (stage === "draft" || stage === "posted" || stage === "paid") ? <p className="text-xs text-muted-foreground">{tr("emailHint", "Use Review email to prepare a customer message. Posting and payment status do not confirm email delivery.")}</p> : null}
    {primaryAction?.blockedReason ? <p role="status" className="text-sm" data-testid="invoice-next-step-blocked">{primaryAction.blockedReason}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap items-center gap-2">
      {error && onRefresh ? <Button variant="outline" className="min-h-11" onClick={onRefresh}>{tr("refresh", "Refresh saved record")}</Button> : null}
      {primaryAction ? <Button className="min-h-11 h-auto whitespace-normal" disabled={!!primaryAction.blockedReason || primaryAction.pending} onClick={primaryAction.onClick} data-testid="invoice-next-step-action">{primaryAction.pending ? tr("pending", "Confirming action…") : primaryAction.label}</Button> : null}
      {stage === "draft" ? <Button variant="outline" className="min-h-11" onClick={onReviewLines}>{tr("reviewLines", "Review line items")}</Button> : null}
      {stage === "paid" && onViewPayments ? <Button className="min-h-11" onClick={onViewPayments}>{tr("viewPayments", "View linked payments")}</Button> : stage === "posted" || stage === "paid" ? <a href={paymentsHref} className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{stage === "paid" ? tr("viewPayments", "View linked payments") : tr("openPayments", "Open Payments")}</a> : null}
    </div>
  </section>
}
