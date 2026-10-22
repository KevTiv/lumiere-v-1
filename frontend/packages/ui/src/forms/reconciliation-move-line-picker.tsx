"use client"

import { createContext, useContext, type ComponentProps } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Alert, AlertDescription } from "../components/alert"
import { Badge } from "../components/badge"
import { Button } from "../components/button"
import { RecordPicker } from "../components/record-picker"
import type { CustomField } from "../lib/form-types"
import {
  reconciliationMoveLineChoices,
  reconciliationSelectedIds,
  type ReconciliationMoveLineRow,
  type ReconciliationScope,
} from "../lib/reconciliation-widget-choices"

export interface ReconciliationMoveLineContextValue extends ReconciliationScope {
  ready: boolean
  lines: readonly ReconciliationMoveLineRow[]
}

const ReconciliationMoveLineContext = createContext<ReconciliationMoveLineContextValue>({
  organizationId: "", companyId: "", ready: false, lines: [],
})

/** Read-only lookup context. AccountingClient continues to own all operation dispatch. */
export const ReconciliationMoveLineProvider = ReconciliationMoveLineContext.Provider

export function ReconciliationMoveLinePicker({ field, values, value, onChange, error }: ComponentProps<CustomField["component"]>) {
  const { t } = useTranslation()
  const context = useContext(ReconciliationMoveLineContext)
  const selected = reconciliationSelectedIds(value)
  const choices = context.ready ? reconciliationMoveLineChoices(context.lines, context, values ?? {}) : []
  const lineLabel = (line: ReconciliationMoveLineRow) => t("accounting.forms.reconciliationWidget.picker.lineLabel", {
    defaultValue: "{{move}} · {{name}} · Debit {{debit}} · Credit {{credit}}",
    move: String(line.moveName ?? `#${String(line.moveId ?? line.id)}`),
    name: String(line.name ?? `#${String(line.id)}`),
    debit: typeof line.debit === "number" && Number.isFinite(line.debit) ? line.debit.toLocaleString() : "—",
    credit: typeof line.credit === "number" && Number.isFinite(line.credit) ? line.credit.toLocaleString() : "—",
  })
  const unavailable = selected.filter((id) => !choices.some((line) => String(line.id) === id))
  return <div className="flex flex-col gap-3">
    <RecordPicker
      id={field.id}
      data-testid={`form-field-${field.name}`}
      value=""
      options={choices.filter((line) => !selected.includes(String(line.id))).map((line) => ({ value: String(line.id), label: lineLabel(line) }))}
      onChange={(id) => onChange([...selected, id])}
      disabled={field.disabled || !context.ready || !values?.accountId}
      invalid={Boolean(error) || unavailable.length > 0}
      placeholder={t("accounting.forms.reconciliationWidget.picker.chooseLine", { defaultValue: "Add a journal item" })}
      searchPlaceholder={t("accounting.forms.reconciliationWidget.picker.searchLines", { defaultValue: "Search journal items" })}
      emptyText={t("accounting.forms.reconciliationWidget.picker.noLines", { defaultValue: "No matching journal items" })}
    />
    {!context.ready || !values?.accountId ? <p className="text-sm text-muted-foreground">{!context.ready
      ? t("accounting.forms.reconciliationWidget.picker.loading", { defaultValue: "Journal item choices are unavailable until the company data is loaded." })
      : t("accounting.forms.reconciliationWidget.picker.chooseAccount", { defaultValue: "Choose an account first. Journal items will match that account and the selected partner." })}</p> : null}
    {selected.map((id, index) => {
      const line = choices.find((candidate) => String(candidate.id) === id)
      const label = line ? lineLabel(line) : t("accounting.forms.reconciliationWidget.picker.unavailableLine", { defaultValue: "Unavailable journal item #{{id}}", id })
      return <div key={`${id}-${index}`} className="flex items-center justify-between gap-2">
        <Badge variant={line ? "secondary" : "destructive"} className="h-auto whitespace-normal">{label}</Badge>
        <Button type="button" variant="outline" size="sm" disabled={field.disabled} onClick={() => onChange(selected.filter((selectedId) => selectedId !== id))} aria-label={t("accounting.forms.reconciliationWidget.picker.removeLine", { defaultValue: "Remove journal item #{{id}}", id })}>
          {t("common.remove", { defaultValue: "Remove" })}
        </Button>
      </div>
    })}
    {unavailable.length > 0 ? <Alert variant="destructive"><AlertDescription>{t("accounting.forms.reconciliationWidget.picker.staleLines", { defaultValue: "Some selected journal items no longer match the account, partner, or current company. Remove them or restore the matching selection before saving." })}</AlertDescription></Alert> : null}
  </div>
}
