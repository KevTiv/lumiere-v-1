"use client"

import { useId } from "react"
import { useTranslation } from "@lumiere/i18n"
import { RecordPicker, type RecordPickerOption } from "@lumiere/ui/components/record-picker"

/** Keep a persistent accessible label above every specialist record choice. */
export function ExpenseRecordPicker({ label, value, onChange, options, disabled, testId }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly RecordPickerOption[]
  disabled?: boolean
  testId?: string
}) {
  const id = useId()
  const { t } = useTranslation()
  return <div className="min-w-0 space-y-1">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <RecordPicker id={id} value={value} onChange={onChange} options={options}
      disabled={disabled} data-testid={testId} placeholder={t("expenses.workflowUi.selectRecord")}
      searchPlaceholder={t("common.search")} emptyText={t("expenses.workflowUi.noRecords")} />
  </div>
}
