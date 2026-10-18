"use client"

import { useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "@lumiere/i18n"
import type { AccountMove } from "../lib/accounting-types"
import type { ModuleDataState } from "../lib/module-data-state"
import { ModuleDataNotice } from "../pages/module-data-notice"
import { Button, buttonVariants } from "../components/button"
import { Badge } from "../components/badge"
import { billIntakeReview, type BillIntakeIssue } from "./bill-intake-review-model"

export interface BillIntakeReviewProps {
  organizationId: bigint | number | string
  companyId: bigint | number | string
  bills: readonly AccountMove[]
  lines: readonly Record<string, unknown>[]
  sourceState: ModuleDataState
  onOpenBill?: (bill: AccountMove) => void
  renderDocuments?: (bill: AccountMove) => ReactNode
}

export function BillIntakeReview(props: BillIntakeReviewProps) {
  const { t } = useTranslation()
  const [documentBill, setDocumentBill] = useState<string | null>(null)
  const documentScope = `${String(props.organizationId)}:${String(props.companyId)}`
  const review = useMemo(() => props.sourceState.status === "ready" ? billIntakeReview({ bills: props.bills, lines: props.lines, organizationId: props.organizationId, companyId: props.companyId }) : null,
    [props.bills, props.lines, props.organizationId, props.companyId, props.sourceState.status])
  const labels: Record<BillIntakeIssue, string> = {
    supplier: t("accounting.billIntake.issues.supplier", { defaultValue: "Select supplier" }),
    reference: t("accounting.billIntake.issues.reference", { defaultValue: "Review supplier reference" }),
    "invoice-date": t("accounting.billIntake.issues.invoiceDate", { defaultValue: "Set invoice date" }),
    lines: t("accounting.billIntake.issues.lines", { defaultValue: "Add bill lines" }),
    "line-values": t("accounting.billIntake.issues.lineValues", { defaultValue: "Review line accounts and amounts" }),
    balance: t("accounting.billIntake.issues.balance", { defaultValue: "Balance journal lines" }),
    total: t("accounting.billIntake.issues.total", { defaultValue: "Recalculate bill total" }),
  }
  return <section className="space-y-3 rounded-lg border p-4" aria-label={t("accounting.billIntake.title", { defaultValue: "Bill intake review" })}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold">{t("accounting.billIntake.title", { defaultValue: "Bill intake review" })}</h3>
        <p className="text-sm text-muted-foreground">{t("accounting.billIntake.description", { defaultValue: "Review draft bills, source references and journal lines before posting. Purchase order receipt and matching exceptions are available in Purchasing." })}</p></div>
      <a className={buttonVariants({ variant: "outline", size: "sm" })} href="/purchasing?tab=orders">{t("accounting.billIntake.purchasing", { defaultValue: "Review orders and receipts" })}</a>
    </div>
    {props.sourceState.status !== "ready" ? props.sourceState.status === "loading" ? <p role="status" className="text-sm text-muted-foreground">{t("common.loading", { defaultValue: "Loading…" })}</p> : <ModuleDataNotice state={props.sourceState} /> : !review?.available ? <ModuleDataNotice state={{ status: "error", message: t("accounting.billIntake.scopeUnavailable", { defaultValue: "Bill or journal line ownership is incomplete. Refresh the source records before reviewing intake." }) }} /> : <>
      <p className="text-sm text-muted-foreground">{t("accounting.billIntake.count", { defaultValue: "{{count}} draft bills to review", count: review.items.length })}</p>
      {review.items.length === 0 ? <p className="text-sm">{t("accounting.billIntake.empty", { defaultValue: "No draft bills in this company." })}</p> : <ul className="max-h-80 divide-y overflow-auto">
        {review.items.map(({ bill, issues, lineCount }) => <li key={String(bill.id)} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="space-y-1"><p className="text-sm font-medium">{bill.name || bill.ref || `#${String(bill.id)}`}</p>
            <p className="text-xs text-muted-foreground">{bill.invoicePartnerDisplayName || t("accounting.billIntake.supplierUnavailable", { defaultValue: "Supplier not available" })} · {t("accounting.billIntake.lineCount", { defaultValue: "{{count}} journal lines", count: lineCount })}</p>
            <div className="flex flex-wrap gap-1">{issues.map((issue) => <Badge key={issue} variant="secondary">{labels[issue]}</Badge>)}{issues.length === 0 ? <Badge variant="outline">{t("accounting.billIntake.reviewDetails", { defaultValue: "Review source and posting details" })}</Badge> : null}</div></div>
          {props.onOpenBill ? <Button type="button" variant="outline" size="sm" onClick={() => props.onOpenBill?.(bill)}>{t("accounting.billIntake.openBill", { defaultValue: "Review bill" })}</Button> : null}
          {props.renderDocuments ? <Button type="button" variant="ghost" size="sm" aria-expanded={documentBill === `${documentScope}:${String(bill.id)}`} onClick={() => setDocumentBill((current) => current === `${documentScope}:${String(bill.id)}` ? null : `${documentScope}:${String(bill.id)}`)}>{t("accounting.billDocuments.title", { defaultValue: "Supplier documents and receipts" })}</Button> : null}
          {props.renderDocuments && documentBill === `${documentScope}:${String(bill.id)}` ? <div className="w-full">{props.renderDocuments(bill)}</div> : null}
        </li>)}
      </ul>}
    </>}
  </section>
}
