"use client"

import * as React from "react"
import { ConfigurableForm, useFormConfiguration } from "@lumiere/ui/forms"
import type { MergedFormConfiguration } from "@lumiere/ui/forms"
import { Loader2 } from "lucide-react"

interface JournalEntryFormProps {
  organizationId: number
  roleId: string
  userId?: string
  initialValues?: Record<string, unknown>
  onSubmit: (data: Record<string, unknown>) => void | Promise<void>
  onCancel?: () => void
  disabled?: boolean
  className?: string
}

export function JournalEntryForm({
  organizationId,
  roleId,
  userId,
  initialValues,
  onSubmit,
  onCancel,
  disabled = false,
  className,
}: JournalEntryFormProps) {
  const { config, isLoading, error } = useFormConfiguration({
    moduleId: "journal",
    formId: "daily-entry",
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
        submittedAt: new Date().toISOString(),
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
        {error || "Form configuration not found"}
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
      submitLabel="Save Entry"
      cancelLabel="Discard"
      disabled={disabled}
      className={className}
      showDescription={true}
    />
  )
}

export default JournalEntryForm
