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
import type { AiFormAssistConfig, FormConfig, FormPreviewRenderer } from "../lib/form-types"
import { showSemanticOperationOutcome } from "../lib/semantic-operation-outcome"
import { cn } from "../lib/utils"
import { workspaceStyles } from "../lib/workspace-styles"
import { clearFormDraft, useFormDraftStorageKey } from "./form-draft"
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
  /** Opens contextual help for the displayed error without submitting or replacing the form. */
  onExplainError?: (message: string) => void
  /** Passed to {@link ModularForm} — e.g. a destructive action beside Cancel / Submit. */
  formLeadingActions?: React.ReactNode
  /** Forwarded to {@link ModularForm} — e.g. parent mutation `isPending`. */
  isPending?: boolean
  /** Blocks submission while leaving cancel and inspection available. */
  submissionDisabled?: boolean
  /** A durable domain checkpoint protects these values after the dialog closes. */
  hasDurableRecovery?: boolean
  /** Forwarded to {@link ModularForm} to enable advisory AI form fill. */
  aiAssist?: AiFormAssistConfig
  /** Forwarded to {@link ModularForm} — e.g. swap dependent select options when a field changes. */
  onValuesChange?: (values: Record<string, unknown>) => void
  /** Local authoring preview. Receives the same values that validation and submit use. */
  renderPreview?: FormPreviewRenderer
  /** Forwarded to {@link ModularForm}; `false` keeps values out of browser storage. */
  draft?: boolean
  /** Forwarded to {@link ModularForm}; pass the edited record's id. */
  draftKey?: string | number | null
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
  onExplainError,
  formLeadingActions,
  isPending,
  submissionDisabled,
  hasDurableRecovery = false,
  aiAssist,
  onValuesChange,
  renderPreview,
  draft,
  draftKey,
}: FormModalProps) {
  const { t } = useTranslation()
  const [dirty, setDirty] = React.useState(false)
  const [formRevision, setFormRevision] = React.useState(0)
  const [confirmingDiscard, setConfirmingDiscard] = React.useState(false)
  const submittingRef = React.useRef(false)
  const draftStorageKey = useFormDraftStorageKey(config.id, draftKey)
  const [submitting, setSubmitting] = React.useState(false)

  // Clear local dirty and discard state when the dialog closes.
  React.useEffect(() => {
    if (!open) {
      setDirty(false)
      setConfirmingDiscard(false)
    }
  }, [open])

  React.useEffect(() => {
    if (hasDurableRecovery) setConfirmingDiscard(false)
  }, [hasDurableRecovery])

  const navigationDialog = useUnsavedChangesGuard(open && dirty && !hasDurableRecovery, open && (submitting || !!isPending))

  /** Ask before dismissal when edits have no durable recovery checkpoint. */
  const requestOpenChange = (next: boolean) => {
    // Closing during a save loses the form and its eventual failure feedback.
    if (!next && (submittingRef.current || isPending)) return
    if (!next && dirty && !hasDurableRecovery) {
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
      showSemanticOperationOutcome(semanticOutcome)
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
          workspaceStyles.surface,
          "flex max-h-[86dvh] min-h-0 flex-col gap-0 overflow-hidden p-0",
          "sm:has-[[data-form-preview]]:max-w-[min(1200px,calc(100vw-2rem))]",
          className
        )}
      >
        <DialogHeader className={cn(workspaceStyles.pageHeader, "sticky top-0 z-10 min-w-0 flex-shrink-0 bg-card/95 px-4 py-4 pr-12 backdrop-blur sm:px-6 sm:py-5 sm:pr-12")}>
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
              <DialogTitle className={cn(workspaceStyles.sectionTitle, "[overflow-wrap:anywhere]")} data-testid="form-modal-title">
                {config.title}
              </DialogTitle>
              {config.description && (
                <DialogDescription className={cn(workspaceStyles.sectionDescription, "mt-1")}>
                  {config.description}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ModularForm
            key={formRevision}
            config={{ ...config, title: "", description: "", layout: "default" }}
            scrollable
            onSubmit={handleSubmit}
            submitError={submitError}
            onExplainError={onExplainError}
            onCancel={handleCancel}
            leadingActions={formLeadingActions}
            isPending={isPending}
            submissionDisabled={submissionDisabled}
            aiAssist={aiAssist}
            onValuesChange={onValuesChange}
            renderPreview={renderPreview}
            onDirtyChange={setDirty}
            draft={draft}
            draftKey={draftKey}
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
                  // An explicit discard must not come back as a restored draft.
                  if (draft !== false) clearFormDraft(draftStorageKey)
                  // Closing animations can keep the form mounted. Drop its values
                  // and pending draft timer before the dialog can reopen.
                  setFormRevision((revision) => revision + 1)
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
