"use client"


import React from "react"
import { useTranslation } from "@lumiere/i18n"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/dialog"
import { cn } from "../lib/utils"
import type { AiFormAssistConfig, FormConfig } from "../lib/form-types"
import { ModularForm } from "./modular-form"
import * as Icons from "lucide-react"

const sizeClasses: Record<string, string> = {
  md: "sm:max-w-[600px]",
  lg: "sm:max-w-[760px]",
  xl: "sm:max-w-[920px]",
}

interface FormModalProps {
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
   * After `onSubmit` resolves without throwing, show Sonner success.
   * Defaults: `true` when `closeOnSubmit` is true; `false` when `closeOnSubmit` is false (avoid duplicate toasts for flows that close manually).
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
  /** Forwarded to {@link ModularForm} to enable advisory AI form fill. */
  aiAssist?: AiFormAssistConfig
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
  aiAssist,
}: FormModalProps) {
  const { t } = useTranslation()

  const handleSubmit = async (data: Record<string, unknown>) => {
    if (onSubmit) {
      await onSubmit(data)
    }
    if (closeOnSubmit) {
      onOpenChange(false)
    }
    const shouldToastSuccess =
      showSubmitSuccessToast !== undefined ? showSubmitSuccessToast : closeOnSubmit
    if (shouldToastSuccess) {
      toast.success(submitSuccessMessage ?? t("common.formSubmit.saved"))
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  const size = config.size ?? "md"
  const maxW = sizeClasses[size] ?? sizeClasses.md

  // Resolve optional header icon
  const HeaderIcon = config.icon
    ? (Icons as Record<string, unknown>)[config.icon] as React.ComponentType<{ className?: string }> | undefined
    : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            aiAssist={aiAssist}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
