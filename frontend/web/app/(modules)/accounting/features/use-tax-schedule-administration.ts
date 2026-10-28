"use client"
import { useMemo } from "react"
import { useTranslation } from "@lumiere/i18n"
import type {
  EntityAction,
  FormField,
  EntityRow,
  EntityTableConfig,
  EntityViewConfig,
} from "@lumiere/ui"
import { useCreateTaxSchedule, useUpdateTaxSchedule } from "@lumiere/query-hooks/hooks/accounting"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import {
  canEditTaxSchedule,
  scheduleJurisdictionOptions,
  scheduleTaxOptions,
  taxScheduleEditDefaults,
  toTaxScheduleCreateParams,
  toTaxScheduleUpdateParams,
} from "../tax-schedule-actions"
import { taxPickerField } from "../tax-picker-field"
import { cellId, cellText, withNone } from "../tax-setup-wire"
import type { useFormDialog } from "@lumiere/ui"
import { taxSchedulesTableConfig } from "../read-sections"
import type { ResourceQueryRowMap } from "@lumiere/stdb/resource-reads"
interface TaxScheduleAdministrationOptions {
  organizationId: number
  operatingCompanyId: bigint
  taxes: readonly ResourceQueryRowMap["account-taxes"][]
  taxJurisdictions: readonly ResourceQueryRowMap["tax-jurisdictions"][]
  taxSchedules: readonly ResourceQueryRowMap["tax-schedules"][]
  companySelectOptions: {
    value: string
    label: string
  }[]
  askForm: ReturnType<typeof useFormDialog>["askForm"]
  runTaxCommand: (title: string, work: () => Promise<unknown>) => Promise<void>
}

// The parent owns prompt lifetime and read planning across tab changes.
export function useTaxScheduleAdministration({
  organizationId,
  operatingCompanyId,
  taxes,
  taxJurisdictions,
  taxSchedules,
  companySelectOptions,
  askForm,
  runTaxCommand,
}: TaxScheduleAdministrationOptions) {
  const { t } = useTranslation()
  const createTaxSchedule = useCreateTaxSchedule(organizationId, operatingCompanyId)
  const updateTaxSchedule = useUpdateTaxSchedule(organizationId, operatingCompanyId)
  const taxScheduleRows = useMemo(() => {
    const companyLabel = new Map(
      companySelectOptions.map((o) => [String(o.value), o.label] as const),
    )
    const jurisdictionLabel = new Map(
      taxJurisdictions.map((j) => [cellId(j.id)?.toString() ?? "", cellText(j.name)] as const),
    )
    const taxLabel = new Map(
      taxes.map((x) => [cellId(x.id)?.toString() ?? "", cellText(x.name)] as const),
    )
    return taxSchedules.map((s) => {
      const current = taxScheduleEditDefaults(s)
      const companyKey = cellId(s.companyId)?.toString() ?? ""
      return {
        ...s,
        description: current.description,
        companyName: companyLabel.get(companyKey) ?? companyKey,
        jurisdictionName: jurisdictionLabel.get(current.jurisdictionId) ?? "",
        taxNames: current.taxIds.map((id) => taxLabel.get(id) ?? id).join(", "),
        effectiveFromDate: current.effectiveFrom,
        effectiveToDate: current.effectiveTo,
        activeLabel: current.isActive
          ? t("accounting.taxSchedules.active", { defaultValue: "Active" })
          : t("accounting.taxSchedules.inactive", { defaultValue: "Inactive" }),
      }
    })
  }, [taxSchedules, taxJurisdictions, taxes, companySelectOptions, t])
  const taxSchedulesEntityConfig = useMemo((): EntityViewConfig => {
    const base = taxSchedulesTableConfig(t)
    const view = base.view as EntityTableConfig
    const newLabel = t("accounting.taxSchedules.actions.new", {
      defaultValue: "New schedule",
    })
    const editLabel = t("accounting.taxSchedules.actions.edit", {
      defaultValue: "Edit schedule",
    })
    const noneLabel = t("accounting.taxSchedules.form.none", {
      defaultValue: "None",
    })
    const inactiveSuffix = t("accounting.taxSchedules.form.inactive", {
      defaultValue: "(inactive)",
    })
    const taxRows = taxes
    const jurisdictionRows = taxJurisdictions
    const fields = (current: ReturnType<typeof taxScheduleEditDefaults> | null): FormField[] => [
      {
        id: "name",
        name: "name",
        label: t("accounting.taxSchedules.columns.name", {
          defaultValue: "Name",
        }),
        type: "text",
        required: true,
        defaultValue: current?.name ?? "",
      },
      {
        id: "description",
        name: "description",
        label: t("accounting.taxSchedules.columns.description", {
          defaultValue: "Description",
        }),
        type: "textarea",
        defaultValue: current?.description ?? "",
      },
      {
        id: "jurisdictionId",
        name: "jurisdictionId",
        label: t("accounting.taxSchedules.columns.jurisdiction", {
          defaultValue: "Jurisdiction",
        }),
        type: "select",
        defaultValue: current?.jurisdictionId ?? "",
        options: withNone(
          scheduleJurisdictionOptions(
            jurisdictionRows,
            current?.jurisdictionId ?? "",
            inactiveSuffix,
          ),
          noneLabel,
        ),
      },
      taxPickerField({
        id: "taxIds",
        name: "taxIds",
        label: t("accounting.taxSchedules.columns.taxes", {
          defaultValue: "Taxes",
        }),
        options: scheduleTaxOptions(
          taxRows,
          operatingCompanyId,
          current?.taxIds ?? [],
          inactiveSuffix,
        ),
        defaultValue: current?.taxIds ?? [],
        emptyHint: t("accounting.taxSchedules.form.noActiveTaxes", {
          defaultValue: "There are no active taxes to choose from.",
        }),
      }),
      {
        id: "effectiveFrom",
        name: "effectiveFrom",
        label: t("accounting.taxSchedules.columns.effectiveFrom", {
          defaultValue: "Effective from",
        }),
        type: "date",
        defaultValue: current?.effectiveFrom ?? "",
        width: "1/2",
      },
      {
        id: "effectiveTo",
        name: "effectiveTo",
        label: t("accounting.taxSchedules.columns.effectiveTo", {
          defaultValue: "Effective to",
        }),
        type: "date",
        defaultValue: current?.effectiveTo ?? "",
        width: "1/2",
      },
      {
        id: "isActive",
        name: "isActive",
        label: t("accounting.taxSchedules.active", { defaultValue: "Active" }),
        type: "switch",
        defaultValue: current?.isActive ?? true,
      },
    ]
    const invalid = (title: string) =>
      showWorkflowToast({
        kind: "error",
        title: t("accounting.taxDeadlines.actions.failed", {
          defaultValue: "{{action}} failed",
          action: title,
        }),
        description: t("accounting.taxSchedules.actions.invalid", {
          defaultValue: "Enter a name and valid effective dates.",
        }),
      })
    const promptNew = async () => {
      const values = await askForm({ title: newLabel, fields: fields(null) })
      if (values == null) return
      const params = toTaxScheduleCreateParams(values)
      if (params == null) return invalid(newLabel)
      await runTaxCommand(newLabel, () => createTaxSchedule.mutateAsync(params))
    }
    const promptEdit = async (row: EntityRow) => {
      const values = await askForm({
        title: editLabel,
        fields: fields(taxScheduleEditDefaults(row)),
      })
      if (values == null) return
      const result = toTaxScheduleUpdateParams(values, row)
      if (!result.ok) {
        if (result.reason === "invalid") return invalid(editLabel)
        showWorkflowToast({
          kind: "info",
          title: t("accounting.accounts.edit.unchanged", {
            defaultValue: "Nothing to change.",
          }),
        })
        return
      }
      await runTaxCommand(editLabel, () =>
        updateTaxSchedule.mutateAsync({
          scheduleId: BigInt(String(row.id)),
          params: result.params,
        }),
      )
    }
    const actions: EntityAction[] = [
      {
        id: "tax-schedule-new",
        label: newLabel,
        permission: { resource: "tax_schedule", action: "create" },
        onClick: () => promptNew(),
      },
      {
        id: "tax-schedule-edit",
        label: editLabel,
        requiresSelection: true,
        permission: { resource: "tax_schedule", action: "write" },
        isApplicable: (rows) => rows.every((r) => canEditTaxSchedule(r, operatingCompanyId)),
        onClick: (rows) => promptEdit(rows[0]!),
      },
    ]
    return {
      ...base,
      view: { ...view, actions: [...(view.actions ?? []), ...actions] },
    } as EntityViewConfig
  }, [
    t,
    askForm,
    taxes,
    taxJurisdictions,
    operatingCompanyId,
    runTaxCommand,
    createTaxSchedule.mutateAsync,
    updateTaxSchedule.mutateAsync,
  ])
  return { taxScheduleRows, taxSchedulesEntityConfig }
}
