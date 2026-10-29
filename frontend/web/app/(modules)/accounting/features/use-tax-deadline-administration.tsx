"use client"
import { useMemo } from "react"
import { useTranslation } from "@lumiere/i18n"
import type {
  EntityAction,
  EntityRecordSheetConfig,
  EntityRow,
  EntityTableConfig,
  EntityViewConfig,
} from "@lumiere/ui"
import {
  useCompleteTaxDeadline,
  useWaiveTaxDeadline,
  useDeleteTaxDeadline,
  useCreateTaxDeadline,
  useUpdateTaxDeadline,
} from "@lumiere/query-hooks/hooks/accounting"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import {
  canCompleteTaxDeadline,
  canDeleteTaxDeadline,
  canEditTaxDeadline,
  canWaiveTaxDeadline,
  deadlineDateInput,
  toTaxDeadlineCreateBody,
  toTaxDeadlineUpdateBody,
} from "../tax-deadline-actions"
import type { useFormDialog } from "@lumiere/ui"
import { TaxDeadlineRemindersSection, taxDeadlinesTableConfig } from "../read-sections"
import type { ResourceQueryRowMap } from "@lumiere/stdb/resource-reads"
function taxDeadlineStatusStr(row: EntityRow): string {
  const v = row.status
  if (v != null && typeof v === "object" && "tag" in v)
    return String(
      (
        v as {
          tag: string
        }
      ).tag,
    )
  return String(v ?? "")
}

interface TaxDeadlineAdministrationOptions {
  organizationId: number
  taxDeadlines: readonly ResourceQueryRowMap["tax-deadlines"][]
  companySelectOptions: {
    value: string
    label: string
  }[]
  askForm: ReturnType<typeof useFormDialog>["askForm"]
  runTaxCommand: (title: string, work: () => Promise<unknown>) => Promise<void>
}

// The parent owns prompt lifetime and read planning across tab changes.
export function useTaxDeadlineAdministration({
  organizationId,
  taxDeadlines,
  companySelectOptions,
  askForm,
  runTaxCommand,
}: TaxDeadlineAdministrationOptions) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId)
  const completeTaxDeadline = useCompleteTaxDeadline(organizationId)
  const waiveTaxDeadline = useWaiveTaxDeadline(organizationId)
  const deleteTaxDeadline = useDeleteTaxDeadline(organizationId)
  const createTaxDeadline = useCreateTaxDeadline(organizationId)
  const updateTaxDeadline = useUpdateTaxDeadline(organizationId)
  const taxDeadlineRows = useMemo(
    () =>
      (taxDeadlines as readonly EntityRow[])
        .filter((d) => d.deletedAt == null && d.deleted_at == null)
        .map((d) => ({
          ...d,
          dueDate: d.dueDate ?? d.due_date,
          statusLabel: taxDeadlineStatusStr(d),
        })),
    [taxDeadlines],
  )
  const taxDeadlineRecordSheet = useMemo(
    (): EntityRecordSheetConfig => ({
      titleKey: "title",
      statusKey: "statusLabel",
      detailConfig: {
        mode: "detail",
        sections: [
          {
            id: "header",
            fields: [
              {
                key: "title",
                label: t("accounting.taxDeadlines.columns.title", {
                  defaultValue: "Deadline",
                }),
              },
              {
                key: "dueDate",
                label: t("accounting.taxDeadlines.columns.dueDate", {
                  defaultValue: "Due date",
                }),
                type: "date",
              },
              {
                key: "statusLabel",
                label: t("accounting.taxDeadlines.columns.status", {
                  defaultValue: "Status",
                }),
              },
              {
                key: "description",
                label: t("accounting.taxDeadlines.columns.description", {
                  defaultValue: "Description",
                }),
              },
            ],
          },
        ],
      },
      customTabs: [
        {
          id: "reminders",
          label: t("accounting.taxDeadlines.reminders.tab", {
            defaultValue: "Reminders",
          }),
          content: (record) => (
            <TaxDeadlineRemindersSection
              organizationId={orgId}
              deadlineId={String(record.id ?? "")}
            />
          ),
        },
      ],
    }),
    [t, orgId],
  )
  const taxDeadlinesEntityConfig = useMemo((): EntityViewConfig => {
    const base = taxDeadlinesTableConfig(t)
    const view = base.view as EntityTableConfig
    const newLabel = t("accounting.taxDeadlines.actions.new", {
      defaultValue: "New deadline",
    })
    const editLabel = t("accounting.taxDeadlines.actions.edit", {
      defaultValue: "Edit deadline",
    })
    const completeLabel = t("accounting.taxDeadlines.actions.complete", {
      defaultValue: "Mark complete",
    })
    const waiveLabel = t("accounting.taxDeadlines.actions.waive", {
      defaultValue: "Waive",
    })
    const deleteLabel = t("accounting.taxDeadlines.actions.delete", {
      defaultValue: "Delete deadline",
    })
    const invalidInput = (title: string) =>
      showWorkflowToast({
        kind: "error",
        title: t("accounting.taxDeadlines.actions.failed", {
          defaultValue: "{{action}} failed",
          action: title,
        }),
        description: t("accounting.taxDeadlines.actions.invalid", {
          defaultValue: "Enter a title and a due date.",
        }),
      })
    const idOf = (row: EntityRow) => BigInt(String(row.id))
    const cancelLabel = t("common.cancel", { defaultValue: "Cancel" })
    const promptNew = async () => {
      const values = await askForm({
        title: newLabel,
        fields: [
          {
            id: "title",
            name: "title",
            label: t("accounting.taxDeadlines.columns.title", {
              defaultValue: "Deadline",
            }),
            type: "text",
            required: true,
          },
          {
            id: "deadlineType",
            name: "deadlineType",
            label: t("accounting.taxDeadlines.form.type", {
              defaultValue: "Type",
            }),
            type: "select",
            required: true,
            defaultValue: "Filing",
            width: "1/2",
            options: ["Filing", "Payment", "Registration", "Report", "Renewal"].map((value) => ({
              value,
              label: t(`accounting.taxDeadlines.form.types.${value}`, {
                defaultValue: value,
              }),
            })),
          },
          {
            id: "dueDate",
            name: "dueDate",
            label: t("accounting.taxDeadlines.columns.dueDate", {
              defaultValue: "Due date",
            }),
            type: "date",
            required: true,
            width: "1/2",
          },
          {
            id: "companyId",
            name: "companyId",
            label: t("accounting.taxDeadlines.form.company", {
              defaultValue: "Company (optional)",
            }),
            type: "select",
            options: companySelectOptions,
          },
          {
            id: "description",
            name: "description",
            label: t("accounting.taxDeadlines.columns.description", {
              defaultValue: "Description",
            }),
            type: "textarea",
          },
        ],
      })
      if (values == null) return
      const body = toTaxDeadlineCreateBody(values)
      if (body == null) return invalidInput(newLabel)
      await runTaxCommand(newLabel, () => createTaxDeadline.mutateAsync(body))
    }
    const promptEdit = async (row: EntityRow) => {
      const values = await askForm({
        title: editLabel,
        fields: [
          {
            id: "title",
            name: "title",
            label: t("accounting.taxDeadlines.columns.title", {
              defaultValue: "Deadline",
            }),
            type: "text",
            required: true,
            defaultValue: String(row.title ?? ""),
          },
          {
            id: "dueDate",
            name: "dueDate",
            label: t("accounting.taxDeadlines.columns.dueDate", {
              defaultValue: "Due date",
            }),
            type: "date",
            defaultValue: deadlineDateInput(row.dueDate),
          },
          {
            id: "description",
            name: "description",
            label: t("accounting.taxDeadlines.columns.description", {
              defaultValue: "Description",
            }),
            type: "textarea",
            defaultValue: String(row.description ?? ""),
          },
        ],
      })
      if (values == null) return
      const body = toTaxDeadlineUpdateBody(values)
      if (body == null) return invalidInput(editLabel)
      await runTaxCommand(editLabel, () =>
        updateTaxDeadline.mutateAsync({ deadlineId: idOf(row), params: body }),
      )
    }
    const actions: EntityAction[] = [
      {
        id: "tax-deadline-new",
        label: newLabel,
        permission: { resource: "tax_deadline", action: "create" },
        onClick: () => promptNew(),
      },
      {
        id: "tax-deadline-complete",
        label: completeLabel,
        requiresSelection: true,
        permission: { resource: "tax_deadline", action: "write" },
        isApplicable: (rows) => rows.every((r) => canCompleteTaxDeadline(r)),
        successMessage: t("accounting.taxDeadlines.actions.done", {
          defaultValue: "{{action}} completed",
          action: completeLabel,
        }),
        onClick: (rows) => completeTaxDeadline.mutateAsync(idOf(rows[0]!)),
      },
      {
        id: "tax-deadline-edit",
        label: editLabel,
        requiresSelection: true,
        permission: { resource: "tax_deadline", action: "write" },
        isApplicable: (rows) => rows.every((r) => canEditTaxDeadline(r)),
        onClick: (rows) => promptEdit(rows[0]!),
      },
      {
        id: "tax-deadline-waive",
        label: waiveLabel,
        requiresSelection: true,
        permission: { resource: "tax_deadline", action: "admin" },
        isApplicable: (rows) => rows.every((r) => canWaiveTaxDeadline(r)),
        confirm: {
          title: waiveLabel,
          description: t("accounting.taxDeadlines.actions.waiveConfirm", {
            defaultValue: "Mark this deadline as not applicable. It stops counting as open.",
          }),
          confirmLabel: waiveLabel,
          cancelLabel,
        },
        successMessage: t("accounting.taxDeadlines.actions.done", {
          defaultValue: "{{action}} completed",
          action: waiveLabel,
        }),
        onClick: (rows) => waiveTaxDeadline.mutateAsync(idOf(rows[0]!)),
      },
      {
        id: "tax-deadline-delete",
        label: deleteLabel,
        variant: "destructive",
        requiresSelection: true,
        permission: { resource: "tax_deadline", action: "delete" },
        isApplicable: (rows) => rows.every((r) => canDeleteTaxDeadline(r)),
        confirm: {
          title: deleteLabel,
          description: t("accounting.taxDeadlines.actions.deleteConfirm", {
            defaultValue: "Delete this tax deadline? It disappears from the list.",
          }),
          confirmLabel: t("common.delete", { defaultValue: "Delete" }),
          cancelLabel,
        },
        successMessage: t("accounting.taxDeadlines.actions.done", {
          defaultValue: "{{action}} completed",
          action: deleteLabel,
        }),
        onClick: (rows) => deleteTaxDeadline.mutateAsync(idOf(rows[0]!)),
      },
    ]
    return {
      ...base,
      view: { ...view, actions: [...(view.actions ?? []), ...actions] },
    } as EntityViewConfig
  }, [
    t,
    askForm,
    companySelectOptions,
    runTaxCommand,
    createTaxDeadline.mutateAsync,
    updateTaxDeadline.mutateAsync,
    completeTaxDeadline.mutateAsync,
    waiveTaxDeadline.mutateAsync,
    deleteTaxDeadline.mutateAsync,
  ])
  return { taxDeadlineRows, taxDeadlineRecordSheet, taxDeadlinesEntityConfig }
}
