"use client"

import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { Button } from "@lumiere/ui/components/button"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@lumiere/ui/components/dialog"
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
    title: "Hold supplier intake",
    description: "Explain what must be resolved before purchasing can continue.",
    label: "Hold reason",
    placeholder: "Enter the reason for placing this intake on hold",
    submit: "Place on hold",
    pending: "Placing on hold…",
  },
  reject: {
    title: "Reject supplier intake",
    description: "Explain why this supplier intake cannot proceed.",
    label: "Rejection reason",
    placeholder: "Enter the reason for rejecting this intake",
    submit: "Reject intake",
    pending: "Rejecting…",
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
  const [reason, setReason] = useState("")
  const reasonInput = useRef<HTMLTextAreaElement>(null)
  const formId = useId()
  const reasonId = `${formId}-reason`
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
      <DialogContent size="form" layout="bounded" initialFocus={reasonInput}>
        <DialogHeader>
          <DialogTitle>{content.title}</DialogTitle>
          <DialogDescription>
            {content.description}
            {intakeLabel ? ` Intake: ${intakeLabel}.` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form id={formId} onSubmit={submit} className="grid gap-2">
            <Label htmlFor={reasonId}>{content.label}</Label>
            <Textarea
              id={reasonId}
              ref={reasonInput}
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
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant={kind === "reject" ? "destructive" : "default"} disabled={!trimmedReason || pending}>
            {pending ? content.pending : content.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
