"use client"

import { useMemo } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useBankStatementImports, useSetConsolidationCompanyRate } from "@lumiere/query-hooks/hooks/accounting"
import {
  useBankStatementImportLines,
  useConsolidationCompanyRates,
  useTaxDeadlineReminders,
} from "@lumiere/query-hooks/hooks/bff-company-rows"
import {
  importIdsApprovedIntoStatement,
  remindersForDeadline,
} from "@lumiere/query-hooks/hooks/read-ui-rows"
import { EntityView, useFormDialog, useRBAC } from "@lumiere/ui"
import type { EntityViewConfig } from "@lumiere/ui"
import { Button } from "@lumiere/ui/components/button"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import { CONSOLIDATION_RATE_TYPES, toConsolidationRateParams } from "./consolidation-rate-actions"

type QueryLike = { isLoading: boolean; isError: boolean; error: unknown }

function SectionState({
  query,
  empty,
  isEmpty,
  children,
}: {
  query: QueryLike
  empty: string
  isEmpty: boolean
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  if (query.isLoading) {
    return (
      <p className="p-3 text-sm text-muted-foreground" role="status">
        {t("common.loading", { defaultValue: "Loading..." })}
      </p>
    )
  }
  if (query.isError) {
    return (
      <p className="p-3 text-sm text-destructive" role="alert">
        {query.error instanceof Error && query.error.message
          ? query.error.message
          : t("common.error.generic", { defaultValue: "Something went wrong." })}
      </p>
    )
  }
  if (isEmpty) {
    return (
      <p className="p-3 text-sm text-muted-foreground" role="status">
        {empty}
      </p>
    )
  }
  return <>{children}</>
}

/** Import lines (CSV rows) of the imports approved into this bank statement. */
export function BankStatementImportLinesSection({
  organizationId,
  companyId,
  statementId,
}: {
  organizationId: bigint
  companyId: bigint
  statementId: string
}) {
  const { t } = useTranslation()
  const imports = useBankStatementImports(organizationId, companyId)
  const linesQuery = useBankStatementImportLines(organizationId)
  const rows = useMemo(() => {
    const ids = importIdsApprovedIntoStatement(imports.data?.imports ?? [], statementId)
    return (linesQuery.data ?? []).filter((l) => l.importId != null && ids.has(l.importId))
  }, [imports.data, linesQuery.data, statementId])

  const config: EntityViewConfig = useMemo(
    () => ({
      id: "bank-statement-import-lines-inline",
      title: "",
      view: {
        mode: "table",
        rowKey: "id",
        columns: [
          { key: "rowNumber", label: t("accounting.bankStatementImportLines.row", { defaultValue: "Row" }), align: "right" },
          { key: "date", label: t("accounting.journalEntries.date"), type: "date" },
          { key: "reference", label: t("accounting.bankStatementImportLines.reference", { defaultValue: "Reference" }) },
          { key: "description", label: t("accounting.bankStatementImportLines.description", { defaultValue: "Description" }) },
          { key: "amount", label: t("accounting.bankStatementDetail.candidateAmount"), type: "currency", align: "right" },
          { key: "validationError", label: t("accounting.bankStatementImportLines.validationError", { defaultValue: "Validation" }) },
        ],
        emptyMessage: t("accounting.bankStatementImportLines.empty", {
          defaultValue: "No imported lines for this statement.",
        }),
      },
    }),
    [t],
  )

  return (
    <SectionState
      query={linesQuery.isError ? linesQuery : imports.isError ? imports : { isLoading: linesQuery.isLoading || imports.isLoading, isError: false, error: null }}
      isEmpty={rows.length === 0}
      empty={t("accounting.bankStatementImportLines.empty", {
        defaultValue: "No imported lines for this statement.",
      })}
    >
      <EntityView config={config} data={rows as unknown as Record<string, unknown>[]} useCard={false} />
    </SectionState>
  )
}

/** Reminders scheduled for one tax deadline. */
export function TaxDeadlineRemindersSection({
  organizationId,
  deadlineId,
}: {
  organizationId: bigint
  deadlineId: string
}) {
  const { t } = useTranslation()
  const query = useTaxDeadlineReminders(organizationId)
  const rows = useMemo(() => remindersForDeadline(query.data ?? [], deadlineId), [query.data, deadlineId])
  const config: EntityViewConfig = useMemo(
    () => ({
      id: "tax-deadline-reminders-inline",
      title: "",
      view: {
        mode: "table",
        rowKey: "id",
        columns: [
          { key: "reminderDate", label: t("accounting.taxDeadlines.reminders.date", { defaultValue: "Reminder date" }), type: "date" },
          { key: "daysBeforeDeadline", label: t("accounting.taxDeadlines.reminders.daysBefore", { defaultValue: "Days before" }), align: "right" },
          { key: "notificationType", label: t("accounting.taxDeadlines.reminders.channel", { defaultValue: "Channel" }) },
          { key: "status", label: t("accounting.taxDeadlines.reminders.status", { defaultValue: "Status" }) },
          { key: "sentAt", label: t("accounting.taxDeadlines.reminders.sentAt", { defaultValue: "Sent" }), type: "date" },
          { key: "acknowledgedAt", label: t("accounting.taxDeadlines.reminders.acknowledgedAt", { defaultValue: "Acknowledged" }), type: "date" },
        ],
        emptyMessage: "",
      },
    }),
    [t],
  )
  return (
    <SectionState
      query={query}
      isEmpty={rows.length === 0}
      empty={t("accounting.taxDeadlines.reminders.empty", { defaultValue: "No reminders for this deadline." })}
    >
      <EntityView config={config} data={rows as unknown as Record<string, unknown>[]} useCard={false} />
    </SectionState>
  )
}

/** Tax deadlines list config (reminders open from the record sheet). */
export function taxDeadlinesTableConfig(t: (key: string, opts?: Record<string, unknown>) => string): EntityViewConfig {
  return {
    id: "tax-deadlines-table",
    title: t("accounting.taxDeadlines.title", { defaultValue: "Tax deadlines" }),
    view: {
      mode: "table",
      rowKey: "id",
      searchable: true,
      searchKeys: ["title", "statusLabel"],
      columns: [
        { key: "title", label: t("accounting.taxDeadlines.columns.title", { defaultValue: "Deadline" }), width: "min-w-48" },
        { key: "dueDate", label: t("accounting.taxDeadlines.columns.dueDate", { defaultValue: "Due date" }), type: "date" },
        { key: "statusLabel", label: t("accounting.taxDeadlines.columns.status", { defaultValue: "Status" }) },
      ],
      emptyMessage: t("accounting.taxDeadlines.empty", { defaultValue: "No tax deadlines." }),
    },
  } as EntityViewConfig
}

export interface CompanyRateLabels {
  readonly company: ReadonlyMap<string, string>
  readonly currency: ReadonlyMap<string, string>
  readonly period: ReadonlyMap<string, string>
}

/** Per-company, per-period exchange rates used by consolidation. */
export function ConsolidationCompanyRatesSection({
  organizationId,
  labels,
}: {
  organizationId: bigint
  labels: CompanyRateLabels
}) {
  const { t } = useTranslation()
  const query = useConsolidationCompanyRates(organizationId)
  const setRate = useSetConsolidationCompanyRate(Number(organizationId))
  const { checkPermission } = useRBAC()
  const { askForm, formDialog } = useFormDialog()
  const canSetRate = checkPermission("consolidation_company_rate", "create").allowed
  const toOptions = (labelMap: ReadonlyMap<string, string>) =>
    Array.from(labelMap, ([value, label]) => ({ value, label }))

  /** Add a rate, or update the one already recorded for the same company and period (the reducer upserts). */
  const promptSetRate = async () => {
    const label = t("accounting.consolidation.rates.set", { defaultValue: "Add / update rate" })
    const values = await askForm({
      title: label,
      description: t("accounting.consolidation.rates.setHint", {
        defaultValue: "A company and period that already has a rate gets its rate, type and effective date updated.",
      }),
      fields: [
        { id: "companyId", name: "companyId", label: t("accounting.consolidation.rates.company", { defaultValue: "Company" }), type: "select", required: true, options: toOptions(labels.company), width: "1/2" },
        { id: "periodId", name: "periodId", label: t("accounting.consolidation.rates.period", { defaultValue: "Period" }), type: "select", required: true, options: toOptions(labels.period), width: "1/2" },
        { id: "currencyId", name: "currencyId", label: t("accounting.consolidation.rates.currency", { defaultValue: "Currency" }), type: "select", required: true, options: toOptions(labels.currency), width: "1/2" },
        { id: "exchangeRate", name: "exchangeRate", label: t("accounting.consolidation.rates.rate", { defaultValue: "Rate" }), type: "number", required: true, step: 0.000001, min: 0, width: "1/2" },
        {
          id: "rateType",
          name: "rateType",
          label: t("accounting.consolidation.rates.type", { defaultValue: "Type" }),
          type: "select",
          required: true,
          defaultValue: "average",
          width: "1/2",
          options: CONSOLIDATION_RATE_TYPES.map((value) => ({
            value,
            label: t(`accounting.consolidation.rates.types.${value}`, { defaultValue: value.charAt(0).toUpperCase() + value.slice(1) }),
          })),
        },
        { id: "effectiveDate", name: "effectiveDate", label: t("accounting.consolidation.rates.effectiveDate", { defaultValue: "Effective" }), type: "date", required: true, width: "1/2" },
      ],
    })
    if (values == null) return
    const failed = (description: string) =>
      showWorkflowToast({
        kind: "error",
        title: t("accounting.taxDeadlines.actions.failed", { defaultValue: "{{action}} failed", action: label }),
        description,
      })
    const params = toConsolidationRateParams(values)
    if (params == null) {
      failed(
        t("accounting.consolidation.rates.invalid", {
          defaultValue: "Choose a company, period and currency, and enter a rate above zero and an effective date.",
        }),
      )
      return
    }
    try {
      await setRate.mutateAsync(params)
      showWorkflowToast({
        kind: "success",
        title: t("accounting.taxDeadlines.actions.done", { defaultValue: "{{action}} completed", action: label }),
      })
      void query.refetch()
    } catch (error) {
      failed(error instanceof Error ? error.message : String(error))
    }
  }

  const rows = useMemo(
    () =>
      (query.data ?? []).map((r) => ({
        id: r.id,
        company: r.companyId != null ? (labels.company.get(r.companyId) ?? "") : "",
        period: r.periodId != null ? (labels.period.get(r.periodId) ?? "") : "",
        currency: r.currencyId != null ? (labels.currency.get(r.currencyId) ?? "") : "",
        exchangeRate: r.exchangeRate,
        rateType: r.rateType ?? "",
        effectiveDate: r.effectiveDate,
      })),
    [query.data, labels],
  )
  const config: EntityViewConfig = useMemo(
    () => ({
      id: "consolidation-company-rates-table",
      title: "",
      view: {
        mode: "table",
        rowKey: "id",
        columns: [
          { key: "company", label: t("accounting.consolidation.rates.company", { defaultValue: "Company" }) },
          { key: "period", label: t("accounting.consolidation.rates.period", { defaultValue: "Period" }) },
          { key: "currency", label: t("accounting.consolidation.rates.currency", { defaultValue: "Currency" }) },
          { key: "exchangeRate", label: t("accounting.consolidation.rates.rate", { defaultValue: "Rate" }), align: "right" },
          { key: "rateType", label: t("accounting.consolidation.rates.type", { defaultValue: "Type" }) },
          { key: "effectiveDate", label: t("accounting.consolidation.rates.effectiveDate", { defaultValue: "Effective" }), type: "date" },
        ],
        emptyMessage: "",
      },
    }),
    [t],
  )
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">
          {t("accounting.consolidation.rates.title", { defaultValue: "Company exchange rates" })}
        </h3>
        {canSetRate ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={setRate.isPending}
            data-testid="consolidation-rate-set"
            onClick={() => void promptSetRate()}
          >
            {t("accounting.consolidation.rates.set", { defaultValue: "Add / update rate" })}
          </Button>
        ) : null}
      </div>
      {formDialog}
      <SectionState
        query={query}
        isEmpty={rows.length === 0}
        empty={t("accounting.consolidation.rates.empty", { defaultValue: "No consolidation rates recorded." })}
      >
        <EntityView config={config} data={rows as unknown as Record<string, unknown>[]} useCard={false} />
      </SectionState>
    </div>
  )
}
