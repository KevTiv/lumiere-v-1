"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newExpenseForm,
  newExpenseSheetForm,
  editExpenseForm,
  addExpenseToReportForm,
  submitExpenseReportForm,
  postExpenseReportForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  mergeFieldDefaultValues,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  csvImportForm,
} from "@lumiere/ui"
import type { EntityViewConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
import { expensesModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useExpenses,
  useExpenseSheets,
  useCreateExpense,
  useCreateExpenseSheet,
  useUpdateExpense,
  useSubmitExpense,
  useSubmitExpenseSheet,
  useApproveExpenseSheet,
  useRefuseExpenseSheet,
  usePostExpenseSheet,
  useExpensesCsvImportMutations,
} from "@lumiere/query-hooks/hooks/expenses"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { useEmployees } from "@lumiere/query-hooks/hooks/hr"
import {
  toCreateExpenseParams,
  toCreateExpenseSheetParams,
} from "@/lib/expenses-create-params"
import {
  pricelistRowsToSelectOptions,
  employeeRowsToSelectOptions,
  expenseSheetRowsToDraftSelectOptions,
} from "@/lib/form-lookup"
import {
  mapExpenseRow,
  mapExpenseSheetRow,
  sumExpenseAmountsForSheet,
} from "@/lib/expense-state"

interface ExpensesClientProps {
  initialExpenses?: Record<string, unknown>[]
  initialSheets?: Record<string, unknown>[]
  initialPricelists?: Record<string, unknown>[]
  initialEmployees?: Record<string, unknown>[]
  organizationId?: number
}

type ExpensesClientLoadedProps = Omit<ExpensesClientProps, "organizationId"> & {
  organizationId: number
}

type WorkflowForm =
  | { kind: "editExpense"; row: Record<string, unknown> }
  | { kind: "addToReport"; row: Record<string, unknown> }
  | { kind: "submitReport"; row: Record<string, unknown> }
  | { kind: "postReport"; row: Record<string, unknown> }

type ExpensesCsvImportKind = "expense" | "sheet"

export function ExpensesClient(props: ExpensesClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <ExpensesClientLoaded {...props} organizationId={props.organizationId} />
}

function rowId(row: Record<string, unknown>): string {
  return String(row.id ?? "")
}

function numField(row: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k]
    if (v != null && v !== "") return Number(v)
  }
  return 0
}

function ExpensesClientLoaded({
  initialExpenses,
  initialSheets,
  initialPricelists,
  initialEmployees,
  organizationId,
}: ExpensesClientLoadedProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => expensesModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [rowAction, setRowAction] = useState<
    { tabId: "expenses" | "expense-sheets"; row: Record<string, unknown> } | null
  >(null)
  const [workflowForm, setWorkflowForm] = useState<WorkflowForm | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<
    { kind: "approve" | "refuse"; row: Record<string, unknown> } | null
  >(null)
  const [csvKind, setCsvKind] = useState<ExpensesCsvImportKind | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [toolbarError, setToolbarError] = useState<string | null>(null)

  const { data: expensesRaw = [] } = useExpenses(orgId, initialExpenses)
  const { data: sheetsRaw = [] } = useExpenseSheets(orgId, initialSheets)
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)
  const { data: employees = [] } = useEmployees(orgId, initialEmployees)

  const expenses = useMemo(
    () => expensesRaw.map((e) => mapExpenseRow(e as Record<string, unknown>)),
    [expensesRaw],
  )
  const sheets = useMemo(
    () => sheetsRaw.map((s) => mapExpenseSheetRow(s as Record<string, unknown>)),
    [sheetsRaw],
  )

  const createExpense = useCreateExpense(orgId, operatingCompanyId)
  const createExpenseSheet = useCreateExpenseSheet(orgId, operatingCompanyId)
  const updateExpense = useUpdateExpense(orgId, operatingCompanyId)
  const submitExpense = useSubmitExpense(orgId)
  const submitExpenseSheet = useSubmitExpenseSheet(orgId)
  const approveExpenseSheet = useApproveExpenseSheet(orgId)
  const refuseExpenseSheet = useRefuseExpenseSheet(orgId)
  const postExpenseSheet = usePostExpenseSheet(orgId)
  const csvImports = useExpensesCsvImportMutations(orgId)

  useEffect(() => {
    if (csvKind) setCsvError(null)
  }, [csvKind])

  const addCsvToolbar = (
    ec: EntityViewConfig,
    actions: Array<{
      id: string
      label: string
      requiresSelection?: boolean
      variant?: "default" | "destructive"
      onClick: (selectedRows: Record<string, unknown>[]) => void
    }>,
  ): EntityViewConfig => {
    if (ec.view.mode !== "table") return ec
    return {
      ...ec,
      view: {
        ...ec.view,
        rowSelectionToggleOnClick: false,
        actions,
      },
    }
  }

  const runSheetAction = async (
    rows: Record<string, unknown>[],
    label: string,
    fn: (row: Record<string, unknown>) => Promise<unknown>,
  ) => {
    setToolbarError(null)
    if (rows.length === 0) {
      setToolbarError(`Select at least one ${label}.`)
      return
    }
    try {
      for (const row of rows) await fn(row)
    } catch (e) {
      setToolbarError(e instanceof Error ? e.message : String(e))
    }
  }

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    const titleKey: Record<ExpensesCsvImportKind, string> = {
      expense: "expenses.csvImport.expenseTitle",
      sheet: "expenses.csvImport.sheetTitle",
    }
    return csvImportForm(t, t(titleKey[csvKind]))
  }, [csvKind, t])

  const pricelistFieldOptions = useMemo(() => {
    const fromApi = pricelistRowsToSelectOptions(pricelists)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noPricelists"), disabled: true }]
  }, [pricelists, t])

  const employeeFieldOptions = useMemo(() => {
    const fromApi = employeeRowsToSelectOptions(employees)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noEmployees"), disabled: true }]
  }, [employees, t])

  const expenseFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newExpenseForm(t), {
        pricelistId: pricelistFieldOptions,
        employeeId: employeeFieldOptions,
      }),
    [t, pricelistFieldOptions, employeeFieldOptions],
  )

  const expenseSheetFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newExpenseSheetForm(t), {
        pricelistId: pricelistFieldOptions,
        employeeId: employeeFieldOptions,
      }),
    [t, pricelistFieldOptions, employeeFieldOptions],
  )

  const editExpenseFormConfig = useMemo(() => editExpenseForm(t), [t])
  const addToReportFormBase = useMemo(() => addExpenseToReportForm(t), [t])
  const submitReportFormBase = useMemo(() => submitExpenseReportForm(t), [t])
  const postReportFormBase = useMemo(() => postExpenseReportForm(t), [t])

  const liveSections = useMemo(() => {
    const pendingApproval = sheets.filter((s) => String(s.state) === "Submitted").length
    const totalAmount = expenses.reduce((sum, e) => sum + Number(e.totalAmount ?? 0), 0)
    const approved = sheets.filter((s) => {
      const st = String(s.state)
      return st === "Approved" || st === "Posted" || st === "Done"
    }).length

    const dashboardTab = moduleConfig.tabs.find((tab) => tab.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: t("expenses.dashboard.totalExpenses"), value: String(expenses.length), icon: "Receipt" },
                { label: t("expenses.dashboard.pendingApproval"), value: String(pendingApproval), icon: "Clock" },
                { label: t("expenses.dashboard.approved"), value: String(approved), icon: "CheckCircle" },
                { label: t("expenses.dashboard.totalAmount"), value: `$${totalAmount.toLocaleString()}`, icon: "DollarSign" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_expense: () => setQuickActionForm({ form: expenseFormConfig, action: "createExpense" }),
            new_expense_sheet: () => setQuickActionForm({ form: expenseSheetFormConfig, action: "createSheet" }),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        return w
      }),
    }))
  }, [expenses, sheets, moduleConfig, t, expenseFormConfig, expenseSheetFormConfig])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") return { ...tab, sections: liveSections }
          if (tab.id === "expenses" && tab.entityConfig) {
            return {
              ...tab,
              createForm: expenseFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-expenses",
                  label: t("expenses.csvImport.toolbarExpenses"),
                  onClick: () => setCsvKind("expense"),
                },
              ]),
            }
          }
          if (tab.id === "expense-sheets" && tab.entityConfig) {
            return {
              ...tab,
              createForm: expenseSheetFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-sheets",
                  label: t("expenses.csvImport.toolbarSheets"),
                  onClick: () => setCsvKind("sheet"),
                },
                {
                  id: "submit-sheets",
                  label: t("expenses.workflow.submitReport"),
                  requiresSelection: true,
                  onClick: (rows) => {
                    const draft = rows.filter((r) => rowState(r) === "Draft")
                    if (draft.length === 0) {
                      setToolbarError(t("expenses.workflow.noDraftSheets"))
                      return
                    }
                    void runSheetAction(draft, "report", (row) => {
                      const total = sumExpenseAmountsForSheet(expenses as Record<string, unknown>[], rowId(row))
                      const fallback = Number(row.totalAmount ?? row.total_amount ?? 0)
                      return submitExpenseSheet.mutateAsync({
                        sheetId: rowId(row),
                        params: { totalAmount: total > 0 ? total : fallback },
                      })
                    })
                  },
                },
                {
                  id: "approve-sheets",
                  label: t("expenses.workflow.approveReport"),
                  requiresSelection: true,
                  onClick: (rows) => {
                    const submitted = rows.filter((r) => rowState(r) === "Submitted")
                    if (submitted.length === 0) {
                      setToolbarError(t("expenses.workflow.noSubmittedSheets"))
                      return
                    }
                    void runSheetAction(submitted, "report", (row) =>
                      approveExpenseSheet.mutateAsync(rowId(row)),
                    )
                  },
                },
                {
                  id: "refuse-sheets",
                  label: t("expenses.workflow.refuseReport"),
                  requiresSelection: true,
                  variant: "destructive",
                  onClick: (rows) => {
                    const submitted = rows.filter((r) => rowState(r) === "Submitted")
                    if (submitted.length === 0) {
                      setToolbarError(t("expenses.workflow.noSubmittedSheets"))
                      return
                    }
                    void runSheetAction(submitted, "report", (row) =>
                      refuseExpenseSheet.mutateAsync(rowId(row)),
                    )
                  },
                },
                {
                  id: "post-sheets",
                  label: t("expenses.workflow.postReport"),
                  requiresSelection: true,
                  onClick: (rows) => {
                    const approved = rows.filter((r) => rowState(r) === "Approved")
                    if (approved.length === 0) {
                      setToolbarError(t("expenses.workflow.noApprovedSheets"))
                      return
                    }
                    const today = new Date()
                    void runSheetAction(approved, "report", (row) =>
                      postExpenseSheet.mutateAsync({
                        sheetId: rowId(row),
                        accountingDate: today,
                      }),
                    )
                  },
                },
              ]),
            }
          }
          return tab
        }),
      }) as ModuleConfig,
    [liveSections, moduleConfig, expenseFormConfig, expenseSheetFormConfig, expenses, t, submitExpenseSheet, approveExpenseSheet, refuseExpenseSheet, postExpenseSheet],
  )

  const data = useMemo(
    () => ({
      expenses: expenses as unknown as Record<string, unknown>[],
      "expense-sheets": sheets as unknown as Record<string, unknown>[],
    }),
    [expenses, sheets],
  )

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createExpense") {
      const plRaw = formData.pricelistId
      const empRaw = formData.employeeId
      if (plRaw === "" || plRaw == null || empRaw === "" || empRaw == null) return
      const pl = pricelists.find((p) => String(p.id) === String(plRaw))
      if (pl == null || pl.currencyId === undefined || pl.currencyId === null) return
      const params = toCreateExpenseParams(formData, {
        currencyId: pl.currencyId,
        pricelistId: plRaw,
      })
      if (params === null) return
      await createExpense.mutateAsync(params)
    } else if (action === "createExpenseSheet" || action === "createSheet") {
      const plRaw = formData.pricelistId
      const empRaw = formData.employeeId
      if (plRaw === "" || plRaw == null || empRaw === "" || empRaw == null) return
      const pl = pricelists.find((p) => String(p.id) === String(plRaw))
      if (pl == null || pl.currencyId === undefined || pl.currencyId === null) return
      const params = toCreateExpenseSheetParams(formData, {
        currencyId: pl.currencyId,
        pricelistId: plRaw,
      })
      if (params === null) return
      await createExpenseSheet.mutateAsync(params)
    }
  }

  const isFormMutationPending =
    createExpense.isPending ||
    createExpenseSheet.isPending ||
    updateExpense.isPending ||
    submitExpense.isPending ||
    submitExpenseSheet.isPending ||
    approveExpenseSheet.isPending ||
    refuseExpenseSheet.isPending ||
    postExpenseSheet.isPending ||
    csvImports.importExpense.isPending ||
    csvImports.importExpenseSheet.isPending

  const addToReportFormForRow = useCallback(
    (row: Record<string, unknown>) => {
      const emp = String(row.employeeId ?? "")
      const opts = expenseSheetRowsToDraftSelectOptions(sheets as Record<string, unknown>[], emp)
      const options =
        opts.length > 0
          ? opts
          : [{ value: "", label: t("expenses.forms.addToReport.emptySheets"), disabled: true }]
      return mergeSelectOptionsForFields(addToReportFormBase, { sheetId: options })
    },
    [addToReportFormBase, sheets, t],
  )

  const workflowFormConfig: FormConfig | null = useMemo(() => {
    if (!workflowForm) return null
    if (workflowForm.kind === "editExpense") {
      const row = workflowForm.row
      return mergeFieldDefaultValues(editExpenseFormConfig, {
        name: String(row.name ?? ""),
        unitAmount: numField(row, "unitAmount", "unit_amount"),
        quantity: numField(row, "quantity") || 1,
        description: row.description != null ? String(row.description) : "",
      })
    }
    if (workflowForm.kind === "addToReport") {
      return addToReportFormForRow(workflowForm.row)
    }
    if (workflowForm.kind === "submitReport") {
      const row = workflowForm.row
      const sid = rowId(row)
      const suggested = sumExpenseAmountsForSheet(expenses as Record<string, unknown>[], sid)
      const fallback = Number(row.totalAmount ?? row.total_amount ?? 0)
      const total = suggested > 0 ? suggested : fallback
      return mergeFieldDefaultValues(submitReportFormBase, {
        totalAmount: total,
      })
    }
    if (workflowForm.kind === "postReport") {
      const today = new Date().toISOString().slice(0, 10)
      return mergeFieldDefaultValues(postReportFormBase, {
        accountingDate: today,
      })
    }
    return null
  }, [workflowForm, editExpenseFormConfig, addToReportFormForRow, submitReportFormBase, postReportFormBase, expenses])

  const handleWorkflowSubmit = async (formData: Record<string, unknown>) => {
    if (!workflowForm) return
    if (workflowForm.kind === "editExpense") {
      const id = rowId(workflowForm.row)
      if (!id) return
      await updateExpense.mutateAsync({
        expenseId: id,
        params: {
          name: String(formData.name ?? ""),
          unitAmount: Number(formData.unitAmount ?? 0),
          quantity: Number(formData.quantity ?? 1),
          description:
            formData.description != null && String(formData.description).trim() !== ""
              ? String(formData.description)
              : undefined,
        },
      })
    } else if (workflowForm.kind === "addToReport") {
      const sheetRaw = formData.sheetId
      if (sheetRaw === "" || sheetRaw == null) return
      await submitExpense.mutateAsync({
        expenseId: rowId(workflowForm.row),
        sheetId: String(sheetRaw),
      })
    } else if (workflowForm.kind === "submitReport") {
      await submitExpenseSheet.mutateAsync({
        sheetId: rowId(workflowForm.row),
        params: { totalAmount: Number(formData.totalAmount ?? 0) },
      })
    } else if (workflowForm.kind === "postReport") {
      const d = formData.accountingDate
      if (d == null || d === "") return
      await postExpenseSheet.mutateAsync({
        sheetId: rowId(workflowForm.row),
        accountingDate: new Date(String(d)),
      })
    }
    setWorkflowForm(null)
  }

  const handleRowClick = useCallback((tabId: string, row: Record<string, unknown>) => {
    if (tabId === "expenses" || tabId === "expense-sheets") {
      setRowAction({ tabId, row })
    }
  }, [])

  const rowState = (row: Record<string, unknown>) => String(row.state ?? "")

  return (
    <>
      {toolbarError ? (
        <p className="text-sm text-destructive mb-2" role="alert">
          {toolbarError}
        </p>
      ) : null}
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        onRowClick={handleRowClick}
        isPending={isFormMutationPending}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? expenseFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />

      {csvKind && csvFormConfig ? (
        <FormModal
          key={csvKind}
          open
          onOpenChange={(o) => !o && setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
          closeOnSubmit={false}
          submitError={csvError}
          onSubmit={async (data) => {
            setCsvError(null)
            const files = data.csvFile as FileList | undefined
            const file = files?.[0]
            if (!file) {
              setCsvError(t("common.validation.required"))
              return
            }
            try {
              const text = await file.text()
              if (csvKind === "expense") await csvImports.importExpense.mutateAsync(text)
              else await csvImports.importExpenseSheet.mutateAsync(text)
              setCsvKind(null)
            } catch (e) {
              setCsvError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}

      <Dialog open={rowAction !== null} onOpenChange={(open) => !open && setRowAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {rowAction?.tabId === "expenses"
                ? t("expenses.workflow.expenseTitle")
                : t("expenses.workflow.reportTitle")}
            </DialogTitle>
            <DialogDescription>
              {rowAction ? String(rowAction.row.name ?? rowAction.row.id ?? "") : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <p className="text-xs text-muted-foreground">
              {t("expenses.workflow.actionsTitle")} · {rowAction ? rowState(rowAction.row) : ""}
            </p>
            {rowAction?.tabId === "expenses" && rowState(rowAction.row) === "Draft" && (
              <>
                <Button
                  variant="default"
                  className="justify-start"
                  onClick={() => {
                    const row = rowAction.row
                    setRowAction(null)
                    setWorkflowForm({ kind: "editExpense", row })
                  }}
                >
                  {t("expenses.workflow.editExpense")}
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => {
                    const row = rowAction.row
                    setRowAction(null)
                    setWorkflowForm({ kind: "addToReport", row })
                  }}
                >
                  {t("expenses.workflow.addToReport")}
                </Button>
              </>
            )}
            {rowAction?.tabId === "expense-sheets" && rowState(rowAction.row) === "Draft" && (
              <Button
                variant="default"
                className="justify-start"
                onClick={() => {
                  const row = rowAction.row
                  setRowAction(null)
                  setWorkflowForm({ kind: "submitReport", row })
                }}
              >
                {t("expenses.workflow.submitReport")}
              </Button>
            )}
            {rowAction?.tabId === "expense-sheets" && rowState(rowAction.row) === "Submitted" && (
              <>
                <Button
                  variant="default"
                  className="justify-start"
                  onClick={() => {
                    const row = rowAction.row
                    setRowAction(null)
                    setConfirmDialog({ kind: "approve", row })
                  }}
                >
                  {t("expenses.workflow.approveReport")}
                </Button>
                <Button
                  variant="destructive"
                  className="justify-start"
                  onClick={() => {
                    const row = rowAction.row
                    setRowAction(null)
                    setConfirmDialog({ kind: "refuse", row })
                  }}
                >
                  {t("expenses.workflow.refuseReport")}
                </Button>
              </>
            )}
            {rowAction?.tabId === "expense-sheets" && rowState(rowAction.row) === "Approved" && (
              <Button
                variant="default"
                className="justify-start"
                onClick={() => {
                  const row = rowAction.row
                  setRowAction(null)
                  setWorkflowForm({ kind: "postReport", row })
                }}
              >
                {t("expenses.workflow.postReport")}
              </Button>
            )}
            {rowAction &&
              ((rowAction.tabId === "expenses" && rowState(rowAction.row) !== "Draft") ||
                (rowAction.tabId === "expense-sheets" &&
                  !["Draft", "Submitted", "Approved"].includes(rowState(rowAction.row)))) && (
                <p className="text-sm text-muted-foreground">{t("expenses.workflow.noActions")}</p>
              )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRowAction(null)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDialog !== null} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmDialog?.kind === "approve"
                ? t("expenses.workflow.confirmApprove")
                : t("expenses.workflow.confirmRefuse")}
            </DialogTitle>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              {t("common.cancel")}
            </Button>
            {confirmDialog?.kind === "approve" && (
              <Button
                onClick={() => {
                  const row = confirmDialog.row
                  setConfirmDialog(null)
                  void approveExpenseSheet.mutateAsync(rowId(row))
                }}
              >
                {t("common.confirm")}
              </Button>
            )}
            {confirmDialog?.kind === "refuse" && (
              <Button
                variant="destructive"
                onClick={() => {
                  const row = confirmDialog.row
                  setConfirmDialog(null)
                  void refuseExpenseSheet.mutateAsync(rowId(row))
                }}
              >
                {t("common.confirm")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {workflowFormConfig && workflowForm && (
        <FormModal
          key={`${workflowForm.kind}-${rowId(workflowForm.row)}`}
          open
          onOpenChange={(open) => !open && setWorkflowForm(null)}
          config={workflowFormConfig}
          isPending={isFormMutationPending}
          onSubmit={(fd) => handleWorkflowSubmit(fd)}
        />
      )}
    </>
  )
}
