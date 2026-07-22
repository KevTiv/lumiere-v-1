"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import type { FormConfig } from "../lib/form-types"
import { FormModal } from "../forms/form-modal"

export interface CsvImportModalProps {
  onClose: () => void
  config: FormConfig
  isPending?: boolean
  onImport: (csvText: string) => void | Promise<void>
}

/** File-backed CSV import form with shared validation, read, and error handling. */
export function CsvImportModal({
  onClose,
  config,
  isPending = false,
  onImport,
}: CsvImportModalProps) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const [isReading, setIsReading] = useState(false)

  const handleSubmit = async (data: Record<string, unknown>) => {
    setError(null)
    const files = data.csvFile as FileList | undefined
    const file = files?.[0]
    if (!file) {
      setError(t("common.validation.required"))
      return
    }

    setIsReading(true)
    try {
      await onImport(await file.text())
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIsReading(false)
    }
  }

  return (
    <FormModal
      open
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
      config={config}
      isPending={isPending || isReading}
      closeOnSubmit={false}
      submitError={error}
      onSubmit={handleSubmit}
    />
  )
}
