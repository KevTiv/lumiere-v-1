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
  useCreateAccountTaxGroup,
  useUpdateAccountTaxGroup,
} from "@lumiere/query-hooks/hooks/accounting"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import {
  canEditTaxGroup,
  taxGroupAccountOptions,
  taxGroupEditDefaults,
  toTaxGroupCreateParams,
  toTaxGroupUpdateParams,
} from "../tax-group-actions"
import { cellId, cellText, withNone } from "../tax-setup-wire"
import type { useFormDialog } from "@lumiere/ui"
import { taxGroupsTableConfig } from "../read-sections"
import type { ResourceQueryRowMap } from "@lumiere/stdb/resource-reads"
interface TaxGroupAdministrationOptions {
  organizationId: number
  operatingCompanyId: bigint
  accounts: readonly ResourceQueryRowMap["account-accounts"][]
  taxGroups: readonly ResourceQueryRowMap["tax-groups"][]
  companySelectOptions: {
    value: string
    label: string
  }[]
  askForm: ReturnType<typeof useFormDialog>["askForm"]
  runTaxCommand: (title: string, work: () => Promise<unknown>) => Promise<void>
}

// The parent owns prompt lifetime and read planning across tab changes.
export function useTaxGroupAdministration({
  organizationId,
  operatingCompanyId,
  accounts,
  taxGroups,
  companySelectOptions,
  askForm,
  runTaxCommand,
}: TaxGroupAdministrationOptions) {
  const { t } = useTranslation()
  const createTaxGroup = useCreateAccountTaxGroup(organizationId, operatingCompanyId)
  const updateTaxGroup = useUpdateAccountTaxGroup(organizationId, operatingCompanyId)
  const taxGroupRows = useMemo(() => {
    const accountLabel = new Map<string, string>()
    for (const a of accounts) {
      const id = cellId(a.id)
      if (id != null)
        accountLabel.set(id.toString(), `${cellText(a.code)} ${cellText(a.name)}`.trim())
    }
    const companyLabel = new Map(
      companySelectOptions.map((o) => [String(o.value), o.label] as const),
    )
    const labelOf = (map: Map<string, string>, v: unknown) => {
      const id = cellId(v)
      return id == null ? "" : (map.get(id.toString()) ?? id.toString())
    }
    return taxGroups.map((g) => ({
      ...g,
      sequence: Number(cellText(g.sequence)) || 0,
      companyName: labelOf(companyLabel, g.companyId),
      precedingSubtotalText: cellText(g.precedingSubtotal),
      payableAccountName: labelOf(accountLabel, g.taxPayableAccountId),
      receivableAccountName: labelOf(accountLabel, g.taxReceivableAccountId),
      advanceAccountName: labelOf(accountLabel, g.advanceTaxPaymentAccountId),
    }))
  }, [taxGroups, accounts, companySelectOptions])
  const taxGroupsEntityConfig = useMemo((): EntityViewConfig => {
    const base = taxGroupsTableConfig(t)
    const view = base.view as EntityTableConfig
    const newLabel = t("accounting.taxGroups.actions.new", {
      defaultValue: "New tax group",
    })
    const editLabel = t("accounting.taxGroups.actions.edit", {
      defaultValue: "Edit tax group",
    })
    const noneLabel = t("accounting.taxGroups.form.none", {
      defaultValue: "None",
    })
    const accountRows = accounts
    const fields = (current: ReturnType<typeof taxGroupEditDefaults> | null): FormField[] => [
      {
        id: "name",
        name: "name",
        label: t("accounting.taxGroups.columns.name", { defaultValue: "Name" }),
        type: "text",
        required: true,
        defaultValue: current?.name ?? "",
        width: "2/3",
      },
      {
        id: "sequence",
        name: "sequence",
        label: t("accounting.taxGroups.columns.sequence", {
          defaultValue: "Sequence",
        }),
        type: "number",
        required: true,
        min: 0,
        step: 1,
        defaultValue: current?.sequence ?? 10,
        width: "1/3",
      },
      {
        id: "precedingSubtotal",
        name: "precedingSubtotal",
        label: t("accounting.taxGroups.columns.precedingSubtotal", {
          defaultValue: "Preceding subtotal",
        }),
        type: "text",
        defaultValue: current?.precedingSubtotal ?? "",
      },
      {
        id: "taxPayableAccountId",
        name: "taxPayableAccountId",
        label: t("accounting.taxGroups.columns.payableAccount", {
          defaultValue: "Tax payable account",
        }),
        type: "select",
        defaultValue: current?.taxPayableAccountId ?? "",
        options: withNone(
          taxGroupAccountOptions(accountRows, "payable", operatingCompanyId),
          noneLabel,
        ),
      },
      {
        id: "taxReceivableAccountId",
        name: "taxReceivableAccountId",
        label: t("accounting.taxGroups.columns.receivableAccount", {
          defaultValue: "Tax receivable account",
        }),
        type: "select",
        defaultValue: current?.taxReceivableAccountId ?? "",
        options: withNone(
          taxGroupAccountOptions(accountRows, "receivable", operatingCompanyId),
          noneLabel,
        ),
      },
      {
        id: "advanceTaxPaymentAccountId",
        name: "advanceTaxPaymentAccountId",
        label: t("accounting.taxGroups.columns.advanceAccount", {
          defaultValue: "Advance tax payment account",
        }),
        type: "select",
        defaultValue: current?.advanceTaxPaymentAccountId ?? "",
        options: withNone(
          taxGroupAccountOptions(accountRows, "advance", operatingCompanyId),
          noneLabel,
        ),
      },
    ]
    const invalid = (title: string) =>
      showWorkflowToast({
        kind: "error",
        title: t("accounting.taxDeadlines.actions.failed", {
          defaultValue: "{{action}} failed",
          action: title,
        }),
        description: t("accounting.taxGroups.actions.invalid", {
          defaultValue: "Enter a name and a whole-number sequence.",
        }),
      })
    const promptNew = async () => {
      const values = await askForm({ title: newLabel, fields: fields(null) })
      if (values == null) return
      const params = toTaxGroupCreateParams(values)
      if (params == null) return invalid(newLabel)
      await runTaxCommand(newLabel, () => createTaxGroup.mutateAsync(params))
    }
    const promptEdit = async (row: EntityRow) => {
      const values = await askForm({
        title: editLabel,
        fields: fields(taxGroupEditDefaults(row)),
      })
      if (values == null) return
      const result = toTaxGroupUpdateParams(values, row)
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
        updateTaxGroup.mutateAsync({
          groupId: BigInt(String(row.id)),
          params: result.params,
        }),
      )
    }
    const actions: EntityAction[] = [
      {
        id: "tax-group-new",
        label: newLabel,
        permission: { resource: "account_tax_group", action: "create" },
        onClick: () => promptNew(),
      },
      {
        id: "tax-group-edit",
        label: editLabel,
        requiresSelection: true,
        permission: { resource: "account_tax_group", action: "write" },
        isApplicable: (rows) => rows.every((r) => canEditTaxGroup(r, operatingCompanyId)),
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
    accounts,
    operatingCompanyId,
    runTaxCommand,
    createTaxGroup.mutateAsync,
    updateTaxGroup.mutateAsync,
  ])
  return { taxGroupRows, taxGroupsEntityConfig }
}
