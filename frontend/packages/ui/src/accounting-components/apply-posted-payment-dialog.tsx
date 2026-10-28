"use client"

import { useId, useRef, useState } from "react"
import { WorkflowError } from "@lumiere/erp-workflows"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "../components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/dialog"
import { Label } from "../components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/select"
import type { ModuleDataState } from "../lib/module-data-state"
import { ModuleDataNotice } from "../pages/module-data-notice"
import { useUnsavedChangesGuard } from "../forms/use-unsaved-changes-guard"

export interface ApplyPostedPaymentDialogProps {
  options: Array<{ value: string; label: string }>
  sourceState: ModuleDataState
  canApply: boolean
  isPending: boolean
  onApply: (paymentId: string) => Promise<void>
  onClose: () => void
}

export function ApplyPostedPaymentDialog({ options, sourceState, canApply, isPending, onApply, onClose }: ApplyPostedPaymentDialogProps) {
  const { t } = useTranslation()
  const tr = (key: string, defaultValue: string) => t(`accounting.applyPayment.${key}`, { defaultValue })
  const id = useId()
  const [selected, setSelected] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const busy = useRef(false)
  const pending = isPending || submitting
  const ready = sourceState.status === "ready"
  const eligible = !unconfirmed && ready && canApply && options.some((option) => option.value === selected)
  const navigationDialog = useUnsavedChangesGuard(false, pending)
  const submit = async () => {
    if (busy.current || pending || !eligible) return
    busy.current = true
    setSubmitting(true)
    setError(null)
    try { await onApply(selected); onClose() }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); if (failure instanceof WorkflowError && failure.needsReadback) setUnconfirmed(true) }
    finally { busy.current = false; setSubmitting(false) }
  }
  return <>
    <Dialog open onOpenChange={(open) => { if (!open && !busy.current && !isPending) onClose() }}>
      <DialogContent className="flex max-h-[86dvh] flex-col overflow-hidden" data-testid="apply-posted-payment-dialog">
        <DialogHeader>
          <DialogTitle>{tr("title", "Apply existing payment")}</DialogTitle>
          <DialogDescription>{tr("description", "Choose a payment already posted in Payments. This links it to this document and updates the outstanding balance. It does not charge a customer or transfer money.")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto py-2">
          <ModuleDataNotice state={sourceState} />
          {!ready && sourceState.status === "loading" ? <p role="status" className="text-sm text-muted-foreground">{tr("loading", "Loading posted payments…")}</p> : null}
          {!canApply ? <p role="status" className="text-sm">{tr("denied", "You need permission to apply payments. Ask your accounting administrator.")}</p> : null}
          {ready && options.length === 0 ? <div className="space-y-2 rounded-lg border border-dashed p-4">
            <p className="text-sm font-medium">{tr("empty", "No posted payments available")}</p>
            <p className="text-sm text-muted-foreground">{tr("emptyHint", "Open Payments to record a payment for this company and complete any required approval and posting, then return to apply it here.")}</p>
          </div> : null}
          {ready && options.length > 0 ? <div className="space-y-2">
            <Label htmlFor={id}>{tr("payment", "Posted payment")}</Label>
            <Select value={selected} onValueChange={setSelected} disabled={pending || unconfirmed || !canApply}>
              <SelectTrigger id={id} className="min-h-11 w-full"><SelectValue placeholder={tr("choose", "Choose a posted payment")} /></SelectTrigger>
              <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
            {selected && !eligible && canApply ? <p role="status" className="text-sm">{tr("changed", "The selected payment is no longer available. Choose a current posted payment.")}</p> : null}
          </div> : null}
          {unconfirmed ? <p role="status" className="text-sm">{tr("unconfirmed", "The result is unconfirmed. Review the saved payment and document balance in Payments before trying another application.")}</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {!pending ? <a href="/accounting?tab=payments" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">{tr("openPayments", "Open Payments")}</a> : null}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" disabled={pending} onClick={onClose}>{t("common.cancel")}</Button>
          <Button disabled={pending || !eligible} onClick={() => void submit()}>{pending ? tr("pending", "Confirming payment…") : tr("submit", "Apply payment")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {navigationDialog}
  </>
}
