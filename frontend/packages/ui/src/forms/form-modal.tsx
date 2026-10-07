"use client"

import type { SemanticOperationOutcomeDetail } from "@lumiere/query-hooks/semantic-operation-outcome"
import { SEMANTIC_OPERATION_OUTCOME_EVENT } from "@lumiere/query-hooks/semantic-operation-outcome"
import { useTranslation } from "@lumiere/i18n"
import * as Icons from "lucide-react"
import React from "react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/dialog"
import type { AiFormAssistConfig, FormConfig } from "../lib/form-types"
import { cn } from "../lib/utils"
import { ModularForm } from "./modular-form"
import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard"

const sizeClasses: Record<string, string> = {
  md: "sm:max-w-[600px]",
  lg: "sm:max-w-[760px]",
  xl: "sm:max-w-[920px]",
}

export interface FormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: FormConfig
  onSubmit?: (data: Record<string, unknown>) => void | Promise<void>
  className?: string
  /**
   * When false, the modal does not close after submit; call `onOpenChange(false)` from `onSubmit` on success.
   * Use when you handle errors inside `onSubmit` and need to keep the dialog open.
   */
  closeOnSubmit?: boolean
  /**
   * After `onSubmit` resolves without throwing, show Sonner success unless the
   * submit emitted a semantic operation outcome with its own canonical feedback.
   * Defaults: `true` when `closeOnSubmit` is true; `false` when `closeOnSubmit` is false.
   */
  showSubmitSuccessToast?: boolean
  /** Message for Sonner success; defaults to translated `common.formSubmit.saved`. */
  submitSuccessMessage?: string
  /** Shown above the form body (e.g. API / validation errors while the dialog stays open). */
  submitError?: string | null
  /** Passed to {@link ModularForm} — e.g. a destructive action beside Cancel / Submit. */
  formLeadingActions?: React.ReactNode
  /** Forwarded to {@link ModularForm} — e.g. parent mutation `isPending`. */
  isPending?: boolean
  /** Blocks submission while leaving cancel and inspection available. */
  submissionDisabled?: boolean
  /** Forwarded to {@link ModularForm} to enable advisory AI form fill. */
  aiAssist?: AiFormAssistConfig
  /** Forwarded to {@link ModularForm} — e.g. swap dependent select options when a field changes. */
  onValuesChange?: (values: Record<string, unknown>) => void
}

function showSemanticOutcome(detail: SemanticOperationOutcomeDetail): void {
  const action =
    detail.href && detail.actionLabel
      ? {
          label: detail.actionLabel,
          onClick: () => window.location.assign(detail.href!),
        }
      : undefined

  toast.success(detail.message, action ? { action } : undefined)
}

export function FormModal({
  open,
  onOpenChange,
  config,
  onSubmit,
  className,
  closeOnSubmit = true,
  showSubmitSuccessToast,
  submitSuccessMessage,
  submitError,
  formLeadingActions,
  isPending,
  submissionDisabled,
  aiAssist,
  onValuesChange,
}: FormModalProps) {
  const { t } = useTranslation()
  const [dirty, setDirty] = React.useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = React.useState(false)
  const submittingRef = React.useRef(false)
  const [submitting, setSubmitting] = React.useState(false)

  // Nothing survives a closed dialog, so nothing is left to protect.
  React.useEffect(() => {
    if (!open) {
      setDirty(false)
      setConfirmingDiscard(false)
    }
  }, [open])

  const navigationDialog = useUnsavedChangesGuard(open && dirty, open && (submitting || !!isPending))

  /** Dismissals (Cancel, Escape, overlay, X) ask first when fields were edited. */
  const requestOpenChange = (next: boolean) => {
    // Closing during a save loses the form and its eventual failure feedback.
    if (!next && (submittingRef.current || isPending)) return
    if (!next && dirty) {
      setConfirmingDiscard(true)
      return
    }
    onOpenChange(next)
  }

  const handleSubmit = async (data: Record<string, unknown>) => {
    // A form without an admitted submit binding must never report a successful
    // save. Leave it open so the missing binding is visible during integration.
    if (!onSubmit) throw new Error(t("common.formSubmit.noHandler"))

    let semanticOutcome: SemanticOperationOutcomeDetail | undefined
    const captureSemanticOutcome = (event: Event) => {
      const detail = (event as CustomEvent<SemanticOperationOutcomeDetail>).detail
      if (detail.formId === config.id) semanticOutcome = detail
    }

    if (typeof window !== "undefined") {
      window.addEventListener(SEMANTIC_OPERATION_OUTCOME_EVENT, captureSemanticOutcome)
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      await onSubmit(data)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
      if (typeof window !== "undefined") {
        window.removeEventListener(SEMANTIC_OPERATION_OUTCOME_EVENT, captureSemanticOutcome)
      }
    }

    if (closeOnSubmit) {
      onOpenChange(false)
    }

    if (semanticOutcome) {
      showSemanticOutcome(semanticOutcome)
      return
    }

    const shouldToastSuccess =
      showSubmitSuccessToast !== undefined ? showSubmitSuccessToast : closeOnSubmit
    if (shouldToastSuccess) {
      toast.success(submitSuccessMessage ?? t("common.formSubmit.saved"))
    }
  }

  const handleCancel = () => {
    requestOpenChange(false)
  }

  const size = config.size ?? "md"
  const maxW = sizeClasses[size] ?? sizeClasses.md

  // Resolve optional header icon
  const HeaderIcon = config.icon
    ? (Icons as Record<string, unknown>)[config.icon] as React.ComponentType<{ className?: string }> | undefined
    : undefined

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        data-testid={`form-modal-${config.id}`}
        className={cn(
          maxW,
          "max-h-[86vh] gap-0 overflow-hidden border-border bg-card p-0 shadow-2xl",
          className
        )}
      >
        <DialogHeader className="sticky top-0 z-10 flex-shrink-0 border-b border-border/70 bg-card/95 px-6 py-5 backdrop-blur">
          <div className="flex items-center gap-3">
            {HeaderIcon && (
              <div className={cn(
                "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40",
                config.iconColor
              )}>
                <HeaderIcon className={cn("h-4 w-4", config.iconColor ?? "text-muted-foreground")} />
              </div>
            )}
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold leading-tight tracking-[-0.01em]" data-testid="form-modal-title">
                {config.title}
              </DialogTitle>
              {config.description && (
                <DialogDescription className="mt-1 text-sm leading-5">
                  {config.description}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {submitError ? (
            <p className="mb-4 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {submitError}
            </p>
          ) : null}
          <ModularForm
            config={{ ...config, title: "", description: "" }}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            leadingActions={formLeadingActions}
            isPending={isPending}
            submissionDisabled={submissionDisabled}
            aiAssist={aiAssist}
            onValuesChange={onValuesChange}
            onDirtyChange={setDirty}
          />
        </div>
        <AlertDialog open={confirmingDiscard} onOpenChange={setConfirmingDiscard}>
          <AlertDialogContent data-testid="discard-changes-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>{t("common.discardChanges.title", { defaultValue: "Discard changes?" })}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("common.discardChanges.description", {
                  defaultValue: "You have edits that were not saved. They will be lost if you close this form.",
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="discard-changes-keep">
                {t("common.discardChanges.keep", { defaultValue: "Keep editing" })}
              </AlertDialogCancel>
              <AlertDialogAction
                data-testid="discard-changes-confirm"
                onClick={() => {
                  setConfirmingDiscard(false)
                  setDirty(false)
                  onOpenChange(false)
                }}
              >
                {t("common.discardChanges.discard", { defaultValue: "Discard" })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {navigationDialog}
      </DialogContent>
    </Dialog>
  )
}
