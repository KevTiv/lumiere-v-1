"use client"

import { useEffect, useRef, useState } from "react"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { companyWorkflowRows } from "./expense-workflow-model"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { Textarea } from "@lumiere/ui/components/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@lumiere/ui/components/dialog"
import { useApproveExpenseSheet, useRefuseExpenseSheet, useSubmitExpenseSheet } from "@lumiere/query-hooks/hooks/expenses"
import { expenseVariantTag } from "../../../lib/expense-state"
import type { ExpenseWorkflowRow } from "./expense-workflow-model"

export type ExpenseReportDecision = "submit" | "approve" | "refuse"

/** One confirmation owner for list, report page and inbox. Failed requests retain the reason. */
export function useExpenseReportDecision(orgId: bigint, companyId: bigint, enabled = true) {
  const { t } = useTranslation()
  const { checkPermission, permissionsReady } = useRBAC()
  const can = (kind: ExpenseReportDecision) => permissionsReady !== false && checkPermission("hr_expense_sheet", kind === "submit" ? "update" : "approve").allowed
  const [active, setActive] = useState<{ kind: ExpenseReportDecision; row: ExpenseWorkflowRow } | null>(null)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  const submit = useSubmitExpenseSheet(orgId, companyId)
  const approve = useApproveExpenseSheet(orgId, companyId)
  const refuse = useRefuseExpenseSheet(orgId)
  useEffect(() => { setActive(null); setReason(""); setError(null) }, [orgId, companyId, enabled])

  const open = (kind: ExpenseReportDecision, row: ExpenseWorkflowRow) => {
    if (!enabled || !can(kind) || inFlight.current || !row.id || companyWorkflowRows([row], orgId, companyId).length === 0) return
    if (expenseVariantTag(row.state) !== (kind === "submit" ? "Draft" : "Submitted")) return
    setError(null); setReason(""); setActive({ kind, row })
  }
  const close = () => { if (!inFlight.current) { setActive(null); setReason("") } }
  const confirm = async () => {
    if (!active || !enabled || !can(active.kind) || inFlight.current) return
    if (active.kind === "refuse" && !reason.trim()) {
      setError(t("expenses.workflow.refuseReasonRequired", { defaultValue: "Enter a reason before refusing this report." })); return
    }
    inFlight.current = true; setPending(true); setError(null)
    try {
      const sheetId = String(active.row.id)
      if (active.kind === "submit") await submit.mutateAsync(sheetId)
      else if (active.kind === "approve") await approve.mutateAsync(sheetId)
      else await refuse.mutateAsync({ sheetId, params: { reason: reason.trim() } })
      setActive(null); setReason("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("expenses.workflow.financeFailed"))
    } finally { inFlight.current = false; setPending(false) }
  }
  const label = active ? t(`expenses.workflow.${active.kind === "submit" ? "submitReport" : active.kind === "approve" ? "approveReport" : "refuseReport"}`) : ""
  const modal = <Dialog open={active !== null && enabled} onOpenChange={open => { if (!open) close() }}>
    <DialogContent data-testid="expense-report-confirm">
      <DialogHeader><DialogTitle>{label}</DialogTitle>
        <DialogDescription>{String(active?.row.name ?? "")} · {active ? t(`expenses.workflowUi.${active.kind}Effect`) : ""}</DialogDescription>
      </DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {active?.kind === "refuse" && <div className="space-y-2">
        <label htmlFor="expense-report-refuse-reason">{t("expenses.workflow.refuseReason")}</label>
        <Textarea id="expense-report-refuse-reason" data-testid="expense-report-refuse-reason" value={reason}
          onChange={event => setReason(event.target.value)} required disabled={pending} aria-invalid={Boolean(error) && !reason.trim()} />
      </div>}
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={close}>{t("common.cancel")}</Button>
        <Button variant={active?.kind === "refuse" ? "destructive" : "default"} disabled={pending || !enabled || !active || !can(active.kind)}
          onClick={() => { void confirm() }}>{pending ? t("common.loading") : label}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  return { open, modal, isPending: pending, error, can }
}
