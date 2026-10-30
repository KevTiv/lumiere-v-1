"use client"

import { useTranslation } from "@lumiere/i18n"
import { Button } from "../components/button"
import { Input } from "../components/input"
import { Label } from "../components/label"
import { RecordPicker, type RecordPickerOption } from "../components/record-picker"
import type { CustomField } from "../lib/form-types"
import type { ModuleDataState } from "../lib/module-data-state"

export interface ExpenseAllocationDraft {
  projectId: string
  analyticAccountId: string
  sharePercent: string
  billable: boolean
}

export interface ExpenseAllocationChoices {
  projectOptions: readonly RecordPickerOption[]
  analyticAccountOptions: readonly RecordPickerOption[]
  projectsState: ModuleDataState
  analyticAccountsState: ModuleDataState
}

export interface ExpenseAllocationField extends CustomField, ExpenseAllocationChoices {}

export const newExpenseAllocationDraft = (first = false): ExpenseAllocationDraft => ({
  projectId: "", analyticAccountId: "", sharePercent: first ? "100" : "", billable: first,
})

function isAllocationDraft(value: unknown): value is ExpenseAllocationDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const row = value as Partial<ExpenseAllocationDraft>
  return typeof row.projectId === "string" && typeof row.analyticAccountId === "string"
    && typeof row.sharePercent === "string" && typeof row.billable === "boolean"
}

export function ExpenseAllocationLines({ field, value, onChange, error }: {
  field: CustomField
  value: unknown
  onChange: (value: unknown) => void
  error?: string
}) {
  const { t } = useTranslation()
  const choices = field as ExpenseAllocationField
  const validShape = Array.isArray(value) && value.every(isAllocationDraft)
  const rows = validShape ? value : []
  const update = (index: number, patch: Partial<ExpenseAllocationDraft>) => {
    onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row))
  }
  const shares = rows.map((row) => row.sharePercent === "" ? 0 : Number(row.sharePercent))
  const total = shares.reduce((sum, share) => sum + share, 0)
  const totalKnown = shares.every(Number.isFinite)
  const totalValid = totalKnown && Math.abs(total - 100) <= 0.01
  const sourceNotice = (state: ModuleDataState, label: string) => state.status === "ready" ? null : (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
      <span>{label}: {t(`expenses.allocations.sources.${state.status}`, { defaultValue: state.status === "loading" ? "Loading choices…" : state.status === "denied" ? "Access restricted" : "Choices could not be verified" })}</span>
      {"onRetry" in state && state.onRetry ? <Button type="button" variant="outline" size="sm" disabled={field.disabled} onClick={state.onRetry}>{t("common.retry")}</Button> : null}
    </div>
  )
  const projectLabel = t("expenses.allocations.project", { defaultValue: "Project" })
  const accountLabel = t("expenses.allocations.analyticAccount", { defaultValue: "Analytic account" })
  return <div className="space-y-4">
    {!validShape ? <div role="alert" className="space-y-2 text-sm text-destructive"><p>{t("expenses.allocations.invalidDraft", { defaultValue: "The retained allocation rows could not be read. Start replacement rows before saving." })}</p><Button type="button" variant="outline" disabled={field.disabled} onClick={() => onChange([newExpenseAllocationDraft(true)])}>{t("expenses.allocations.startRows", { defaultValue: "Start replacement rows" })}</Button></div> : null}
    {sourceNotice(choices.projectsState, projectLabel)}
    {sourceNotice(choices.analyticAccountsState, accountLabel)}
    {choices.projectsState.status === "ready" && choices.analyticAccountsState.status === "ready" && choices.projectOptions.length === 0 && choices.analyticAccountOptions.length === 0 ? <p role="status" className="text-sm">{t("expenses.allocations.noChoices", { defaultValue: "No company projects or active analytic accounts are available. Ask an administrator to complete allocation setup." })}</p> : null}
    {rows.map((row, index) => <fieldset key={index} className="min-w-0 space-y-3 rounded-lg border p-3" disabled={field.disabled}>
      <legend className="px-1 text-sm font-medium">{t("expenses.allocations.row", { defaultValue: "Allocation {{number}}", number: index + 1 })}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`allocation-project-${index}`}>{projectLabel}</Label>
          <RecordPicker id={`allocation-project-${index}`} value={row.projectId} onChange={(projectId) => update(index, { projectId })} options={[{ value: "", label: t("expenses.allocations.noProject", { defaultValue: "No project" }) }, ...choices.projectOptions]} disabled={field.disabled || choices.projectsState.status !== "ready"} />
          {row.projectId && !choices.projectOptions.some((option) => option.value === row.projectId) ? <p role="alert" className="text-xs text-destructive">{t("expenses.allocations.projectUnavailable", { defaultValue: "The selected project is unavailable. Clear it or choose a current company project." })}</p> : null}
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`allocation-account-${index}`}>{accountLabel}</Label>
          <RecordPicker id={`allocation-account-${index}`} value={row.analyticAccountId} onChange={(analyticAccountId) => update(index, { analyticAccountId })} options={[{ value: "", label: t("expenses.allocations.noAnalyticAccount", { defaultValue: "No analytic account" }) }, ...choices.analyticAccountOptions]} disabled={field.disabled || choices.analyticAccountsState.status !== "ready"} />
          {row.analyticAccountId && !choices.analyticAccountOptions.some((option) => option.value === row.analyticAccountId) ? <p role="alert" className="text-xs text-destructive">{t("expenses.allocations.accountUnavailable", { defaultValue: "The selected analytic account is unavailable. Clear it or choose an active company account." })}</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`allocation-share-${index}`}>{t("expenses.allocations.share", { defaultValue: "Share (%)" })}</Label>
          <Input id={`allocation-share-${index}`} type="number" min="0" max="100" step="any" value={row.sharePercent} onChange={(event) => update(index, { sharePercent: event.target.value })} aria-invalid={Boolean(error)} />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.billable === true} onChange={(event) => update(index, { billable: event.target.checked })} />{t("expenses.allocations.billable", { defaultValue: "Billable to customer" })}</label>
      </div>
    </fieldset>)}
    <p role="status" className={totalValid ? "text-sm" : "text-sm text-destructive"}>{t("expenses.allocations.total", { defaultValue: "Allocated: {{total}}%. Total must equal 100%.", total: totalKnown ? Number(total.toFixed(6)) : "—" })}</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={field.disabled} onClick={() => onChange([...rows, newExpenseAllocationDraft()])}>{t("expenses.allocations.addRow", { defaultValue: "Add allocation" })}</Button>
      <Button type="button" variant="outline" size="sm" disabled={field.disabled || rows.length <= 1} onClick={() => onChange(rows.slice(0, -1))}>{t("expenses.allocations.removeLast", { defaultValue: "Remove last allocation" })}</Button>
    </div>
  </div>
}
