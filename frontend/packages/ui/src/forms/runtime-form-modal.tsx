"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import type { FormConfig } from "../lib/form-types"
import { FormModal } from "./form-modal"
import { useRuntimeFormModalConfig } from "./hooks/use-runtime-form-modal-config"
import { metadataFromCustomFields } from "./utils/metadata-defaults"

export interface RuntimeFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  staticConfig: FormConfig
  moduleId: string
  formId?: string
  organizationId: number
  roleId?: string
  userId?: string
  /** Prefer STDB labels/visibility on matched fields (CRM/sales dual-path collapse). */
  preferStdbVisibility?: boolean
  /** Applied after runtime merge (e.g. select options, default values). */
  transformConfig?: (config: FormConfig) => FormConfig
  onSubmit?: (data: Record<string, unknown>) => void | Promise<void>
  className?: string
  closeOnSubmit?: boolean
  showSubmitSuccessToast?: boolean
  submitSuccessMessage?: string
  submitError?: string | null
  formLeadingActions?: React.ReactNode
  isPending?: boolean
  /** When true, `custom:*` keys are folded into a `metadata` JSON string on submit. */
  foldCustomFieldsIntoMetadata?: boolean
  /**
   * `block` is the safe default. Use `use-static` only when the form owner has
   * classified runtime fields, visibility, and relation policy as optional.
   */
  runtimeConfigFailureMode?: "block" | "use-static"
  aiAssist?: React.ComponentProps<typeof FormModal>["aiAssist"]
}

export function RuntimeFormModal({
  open,
  onOpenChange,
  staticConfig,
  moduleId,
  formId,
  organizationId,
  roleId,
  userId,
  preferStdbVisibility = false,
  transformConfig,
  onSubmit,
  foldCustomFieldsIntoMetadata = true,
  runtimeConfigFailureMode = "block",
  submitError,
  ...rest
}: RuntimeFormModalProps) {
  const { config, isLoading, error, customFieldIds } = useRuntimeFormModalConfig({
    staticConfig,
    moduleId,
    formId,
    organizationId,
    roleId,
    userId,
    preferStdbVisibility,
  })

  const resolvedConfig = React.useMemo(() => {
    return transformConfig ? transformConfig(config) : config
  }, [config, transformConfig])

  const handleSubmit = React.useCallback(
    async (data: Record<string, unknown>) => {
      if (!onSubmit) return
      if (foldCustomFieldsIntoMetadata && customFieldIds.length > 0) {
        const metadata = metadataFromCustomFields(data, customFieldIds)
        const core = { ...data }
        for (const id of customFieldIds) {
          delete core[id]
        }
        await onSubmit({ ...core, metadata })
        return
      }
      await onSubmit(data)
    },
    [onSubmit, foldCustomFieldsIntoMetadata, customFieldIds],
  )

  if (open && isLoading) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
        data-testid={`runtime-form-modal-loading-${staticConfig.id}`}
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const runtimeConfigFailed = error != null
  const submissionBlocked = runtimeConfigFailed && runtimeConfigFailureMode === "block"
  const runtimeConfigError = submissionBlocked
    ? `Runtime form configuration is unavailable. Submission is disabled. ${error}`
    : submitError

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      config={runtimeConfigFailed ? staticConfig : resolvedConfig}
      onSubmit={submissionBlocked ? undefined : runtimeConfigFailed ? onSubmit : handleSubmit}
      submissionDisabled={submissionBlocked}
      submitError={runtimeConfigError}
      {...rest}
    />
  )
}
