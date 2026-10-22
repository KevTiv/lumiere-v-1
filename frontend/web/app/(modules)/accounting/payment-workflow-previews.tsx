"use client"

import { useTranslation } from "@lumiere/i18n"
import { unwrapSome } from "@lumiere/erp-shared/form-coercion"
import { stdbTimestampToDate } from "@lumiere/erp-shared/timestamp-values"
import type { FormValues } from "@lumiere/ui/lib/form-types"
import { Alert, AlertDescription } from "@lumiere/ui/components/alert"
import { Badge } from "@lumiere/ui/components/badge"
import { Button } from "@lumiere/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lumiere/ui/components/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@lumiere/ui/components/table"
import { TablePager, usePagedRows } from "@lumiere/ui/components/table-pager"
import { paymentId, paymentInputAmount, statementBalanceReview, statementRowReview, type AllocationItem, type AllocationSource, type PaymentLookupRow, type PreparedStatementImport, type WorkflowReadback } from "./payment-workflow-model"

export const displayPaymentAmount = (amount: number | null) => amount == null ? "—" : amount.toLocaleString(undefined, { maximumFractionDigits: 6 })

export function WorkflowRequestStatus({ result, requestState, onCheck, checking }: {
  result: WorkflowReadback; requestState: "accepted" | "unknown"; onCheck: () => void; checking: boolean
}) {
  const { t } = useTranslation()
  return <div className="flex flex-col gap-3" data-testid="payment-workflow-result">
    <Alert variant={result.kind === "confirmed" ? "default" : "destructive"}><AlertDescription>{result.kind === "confirmed"
      ? t("accounting.workflowTools.confirmed", { defaultValue: "Confirmed server record #{{id}}. Review the saved result before continuing.", id: String(result.id) })
      : result.kind === "ambiguous"
        ? t("accounting.workflowTools.ambiguous", { defaultValue: "More than one result matches this request. Do not submit again. Resolve the duplicate records first." })
        : result.kind === "conflict"
          ? t("accounting.workflowTools.conflict", { defaultValue: "The saved result does not match the submitted request. Do not submit again. Review the server records." })
          : requestState === "accepted"
            ? t("accounting.workflowTools.accepted", { defaultValue: "The request was accepted. The saved result is not confirmed yet. Check its status before another submission." })
            : t("accounting.workflowTools.unknown", { defaultValue: "The request result is unknown. Check its status before another submission." })}</AlertDescription></Alert>
    <Button type="button" variant="outline" disabled={checking} onClick={onCheck}>{t("accounting.workflowTools.checkStatus", { defaultValue: "Check request status" })}</Button>
  </div>
}

export function StatementImportReview({ review, submitted, result, requestState, onCheck, checking, journalLabel, currencyLabel }: {
  review: PreparedStatementImport | null; submitted: boolean; result: WorkflowReadback; requestState: "accepted" | "unknown" | null
  onCheck: () => void; checking: boolean; journalLabel: string; currencyLabel: string
}) {
  const { t } = useTranslation()
  const pager = usePagedRows(review?.params.rows ?? [])
  const summary = review ? statementBalanceReview(review) : null
  return <Card data-testid="statement-import-review">
    <CardHeader><CardTitle>{t("accounting.workflowTools.importReview", { defaultValue: "Statement review" })}</CardTitle><CardDescription>{journalLabel} · {currencyLabel}</CardDescription><div><Badge variant="outline">{submitted
      ? t("accounting.workflowTools.submitted", { defaultValue: "Submitted request" })
      : t("accounting.workflowTools.localOnly", { defaultValue: "Local review · not staged" })}</Badge></div></CardHeader>
    <CardContent className="flex flex-col gap-4">
      {review && summary ? <>
        <p>{review.params.fileName}</p>
        <p className="text-sm text-muted-foreground">{t("accounting.workflowTools.company", { defaultValue: "Company #{{id}}", id: String(review.companyId) })}</p>
        {submitted ? <p className="break-all font-mono text-xs">{t("accounting.workflowTools.requestKey", { defaultValue: "Request key: {{key}}", key: review.params.idempotencyKey })}</p> : null}
        <p>{t("accounting.workflowTools.rowCounts", { defaultValue: "{{total}} rows · {{valid}} pass local checks · {{invalid}} need review", total: review.params.rows.length, valid: summary.validRows, invalid: summary.invalidRows })}</p>
        <Table><TableHeader><TableRow><TableHead>{t("accounting.workflowTools.balance", { defaultValue: "Balance review" })}</TableHead><TableHead className="text-right">{t("accounting.workflowTools.amount", { defaultValue: "Amount" })}</TableHead></TableRow></TableHeader><TableBody>
          <TableRow><TableCell>{t("accounting.workflowTools.opening", { defaultValue: "Opening balance" })}</TableCell><TableCell className="text-right">{displayPaymentAmount(review.params.openingBalance)}</TableCell></TableRow>
          <TableRow><TableCell>{t("accounting.workflowTools.movements", { defaultValue: "Movement from locally valid rows" })}</TableCell><TableCell className="text-right">{displayPaymentAmount(summary.movement)}</TableCell></TableRow>
          <TableRow><TableCell>{t("accounting.workflowTools.closing", { defaultValue: "Estimated closing balance" })}</TableCell><TableCell className="text-right">{displayPaymentAmount(summary.closing)}</TableCell></TableRow>
        </TableBody></Table>
        {!summary.withinEnvelope ? <Alert variant="destructive"><AlertDescription>{t("accounting.workflowTools.envelope", { defaultValue: "The opening balance, movement, or closing balance exceeds the supported money range. Correct the setup or file before staging." })}</AlertDescription></Alert> : null}
        {summary.invalidRows > 0 ? <Alert><AlertDescription>{t("accounting.workflowTools.incompleteBalance", { defaultValue: "The estimated balance excludes rows with local errors. Staging keeps invalid rows for server review; it does not approve them." })}</AlertDescription></Alert> : null}
        <Table><TableHeader><TableRow>
          <TableHead>{t("accounting.workflowTools.row", { defaultValue: "Row" })}</TableHead><TableHead>{t("accounting.workflowTools.date", { defaultValue: "Date" })}</TableHead><TableHead>{t("accounting.workflowTools.reference", { defaultValue: "Reference / description" })}</TableHead><TableHead>{t("accounting.workflowTools.amount", { defaultValue: "Amount" })}</TableHead><TableHead>{t("accounting.workflowTools.validation", { defaultValue: "Local check" })}</TableHead>
        </TableRow></TableHeader><TableBody>{pager.pageRows.map((row) => {
          const issue = statementRowReview(row)
          const message = issue === "date" ? t("accounting.workflowTools.invalidDate", { defaultValue: "Missing or invalid date" })
            : issue === "amount" ? t("accounting.workflowTools.invalidAmount", { defaultValue: "Missing or invalid amount" })
              : issue === "zero" ? t("accounting.workflowTools.zeroAmount", { defaultValue: "Amount must not be zero" })
                : issue === "envelope" ? t("accounting.workflowTools.rowEnvelope", { defaultValue: "Amount exceeds the supported money range" }) : t("accounting.workflowTools.valid", { defaultValue: "Ready for server validation" })
          return <TableRow key={row.rowNumber}><TableCell>{row.rowNumber}</TableCell><TableCell>{stdbTimestampToDate(row.date)?.toISOString().slice(0, 10) ?? "—"}</TableCell><TableCell>{row.reference ?? "—"}<p className="text-sm text-muted-foreground">{row.description}</p></TableCell><TableCell>{displayPaymentAmount(row.amount ?? null)}</TableCell><TableCell><Badge variant={issue ? "destructive" : "secondary"}>{message}</Badge></TableCell></TableRow>
        })}</TableBody></Table>
        <TablePager {...pager} />
      </> : <Alert><AlertDescription>{t("accounting.workflowTools.reviewFirst", { defaultValue: "Choose a CSV file and statement setup, then select Review CSV. No rows are sent to the server during this review." })}</AlertDescription></Alert>}
      {submitted && requestState ? <WorkflowRequestStatus result={result} requestState={requestState} onCheck={onCheck} checking={checking} /> : null}
    </CardContent>
  </Card>
}

export interface SubmittedAllocation {
  transaction: PaymentLookupRow; item: AllocationItem; available: number
  params: import("@lumiere/stdb/types").AllocatePaymentParams
}

export function PaymentAllocationReview({ values, source, submitted, result, requestState, onCheck, checking, currencyLabel, partnerLabel }: {
  values: FormValues; source: AllocationSource; submitted: SubmittedAllocation | null; result: WorkflowReadback
  requestState: "accepted" | "unknown" | null; onCheck: () => void; checking: boolean; currencyLabel: string; partnerLabel: string
}) {
  const { t } = useTranslation()
  const transaction = submitted?.transaction ?? (source.kind === "ready" ? source.transaction : null)
  const item = submitted?.item ?? (source.kind === "ready" ? source.items.find((candidate) => paymentId(candidate.line.id) === paymentId(values.allocatedMoveLineId)) : null)
  const available = submitted?.available ?? (source.kind === "ready" ? source.available : null)
  const applied = submitted?.params.allocatedAmount ?? paymentInputAmount(values.allocatedAmount)
  const writeOff = submitted?.params.writeOffAmount ?? (values.writeOffEnabled === true ? paymentInputAmount(values.writeOffAmount) : 0)
  const afterPayment = available != null && applied != null ? available - applied : null
  const afterItem = item && applied != null && writeOff != null ? item.residual - applied - writeOff : null
  return <Card data-testid="payment-allocation-review">
    <CardHeader><CardTitle>{t("accounting.workflowTools.allocationReview", { defaultValue: "Allocation review" })}</CardTitle><CardDescription>{partnerLabel} · {currencyLabel}</CardDescription><div><Badge variant="outline">{submitted ? t("accounting.workflowTools.submitted", { defaultValue: "Submitted request" }) : t("accounting.workflowTools.unsavedAllocation", { defaultValue: "Unsaved allocation" })}</Badge></div></CardHeader>
    <CardContent className="flex flex-col gap-4">
      {transaction ? <p className="text-sm text-muted-foreground">{t("accounting.workflowTools.postedPayment", { defaultValue: "Posted payment · company #{{id}}", id: String(transaction.companyId) })}</p> : null}
      {submitted ? <p className="break-all font-mono text-xs">{t("accounting.workflowTools.requestKey", { defaultValue: "Request key: {{key}}", key: submitted.params.idempotencyKey })}</p> : null}
      {transaction ? <p>{String(unwrapSome(transaction.externalReference) ?? `#${String(transaction.id)}`)} · #{String(transaction.id)}</p> : null}
      {source.kind === "unavailable" && !submitted ? <Alert variant="destructive"><AlertDescription>{t("accounting.workflowTools.unavailableAllocation", { defaultValue: "The authorized payment or open-item data is unavailable. Refresh the data before allocating. Missing balances are not treated as zero." })}</AlertDescription></Alert> : null}
      {source.kind === "ready" && source.items.length === 0 && !submitted ? <Alert><AlertDescription>{t("accounting.workflowTools.noOpenItems", { defaultValue: "No readable posted invoice or bill items match this payment's partner, currency, and required account type." })}</AlertDescription></Alert> : null}
      {item ? <p>{String(item.move.name ?? item.move.id)} · {String(item.line.name ?? item.line.id)} · #{String(item.line.id)}</p> : null}
      <Table><TableHeader><TableRow><TableHead>{t("accounting.workflowTools.balance", { defaultValue: "Balance review" })}</TableHead><TableHead className="text-right">{t("accounting.workflowTools.amount", { defaultValue: "Amount" })}</TableHead></TableRow></TableHeader><TableBody>
        <TableRow><TableCell>{t("accounting.workflowTools.paymentAvailable", { defaultValue: "Payment available before allocation" })}</TableCell><TableCell className="text-right">{displayPaymentAmount(available)}</TableCell></TableRow>
        <TableRow><TableCell>{t("accounting.workflowTools.itemOutstanding", { defaultValue: "Selected item outstanding" })}</TableCell><TableCell className="text-right">{displayPaymentAmount(item?.residual ?? null)}</TableCell></TableRow>
        <TableRow><TableCell>{t("accounting.workflowTools.applied", { defaultValue: "Applied from this payment" })}</TableCell><TableCell className="text-right">{displayPaymentAmount(applied)}</TableCell></TableRow>
        <TableRow><TableCell>{t("accounting.workflowTools.writeOff", { defaultValue: "Separate write-off" })}</TableCell><TableCell className="text-right">{displayPaymentAmount(writeOff)}</TableCell></TableRow>
        <TableRow><TableCell>{t("accounting.workflowTools.paymentAfter", { defaultValue: "Estimated payment left unapplied" })}</TableCell><TableCell className="text-right">{displayPaymentAmount(afterPayment)}</TableCell></TableRow>
        <TableRow><TableCell>{t("accounting.workflowTools.itemAfter", { defaultValue: "Estimated item balance after allocation" })}</TableCell><TableCell className="text-right">{displayPaymentAmount(afterItem)}</TableCell></TableRow>
      </TableBody></Table>
      {(afterPayment != null && afterPayment < 0) || (afterItem != null && afterItem < 0) ? <Alert variant="destructive"><AlertDescription>{t("accounting.workflowTools.overAllocation", { defaultValue: "The entered amounts exceed a displayed balance. Review the amounts before submitting." })}</AlertDescription></Alert> : null}
      <p className="text-sm text-muted-foreground">{t("accounting.workflowTools.allocationAdvisory", { defaultValue: "These are read-only estimates from authorized records. The server validates current eligibility, amounts, and rounding. Unapplied payment credit is not a write-off." })}</p>
      {submitted && requestState ? <WorkflowRequestStatus result={result} requestState={requestState} onCheck={onCheck} checking={checking} /> : null}
    </CardContent>
  </Card>
}
