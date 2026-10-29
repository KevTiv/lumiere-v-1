"use client"
import { i18n, useTranslation } from "@lumiere/i18n"


import { useEffect, useId, useState, type FormEvent } from "react"
import { Button } from "@lumiere/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@lumiere/ui/components/dialog"
import { Label } from "@lumiere/ui/components/label"
import { Textarea } from "@lumiere/ui/components/textarea"

export type PurchasingIntakeReasonKind = "hold" | "reject"

export interface PurchasingIntakeReasonDialogProps {
  kind: PurchasingIntakeReasonKind
  open: boolean
  pending?: boolean
  error?: string | null
  intakeLabel?: string
  onOpenChange: (open: boolean) => void
  onSubmit: (reason: string) => void | Promise<void>
}

const copy = {
  hold: {
    get title() { return i18n.t("purchasing.purchasingIntakeReasonDialog.holdSupplierIntake") },
    get description() { return i18n.t("purchasing.purchasingIntakeReasonDialog.explainWhatMustBeResolvedBeforePurchasingCanContinue") },
    get label() { return i18n.t("purchasing.purchasingIntakeReasonDialog.holdReason") },
    get placeholder() { return i18n.t("purchasing.purchasingIntakeReasonDialog.enterTheReasonForPlacingThisIntakeOnHold") },
    get submit() { return i18n.t("purchasing.purchasingIntakeReasonDialog.placeOnHold") },
    get pending() { return i18n.t("purchasing.purchasingIntakeReasonDialog.placingOnHold") },
  },
  reject: {
    get title() { return i18n.t("purchasing.purchasingIntakeReasonDialog.rejectSupplierIntake") },
    get description() { return i18n.t("purchasing.purchasingIntakeReasonDialog.explainWhyThisSupplierIntakeCannotProceed") },
    get label() { return i18n.t("purchasing.ops.rejectReasonPrompt") },
    get placeholder() { return i18n.t("purchasing.purchasingIntakeReasonDialog.enterTheReasonForRejectingThisIntake") },
    get submit() { return i18n.t("purchasing.purchasingIntakeReasonDialog.rejectIntake") },
    get pending() { return i18n.t("purchasing.purchasingIntakeReasonDialog.rejecting") },
  },
} as const

/** Collects the operator-authored reason before dispatching a hold or rejection. */
export function PurchasingIntakeReasonDialog({
  kind,
  open,
  pending = false,
  error,
  intakeLabel,
  onOpenChange,
  onSubmit,
}: PurchasingIntakeReasonDialogProps) {
  const { t } = useTranslation()
  const [reason, setReason] = useState("")
  const reasonId = useId()
  const content = copy[kind]
  const trimmedReason = reason.trim()

  useEffect(() => {
    if (!open) setReason("")
  }, [open])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!trimmedReason || pending) return
    await onSubmit(trimmedReason)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{content.title}</DialogTitle>
            <DialogDescription>
              {content.description}
              {intakeLabel ? t("purchasing.purchasingIntakeReasonDialog.intake", { value1: intakeLabel }) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={reasonId}>{content.label}</Label>
            <Textarea
              id={reasonId}
              autoFocus
              required
              maxLength={2_000}
              rows={4}
              value={reason}
              placeholder={content.placeholder}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${reasonId}-error` : undefined}
              onChange={(event) => setReason(event.target.value)}
            />
            {error ? <p id={`${reasonId}-error`} className="text-sm text-destructive" role="alert">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              {t("common.cancel")}{" "}</Button>
            <Button type="submit" variant={kind === "reject" ? "destructive" : "default"} disabled={!trimmedReason || pending}>
              {pending ? content.pending : content.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
