"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { moduleCollection } from "@lumiere/ui/lib/module-data-state"
import { useExpenseCardStatementUnmatched, useExpenseSheetsToApprove, useExpensesMissingReceipt, useExpenses, useMatchExpenseCardStatementLine } from "@lumiere/query-hooks/hooks/expenses"
import { ExpenseRecordPicker } from "./expense-record-picker"
import { useExpenseReportDecision } from "./expense-report-decision"
import { cardMatchCandidates, companyWorkflowRows, workflowOptions } from "./expense-workflow-model"

type InboxQueue = "to-approve" | "missing-receipt" | "unmatched-card"

export function ExpensesInboxPanel({ organizationId, companyId, onOpenExpense }: {
  organizationId: number
  companyId: bigint
  onOpenExpense: (row: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId)
  const [queue, setQueue] = useState<InboxQueue>("to-approve")
  const [matchExpenseId, setMatchExpenseId] = useState<{ [statementId: string]: string }>({})
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const matching = useRef(false)
  const approvals = moduleCollection(useExpenseSheetsToApprove(orgId))
  const receipts = moduleCollection(useExpensesMissingReceipt(orgId))
  const cards = moduleCollection(useExpenseCardStatementUnmatched(orgId))
  const expenses = moduleCollection(useExpenses(orgId))
  const match = useMatchExpenseCardStatementLine(orgId)
  const selected = queue === "to-approve" ? approvals : queue === "missing-receipt" ? receipts : cards
  const rows = companyWorkflowRows(selected.rows, orgId, companyId)
  const ready = selected.state.status === "ready" && companyId > 0n
  const decision = useExpenseReportDecision(orgId, companyId, approvals.state.status === "ready")
  const queues: InboxQueue[] = ["to-approve", "missing-receipt", "unmatched-card"]
  const labels = { "to-approve": "toApprove", "missing-receipt": "missingReceipt", "unmatched-card": "unmatchedCard" }

  return <div className="space-y-4" data-testid="expenses-inbox-panel">
    <h2 className="text-lg font-medium">{t("expenses.inbox.title")}</h2>
    <div className="flex flex-wrap gap-2">
      {queues.map(id => <Button key={id} variant={queue === id ? "default" : "outline"} onClick={() => { setQueue(id); setStatus(null) }}
        data-testid={`expenses-inbox-${id}`} aria-pressed={queue === id}>{t(`expenses.inbox.${labels[id]}`)}</Button>)}
    </div>
    <ModuleDataNotice state={selected.state} />
    {selected.state.status === "loading" && <p role="status">{t("common.loading")}</p>}
    {status && <p role="status">{status}</p>}
    {decision.error && <p role="alert" className="text-destructive">{decision.error}</p>}
    {ready && rows.length === 0 && <p>{t("expenses.inbox.empty")}</p>}
    {ready && rows.map(row => {
      const id = String(row.id)
      const options = workflowOptions(cardMatchCandidates(companyWorkflowRows(expenses.rows, orgId, companyId), row))
      return <div key={id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3" data-testid={`expenses-inbox-row-${id}`}>
        <div className="min-w-0 [overflow-wrap:anywhere]">{String(row.name ?? row.externalRef ?? id)}</div>
        {queue === "to-approve" ? <div className="flex flex-wrap gap-2">
          <Button variant="outline" render={<Link href={`/expenses/reports/${id}`} />} nativeButton={false}>{t("expenses.workflowUi.reviewReport")}</Button>
          <Button disabled={decision.isPending || !decision.can("approve")} onClick={() => decision.open("approve", row)}>{t("expenses.workflow.approveReport")}</Button>
          <Button variant="outline" disabled={decision.isPending || !decision.can("refuse")} onClick={() => decision.open("refuse", row)}>{t("expenses.workflow.refuseReport")}</Button>
        </div> : queue === "missing-receipt" ? <Button variant="outline" onClick={() => onOpenExpense(row)}>{t("expenses.workflowUi.attachReceipt")}</Button> : <div className="flex min-w-0 flex-wrap items-end gap-2">
          <ModuleDataNotice state={expenses.state} />
          <ExpenseRecordPicker label={t("expenses.workflowUi.expense")} value={matchExpenseId[id] ?? ""} options={options}
            onChange={value => setMatchExpenseId(current => ({ ...current, [id]: value }))} disabled={busy || expenses.state.status !== "ready"} />
          <Button disabled={busy || expenses.state.status !== "ready" || !options.some(option => option.value === matchExpenseId[id])}
            onClick={async () => {
              if (matching.current) return
              matching.current = true; setBusy(true); setStatus(null)
              try {
                await match.mutateAsync({ statementLineId: id, expenseId: matchExpenseId[id]! })
                setStatus(t("expenses.ops.matched")); setMatchExpenseId(current => ({ ...current, [id]: "" }))
              } catch (cause) { setStatus(cause instanceof Error ? cause.message : String(cause)) }
              finally { matching.current = false; setBusy(false) }
            }}>{t("expenses.ops.match")}</Button>
        </div>}
      </div>
    })}
    {decision.modal}
  </div>
}
