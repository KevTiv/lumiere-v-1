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
  transformConfig,
  onSubmit,
  foldCustomFieldsIntoMetadata = true,
  ...rest
}: RuntimeFormModalProps) {
  const { config, isLoading, error, customFieldIds } = useRuntimeFormModalConfig({
    staticConfig,
    moduleId,
    formId,
    organizationId,
    roleId,
    userId,
  })

  const resolvedConfig = React.useMemo(() => {
    const base = transformConfig ? transformConfig(config) : config
    return base
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

  if (open && error) {
    return (
      <FormModal
        open={open}
        onOpenChange={onOpenChange}
        config={staticConfig}
        onSubmit={onSubmit}
        {...rest}
      />
    )
  }

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      config={resolvedConfig}
      onSubmit={handleSubmit}
      {...rest}
    />
  )
}
