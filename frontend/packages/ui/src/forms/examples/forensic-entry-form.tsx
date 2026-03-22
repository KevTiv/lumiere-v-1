"use client"

import * as React from "react"
import { useTranslation } from "@lumiere/i18n"
import { ConfigurableForm, useFormConfiguration } from "@lumiere/ui/forms"
import { Loader2 } from "lucide-react"

interface ForensicEntryFormProps {
  organizationId: number
  roleId: string
  userId?: string
  initialValues?: Record<string, unknown>
  onSubmit: (data: Record<string, unknown>) => void | Promise<void>
  onCancel?: () => void
  disabled?: boolean
  className?: string
}

export function ForensicEntryForm({
  organizationId,
  roleId,
  userId,
  initialValues,
  onSubmit,
  onCancel,
  disabled = false,
  className,
}: ForensicEntryFormProps) {
  const { t } = useTranslation()
  const { config, isLoading, error } = useFormConfiguration({
    moduleId: "forensic",
    formId: "incident-report",
    organizationId,
    roleId,
    userId,
    useDefaultIfMissing: true,
  })

  const handleSubmit = React.useCallback(
    async (data: Record<string, unknown>) => {
      await onSubmit({
        ...data,
        organizationId,
        roleId,
        userId,
        reportedAt: new Date().toISOString(),
      })
    },
    [onSubmit, organizationId, roleId, userId]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (error || !config) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        {error || t("common.noData")}
      </div>
    )
  }

  return (
    <ConfigurableForm
      config={config}
      isLoading={false}
      onSubmit={handleSubmit}
      onCancel={onCancel}
      defaultValues={initialValues}
      submitLabel={t("common.submit")}
      cancelLabel={t("common.cancel")}
      disabled={disabled}
      className={className}
      showDescription={true}
      layout="sections"
    />
  )
}

export default ForensicEntryForm
