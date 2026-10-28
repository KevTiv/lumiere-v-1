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
import {
  useCreateTaxJurisdiction,
  useUpdateTaxJurisdiction,
} from "@lumiere/query-hooks/hooks/accounting"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import {
  taxJurisdictionEditDefaults,
  toTaxJurisdictionCreateParams,
  toTaxJurisdictionUpdateParams,
} from "../tax-jurisdiction-actions"
import type { useFormDialog } from "@lumiere/ui"
import { taxJurisdictionsTableConfig } from "../read-sections"
import type { ResourceQueryRowMap } from "@lumiere/stdb/resource-reads"
interface TaxJurisdictionAdministrationOptions {
  organizationId: number
  taxJurisdictions: readonly ResourceQueryRowMap["tax-jurisdictions"][]
  askForm: ReturnType<typeof useFormDialog>["askForm"]
  runTaxCommand: (title: string, work: () => Promise<unknown>) => Promise<void>
}

// The parent owns prompt lifetime and read planning across tab changes.
export function useTaxJurisdictionAdministration({
  organizationId,
  taxJurisdictions,
  askForm,
  runTaxCommand,
}: TaxJurisdictionAdministrationOptions) {
  const { t } = useTranslation()
  const createTaxJurisdiction = useCreateTaxJurisdiction(organizationId)
  const updateTaxJurisdiction = useUpdateTaxJurisdiction(organizationId)
  const taxJurisdictionRows = useMemo(
    () =>
      taxJurisdictions.map((j) => {
        const current = taxJurisdictionEditDefaults(j)
        return {
          ...j,
          ...current,
          activeLabel: current.isActive
            ? t("accounting.taxJurisdictions.active", {
                defaultValue: "Active",
              })
            : t("accounting.taxJurisdictions.inactive", {
                defaultValue: "Inactive",
              }),
        }
      }),
    [taxJurisdictions, t],
  )
  const taxJurisdictionsEntityConfig = useMemo((): EntityViewConfig => {
    const base = taxJurisdictionsTableConfig(t)
    const view = base.view as EntityTableConfig
    const newLabel = t("accounting.taxJurisdictions.actions.new", {
      defaultValue: "New jurisdiction",
    })
    const editLabel = t("accounting.taxJurisdictions.actions.edit", {
      defaultValue: "Edit jurisdiction",
    })
    const fields = (
      current: ReturnType<typeof taxJurisdictionEditDefaults> | null,
    ): FormField[] => [
      {
        id: "name",
        name: "name",
        label: t("accounting.taxJurisdictions.columns.name", {
          defaultValue: "Name",
        }),
        type: "text",
        required: true,
        defaultValue: current?.name ?? "",
        width: "2/3",
      },
      {
        id: "code",
        name: "code",
        label: t("accounting.taxJurisdictions.columns.code", {
          defaultValue: "Code",
        }),
        type: "text",
        required: true,
        defaultValue: current?.code ?? "",
        width: "1/3",
      },
      // The reducer cannot change the country of an existing jurisdiction, so it is only asked for on create.
      ...(current == null
        ? [
            {
              id: "countryCode",
              name: "countryCode",
              label: t("accounting.taxJurisdictions.columns.countryCode", {
                defaultValue: "Country code",
              }),
              description: t("accounting.taxJurisdictions.form.countryHint", {
                defaultValue: "ISO country code, for example US.",
              }),
              type: "text" as const,
              required: true,
              defaultValue: "",
              width: "1/3" as const,
            },
          ]
        : []),
      {
        id: "stateCode",
        name: "stateCode",
        label: t("accounting.taxJurisdictions.columns.stateCode", {
          defaultValue: "State",
        }),
        type: "text",
        defaultValue: current?.stateCode ?? "",
        width: "1/3",
      },
      {
        id: "countyCode",
        name: "countyCode",
        label: t("accounting.taxJurisdictions.columns.countyCode", {
          defaultValue: "County",
        }),
        type: "text",
        defaultValue: current?.countyCode ?? "",
        width: "1/3",
      },
      {
        id: "city",
        name: "city",
        label: t("accounting.taxJurisdictions.columns.city", {
          defaultValue: "City",
        }),
        type: "text",
        defaultValue: current?.city ?? "",
        width: "1/3",
      },
      {
        id: "zipFrom",
        name: "zipFrom",
        label: t("accounting.taxJurisdictions.columns.zipFrom", {
          defaultValue: "Postal code from",
        }),
        type: "text",
        defaultValue: current?.zipFrom ?? "",
        width: "1/3",
      },
      {
        id: "zipTo",
        name: "zipTo",
        label: t("accounting.taxJurisdictions.columns.zipTo", {
          defaultValue: "Postal code to",
        }),
        type: "text",
        defaultValue: current?.zipTo ?? "",
        width: "1/3",
      },
      {
        id: "isActive",
        name: "isActive",
        label: t("accounting.taxJurisdictions.active", {
          defaultValue: "Active",
        }),
        type: "switch",
        defaultValue: current?.isActive ?? true,
        width: "1/3",
      },
    ]
    const invalid = (title: string) =>
      showWorkflowToast({
        kind: "error",
        title: t("accounting.taxDeadlines.actions.failed", {
          defaultValue: "{{action}} failed",
          action: title,
        }),
        description: t("accounting.taxJurisdictions.actions.invalid", {
          defaultValue: "Enter a name, a code and a country code.",
        }),
      })
    const promptNew = async () => {
      const values = await askForm({ title: newLabel, fields: fields(null) })
      if (values == null) return
      const params = toTaxJurisdictionCreateParams(values)
      if (params == null) return invalid(newLabel)
      await runTaxCommand(newLabel, () => createTaxJurisdiction.mutateAsync(params))
    }
    const promptEdit = async (row: EntityRow) => {
      const values = await askForm({
        title: editLabel,
        fields: fields(taxJurisdictionEditDefaults(row)),
      })
      if (values == null) return
      const result = toTaxJurisdictionUpdateParams(values, row)
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
        updateTaxJurisdiction.mutateAsync({
          jurisdictionId: BigInt(String(row.id)),
          params: result.params,
        }),
      )
    }
    const actions: EntityAction[] = [
      {
        id: "tax-jurisdiction-new",
        label: newLabel,
        permission: { resource: "tax_jurisdiction", action: "create" },
        onClick: () => promptNew(),
      },
      {
        id: "tax-jurisdiction-edit",
        label: editLabel,
        requiresSelection: true,
        permission: { resource: "tax_jurisdiction", action: "write" },
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
    runTaxCommand,
    createTaxJurisdiction.mutateAsync,
    updateTaxJurisdiction.mutateAsync,
  ])
  return { taxJurisdictionRows, taxJurisdictionsEntityConfig }
}
