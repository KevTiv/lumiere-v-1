"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  CsvImportModal,
  newExpenseForm,
  newExpenseSheetForm,
  editExpenseForm,
  addExpenseToReportForm,
  postExpenseReportForm,
  reimburseExpenseReportForm,
  setExpenseAllocationsForm,
  projectRebillExpenseReportForm,
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
import { useExpensesModuleSubscription } from "@/lib/module-subscription-hooks"
import {
  useExpenses,
  useExpenseSheets,
  useExpenseSheetsToApprove,
  useExpensesMissingReceipt,
  useExpenseCardStatementUnmatched,
  useCreateExpense,
  useCreateExpenseReceipt,
  useCreateExpenseSheet,
  useUpdateExpense,
  useSubmitExpense,
  useSubmitExpenseSheet,
  useApproveExpenseSheet,
  useRefuseExpenseSheet,
  usePostExpenseSheet,
  useCreateExpenseReimbursementPayment,
  useCreateExpenseProjectRebill,
  useSetExpenseAllocations,
  useExpensesCsvImportMutations,
  useExpenseMileageRates,
  useExpensePerDiemRates,
} from "@lumiere/query-hooks/hooks/expenses"
import { optionalBigIntU64 } from "@lumiere/erp-shared/form-coercion"
import { ExpensesCapturePanel } from "./expenses-capture-panel"
import { ExpensesInboxPanel } from "./expenses-inbox-panel"
import { ExpensesOpsPanel } from "./expenses-ops-panel"
import { ExpensesAdminPanel } from "./expenses-admin-panel"
import { useExpenseSheetApprovalTimeline } from "@lumiere/query-hooks/hooks/approvals"
import { useAccountAccounts, useAccountJournals } from "@lumiere/query-hooks/hooks/accounting"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { useEmployees } from "@lumiere/query-hooks/hooks/hr"
import {
  newExpenseReceiptClientRequestId,
  parseAttachmentIds,
  toCreateExpenseParams,
  toCreateExpenseSheetParams,
} from "@/lib/expenses-create-params"
import {
  pricelistRowsToSelectOptions,
  employeeRowsToSelectOptions,
  expenseSheetRowsToDraftSelectOptions,
  accountJournalRowsToSelectOptions,
  accountAccountRowsToSelectOptions,
  expenseRateRowsToSelectOptions,
} from "@/lib/form-lookup"
import {
  mapExpenseRow,
  mapExpenseSheetRow,
} from "@/lib/expense-state"
import { stbTimestampFromDate } from "@/lib/stb-timestamp"

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
  | { kind: "postReport"; row: Record<string, unknown> }
  | { kind: "reimburseReport"; row: Record<string, unknown> }
  | { kind: "setAllocations"; row: Record<string, unknown> }
  | { kind: "projectRebill"; row: Record<string, unknown> }

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
  useExpensesModuleSubscription()
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
    { kind: "approve" | "refuse" | "submit"; row: Record<string, unknown> } | null
  >(null)
  const [refuseReason, setRefuseReason] = useState("")
  const [csvKind, setCsvKind] = useState<ExpensesCsvImportKind | null>(null)
  const [toolbarError, setToolbarError] = useState<string | null>(null)
  const [timelineSheet, setTimelineSheet] = useState<Record<string, unknown> | null>(null)

  const { data: expensesRaw = [] } = useExpenses(orgId, initialExpenses)
  const { data: sheetsRaw = [] } = useExpenseSheets(orgId, initialSheets)
  const { data: sheetsToApprove = [] } = useExpenseSheetsToApprove(orgId)
  const { data: missingReceipts = [] } = useExpensesMissingReceipt(orgId)
  const { data: unmatchedCards = [] } = useExpenseCardStatementUnmatched(orgId)
  const timelineQuery = useExpenseSheetApprovalTimeline(
    organizationId,
    timelineSheet ? rowId(timelineSheet) : undefined,
    timelineSheet != null,
  )
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)
  const { data: employees = [] } = useEmployees(orgId, initialEmployees)
  const { data: accountJournals = [] } = useAccountJournals(orgId)
  const { data: accountAccounts = [] } = useAccountAccounts(orgId)
  const { data: mileageRates = [] } = useExpenseMileageRates(orgId)
  const { data: perDiemRates = [] } = useExpensePerDiemRates(orgId)

  const expenses = useMemo(
    () => expensesRaw.map((e) => mapExpenseRow(e as Record<string, unknown>)),
    [expensesRaw],
  )
  const sheets = useMemo(
    () => sheetsRaw.map((s) => mapExpenseSheetRow(s as Record<string, unknown>)),
    [sheetsRaw],
  )

  const createExpense = useCreateExpense(orgId, operatingCompanyId)
  const createExpenseReceipt = useCreateExpenseReceipt(orgId, operatingCompanyId)
  const createExpenseSheet = useCreateExpenseSheet(orgId, operatingCompanyId)
  const updateExpense = useUpdateExpense(orgId, operatingCompanyId)

  const resolveAttachmentIds = useCallback(
    async (formData: Record<string, unknown>, employeeIdRaw: unknown): Promise<bigint[]> => {
      const existing = parseAttachmentIds(formData)
      if (existing.length > 0) return existing
      const hasReceipt = formData.hasReceipt !== false && formData.hasReceipt !== "false"
      if (!hasReceipt) return []
      const employeeId = optionalBigIntU64(employeeIdRaw)
      if (employeeId === undefined) {
        throw new Error("Employee is required to register a receipt")
      }
      const clientRequestId = newExpenseReceiptClientRequestId()
      const storageKey =
        formData.storageKey != null && String(formData.storageKey).trim() !== ""
          ? String(formData.storageKey).trim()
          : `local:${clientRequestId}`
      const receiptId = await createExpenseReceipt.mutateAsync({
        employeeId,
        storageKey,
        clientRequestId,
        fileName:
          formData.fileName != null && String(formData.fileName).trim() !== ""
            ? String(formData.fileName)
            : undefined,
        mimeType:
          formData.mimeType != null && String(formData.mimeType).trim() !== ""
            ? String(formData.mimeType)
            : undefined,
      })
      return [receiptId]
    },
    [createExpenseReceipt],
  )
  const submitExpense = useSubmitExpense(orgId)
  const submitExpenseSheet = useSubmitExpenseSheet(orgId)
  const approveExpenseSheet = useApproveExpenseSheet(orgId)
  const refuseExpenseSheet = useRefuseExpenseSheet(orgId)
  const postExpenseSheet = usePostExpenseSheet(orgId)
  const reimburseExpenseSheet = useCreateExpenseReimbursementPayment(orgId)
  const setExpenseAllocations = useSetExpenseAllocations(orgId)
  const projectRebill = useCreateExpenseProjectRebill(orgId)
  const csvImports = useExpensesCsvImportMutations(orgId)

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
        // Keep click-to-select so toolbar actions with requiresSelection work.
        // Row click still opens the detail sheet via onRowClick; e2e dismisses that dialog.
        rowSelectionToggleOnClick: true,
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

  const mileageRateFieldOptions = useMemo(() => {
    const fromApi = expenseRateRowsToSelectOptions(mileageRates)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("expenses.forms.newExpense.fields.noMileageRates"), disabled: true }]
  }, [mileageRates, t])

  const perDiemRateFieldOptions = useMemo(() => {
    const fromApi = expenseRateRowsToSelectOptions(perDiemRates)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("expenses.forms.newExpense.fields.noPerDiemRates"), disabled: true }]
  }, [perDiemRates, t])

  const expenseFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newExpenseForm(t), {
        pricelistId: pricelistFieldOptions,
        employeeId: employeeFieldOptions,
        mileageRateId: mileageRateFieldOptions,
        perDiemRateId: perDiemRateFieldOptions,
      }),
    [t, pricelistFieldOptions, employeeFieldOptions, mileageRateFieldOptions, perDiemRateFieldOptions],
  )

  const expenseSheetFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newExpenseSheetForm(t), {
        pricelistId: pricelistFieldOptions,
        employeeId: employeeFieldOptions,
      }),
    [t, pricelistFieldOptions, employeeFieldOptions],
  )

  const editExpenseFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(editExpenseForm(t), {
        mileageRateId: mileageRateFieldOptions,
        perDiemRateId: perDiemRateFieldOptions,
      }),
    [t, mileageRateFieldOptions, perDiemRateFieldOptions],
  )
  const addToReportFormBase = useMemo(() => addExpenseToReportForm(t), [t])
  const journalFieldOptions = useMemo(() => {
    const fromApi = accountJournalRowsToSelectOptions(accountJournals)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noJournals"), disabled: true }]
  }, [accountJournals, t])
  const accountFieldOptions = useMemo(() => {
    const fromApi = accountAccountRowsToSelectOptions(accountAccounts)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noAccounts"), disabled: true }]
  }, [accountAccounts, t])
  const postReportFormBase = useMemo(
    () =>
      mergeSelectOptionsForFields(postExpenseReportForm(t), {
        journalId: journalFieldOptions,
        defaultExpenseAccountId: accountFieldOptions,
        payableAccountId: accountFieldOptions,
        defaultTaxAccountId: accountFieldOptions,
        cardLiabilityAccountId: accountFieldOptions,
        advanceAccountId: accountFieldOptions,
        fxFeeAccountId: accountFieldOptions,
      }),
    [t, journalFieldOptions, accountFieldOptions],
  )
  const reimburseReportFormBase = useMemo(
    () =>
      mergeSelectOptionsForFields(reimburseExpenseReportForm(t), {
        journalId: journalFieldOptions,
        payableAccountId: accountFieldOptions,
        liquidityAccountId: accountFieldOptions,
      }),
    [t, journalFieldOptions, accountFieldOptions],
  )
  const allocationsFormConfig = useMemo(() => setExpenseAllocationsForm(t), [t])
  const projectRebillFormBase = useMemo(
    () =>
      mergeSelectOptionsForFields(projectRebillExpenseReportForm(t), {
        journalId: journalFieldOptions,
        receivableAccountId: accountFieldOptions,
        incomeAccountId: accountFieldOptions,
      }),
    [t, journalFieldOptions, accountFieldOptions],
  )

  const liveSections = useMemo(() => {
    const pendingApproval = sheetsToApprove.length
    const missingReceiptCount = missingReceipts.length
    const unmatchedCardCount = unmatchedCards.length
    const totalAmount = sheets.reduce((sum, s) => sum + Number(s.totalAmount ?? 0), 0)
    const approved = sheets.filter((s) => {
      const st = String(s.state)
      return st === "Approved" || st === "Posted" || st === "Done"
    }).length

    return mapDashboardWidgets(moduleConfig, (w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: t("expenses.dashboard.totalExpenses"), value: String(expenses.length), icon: "Receipt" },
                { label: t("expenses.dashboard.pendingApproval"), value: String(pendingApproval), icon: "Clock" },
                { label: t("expenses.dashboard.missingReceipts"), value: String(missingReceiptCount), icon: "FileWarning" },
                {
                  label: t("expenses.dashboard.unmatchedCards", { defaultValue: "Unmatched cards" }),
                  value: String(unmatchedCardCount),
                  icon: "CreditCard",
                },
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
          })
  }, [
    expenses,
    sheets,
    sheetsToApprove.length,
    missingReceipts.length,
    unmatchedCards.length,
    moduleConfig,
    t,
    expenseFormConfig,
    expenseSheetFormConfig,
  ])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: withDashboardSections(moduleConfig, liveSections).tabs.map((tab) => {
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
                    void runSheetAction(draft, "report", (row) =>
                      submitExpenseSheet.mutateAsync(rowId(row)),
                    )
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
                    if (submitted.length === 1) {
                      setRefuseReason("")
                      setConfirmDialog({ kind: "refuse", row: submitted[0]! })
                      return
                    }
                    setToolbarError("Select one submitted report to refuse (reason required).")
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
                    if (approved.length === 1) {
                      setWorkflowForm({ kind: "postReport", row: approved[0]! })
                      return
                    }
                    setToolbarError("Select one approved report to post (accounts required).")
                  },
                },
                {
                  id: "reimburse-sheets",
                  label: t("expenses.workflow.reimburseReport"),
                  requiresSelection: true,
                  onClick: (rows) => {
                    const posted = rows.filter((r) => rowState(r) === "Posted")
                    if (posted.length === 0) {
                      setToolbarError(t("expenses.workflow.noPostedSheets"))
                      return
                    }
                    if (posted.length === 1) {
                      setWorkflowForm({ kind: "reimburseReport", row: posted[0]! })
                      return
                    }
                    setToolbarError("Select one posted report to reimburse.")
                  },
                },
              ]),
            }
          }
          return tab
        }),
      }) as ModuleConfig,
    [
      liveSections,
      moduleConfig,
      expenseFormConfig,
      expenseSheetFormConfig,
      t,
      submitExpenseSheet,
      approveExpenseSheet,
      refuseExpenseSheet,
      organizationId,
    ],
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
      const attachmentIds = await resolveAttachmentIds(formData, empRaw)
      const params = toCreateExpenseParams(
        formData,
        {
          currencyId: pl.currencyId,
          pricelistId: plRaw,
        },
        attachmentIds,
      )
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
    createExpenseReceipt.isPending ||
    createExpenseSheet.isPending ||
    updateExpense.isPending ||
    submitExpense.isPending ||
    submitExpenseSheet.isPending ||
    approveExpenseSheet.isPending ||
    refuseExpenseSheet.isPending ||
    postExpenseSheet.isPending ||
    reimburseExpenseSheet.isPending ||
    setExpenseAllocations.isPending ||
    projectRebill.isPending ||
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
      const paymentTag =
        typeof row.paymentMode === "object" && row.paymentMode != null && "tag" in (row.paymentMode as object)
          ? String((row.paymentMode as { tag: string }).tag)
          : String(row.paymentMode ?? row.payment_mode ?? "OutOfPocket")
      const taxRaw = row.taxIds ?? row.tax_ids
      const taxIds = Array.isArray(taxRaw) ? taxRaw.map(String).join(", ") : String(taxRaw ?? "")
      const hasReceipt = Boolean(row.hasReceipt ?? row.has_receipt)
      return mergeFieldDefaultValues(editExpenseFormConfig, {
        name: String(row.name ?? ""),
        unitAmount: numField(row, "unitAmount", "unit_amount"),
        quantity: numField(row, "quantity") || 1,
        mileageDistance: numField(row, "mileageDistance", "mileage_distance") || "",
        mileageRateId:
          row.mileageRateId != null || row.mileage_rate_id != null
            ? String(row.mileageRateId ?? row.mileage_rate_id)
            : "",
        perDiemDays: numField(row, "perDiemDays", "per_diem_days") || "",
        perDiemRateId:
          row.perDiemRateId != null || row.per_diem_rate_id != null
            ? String(row.perDiemRateId ?? row.per_diem_rate_id)
            : "",
        productId: row.productId != null || row.product_id != null
          ? String(row.productId ?? row.product_id)
          : "",
        taxIds,
        paymentMode: paymentTag === "CorporateCard" ? "CorporateCard" : "OutOfPocket",
        merchantKey: row.merchantKey != null || row.merchant_key != null
          ? String(row.merchantKey ?? row.merchant_key)
          : "",
        hasReceipt,
        description: row.description != null ? String(row.description) : "",
      })
    }
    if (workflowForm.kind === "addToReport") {
      return addToReportFormForRow(workflowForm.row)
    }
    if (workflowForm.kind === "postReport") {
      const today = new Date().toISOString().slice(0, 10)
      return mergeFieldDefaultValues(postReportFormBase, {
        accountingDate: today,
      })
    }
    if (workflowForm.kind === "reimburseReport") {
      const today = new Date().toISOString().slice(0, 10)
      return mergeFieldDefaultValues(reimburseReportFormBase, {
        paymentDate: today,
      })
    }
    if (workflowForm.kind === "setAllocations") {
      return allocationsFormConfig
    }
    if (workflowForm.kind === "projectRebill") {
      const today = new Date().toISOString().slice(0, 10)
      return mergeFieldDefaultValues(projectRebillFormBase, {
        invoiceDate: today,
      })
    }
    return null
  }, [
    workflowForm,
    editExpenseFormConfig,
    addToReportFormForRow,
    postReportFormBase,
    reimburseReportFormBase,
    allocationsFormConfig,
    projectRebillFormBase,
  ])

  const handleWorkflowSubmit = async (formData: Record<string, unknown>) => {
    if (!workflowForm) return
    if (workflowForm.kind === "editExpense") {
      const id = rowId(workflowForm.row)
      if (!id) return
      const hasReceipt = formData.hasReceipt !== false && formData.hasReceipt !== "false"
      const existingIds = parseAttachmentIds({
        attachmentIds: workflowForm.row.attachmentIds ?? workflowForm.row.attachment_ids,
      })
      let attachmentIds: bigint[] = []
      if (hasReceipt) {
        attachmentIds =
          existingIds.length > 0
            ? existingIds
            : await resolveAttachmentIds(formData, workflowForm.row.employeeId ?? workflowForm.row.employee_id)
      }
      const paymentTag = String(formData.paymentMode ?? "OutOfPocket")
      const lineKindTag = String(
        (workflowForm.row.lineKind as { tag?: string } | undefined)?.tag ??
          workflowForm.row.lineKind ??
          "Standard",
      )
      const mileageDistance =
        formData.mileageDistance != null && String(formData.mileageDistance).trim() !== ""
          ? Number(formData.mileageDistance)
          : undefined
      const perDiemDays =
        formData.perDiemDays != null && String(formData.perDiemDays).trim() !== ""
          ? Number(formData.perDiemDays)
          : undefined
      await updateExpense.mutateAsync({
        expenseId: id,
        params: {
          name: String(formData.name ?? ""),
          ...(lineKindTag === "Mileage" || lineKindTag === "PerDiem"
            ? {}
            : {
                unitAmount: Number(formData.unitAmount ?? 0),
                quantity: Number(formData.quantity ?? 1),
              }),
          description:
            formData.description != null && String(formData.description).trim() !== ""
              ? String(formData.description)
              : undefined,
          productId: optionalBigIntU64(formData.productId),
          taxIds: parseAttachmentIds({ attachmentIds: formData.taxIds }),
          paymentMode:
            paymentTag === "CorporateCard"
              ? ({ tag: "CorporateCard" } as const)
              : ({ tag: "OutOfPocket" } as const),
          merchantKey:
            formData.merchantKey != null && String(formData.merchantKey).trim() !== ""
              ? String(formData.merchantKey)
              : undefined,
          attachmentIds,
          mileageDistance: Number.isFinite(mileageDistance) ? mileageDistance : undefined,
          mileageRateId: optionalBigIntU64(formData.mileageRateId),
          perDiemDays: Number.isFinite(perDiemDays) ? perDiemDays : undefined,
          perDiemRateId: optionalBigIntU64(formData.perDiemRateId),
        },
      })
    } else if (workflowForm.kind === "addToReport") {
      const sheetRaw = formData.sheetId
      if (sheetRaw === "" || sheetRaw == null) return
      await submitExpense.mutateAsync({
        expenseId: rowId(workflowForm.row),
        sheetId: String(sheetRaw),
      })
    } else if (workflowForm.kind === "postReport") {
      const d = formData.accountingDate
      const journalId = formData.journalId
      const payableAccountId = formData.payableAccountId
      const defaultExpenseAccountId = formData.defaultExpenseAccountId
      const defaultTaxAccountId = formData.defaultTaxAccountId
      const cardLiabilityAccountId = formData.cardLiabilityAccountId
      const advanceAccountId = formData.advanceAccountId
      const fxFeeAccountId = formData.fxFeeAccountId
      const fxFeeAmountRaw = formData.fxFeeAmount
      if (d == null || d === "" || !journalId || !payableAccountId || !defaultExpenseAccountId) return
      await postExpenseSheet.mutateAsync({
        sheetId: rowId(workflowForm.row),
        params: {
          accountingDate: stbTimestampFromDate(new Date(String(d))),
          journalId: BigInt(String(journalId)),
          payableAccountId: BigInt(String(payableAccountId)),
          defaultExpenseAccountId: BigInt(String(defaultExpenseAccountId)),
          clientRequestId:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? `exp-post-${crypto.randomUUID()}`
              : `exp-post-${Date.now()}`,
          defaultTaxAccountId:
            defaultTaxAccountId != null && String(defaultTaxAccountId).trim() !== ""
              ? BigInt(String(defaultTaxAccountId))
              : undefined,
          cardLiabilityAccountId:
            cardLiabilityAccountId != null && String(cardLiabilityAccountId).trim() !== ""
              ? BigInt(String(cardLiabilityAccountId))
              : undefined,
          advanceAccountId:
            advanceAccountId != null && String(advanceAccountId).trim() !== ""
              ? BigInt(String(advanceAccountId))
              : undefined,
          fxFeeAccountId:
            fxFeeAccountId != null && String(fxFeeAccountId).trim() !== ""
              ? BigInt(String(fxFeeAccountId))
              : undefined,
          fxFeeAmount:
            fxFeeAmountRaw != null && String(fxFeeAmountRaw).trim() !== ""
              ? Number(fxFeeAmountRaw)
              : undefined,
        },
      })
    } else if (workflowForm.kind === "reimburseReport") {
      const d = formData.paymentDate
      const journalId = formData.journalId
      const payableAccountId = formData.payableAccountId
      const liquidityAccountId = formData.liquidityAccountId
      if (d == null || d === "" || !journalId || !payableAccountId || !liquidityAccountId) return
      const amountRaw = formData.amount
      const amount =
        amountRaw != null && String(amountRaw).trim() !== ""
          ? Number(amountRaw)
          : undefined
      await reimburseExpenseSheet.mutateAsync({
        sheetId: rowId(workflowForm.row),
        params: {
          paymentDate: stbTimestampFromDate(new Date(String(d))),
          journalId: BigInt(String(journalId)),
          payableAccountId: BigInt(String(payableAccountId)),
          liquidityAccountId: BigInt(String(liquidityAccountId)),
          ...(amount != null && Number.isFinite(amount) ? { amount } : {}),
        },
      })
    } else if (workflowForm.kind === "setAllocations") {
      const lines = []
      for (const n of [1, 2, 3, 4] as const) {
        const share = Number(formData[`sharePercent${n}`] ?? 0)
        if (!(share > 0)) continue
        lines.push({
          analyticAccountId: optionalBigIntU64(formData[`analyticAccountId${n}`]),
          projectId: optionalBigIntU64(formData[`projectId${n}`]),
          sharePercent: share,
          billable:
            n === 1
              ? formData.billable1 !== false && formData.billable1 !== "false"
              : formData[`billable${n}`] === true || formData[`billable${n}`] === "true",
          metadata: undefined as string | undefined,
        })
      }
      const shareTotal = lines.reduce((s, l) => s + l.sharePercent, 0)
      if (Math.abs(shareTotal - 100) > 0.01) {
        setToolbarError(t("expenses.ops.shareTotalInvalid"))
        return
      }
      await setExpenseAllocations.mutateAsync({
        expenseId: rowId(workflowForm.row),
        params: { lines },
      })
    } else if (workflowForm.kind === "projectRebill") {
      const d = formData.invoiceDate
      const journalId = formData.journalId
      const receivableAccountId = formData.receivableAccountId
      const incomeAccountId = formData.incomeAccountId
      if (d == null || d === "" || !journalId || !receivableAccountId || !incomeAccountId) return
      await projectRebill.mutateAsync({
        sheetId: rowId(workflowForm.row),
        params: {
          invoiceDate: stbTimestampFromDate(new Date(String(d))),
          journalId: BigInt(String(journalId)),
          receivableAccountId: BigInt(String(receivableAccountId)),
          incomeAccountId: BigInt(String(incomeAccountId)),
        },
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
      <ExpensesCapturePanel organizationId={organizationId} />
      <ExpensesOpsPanel organizationId={organizationId} />
      <ExpensesAdminPanel organizationId={organizationId} />
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
        <CsvImportModal
          key={csvKind}
          onClose={() => setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
          onImport={async (text) => {
            if (csvKind === "expense") await csvImports.importExpense.mutateAsync(text)
            else await csvImports.importExpenseSheet.mutateAsync(text)
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
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => {
                    const row = rowAction.row
                    setRowAction(null)
                    setWorkflowForm({ kind: "setAllocations", row })
                  }}
                >
                  {t("expenses.workflow.setAllocations")}
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
                  setConfirmDialog({ kind: "submit", row })
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
                    setRefuseReason("")
                    setConfirmDialog({ kind: "refuse", row })
                  }}
                >
                  {t("expenses.workflow.refuseReport")}
                </Button>
              </>
            )}
            {rowAction?.tabId === "expense-sheets" && (
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => {
                  const row = rowAction.row
                  setRowAction(null)
                  setTimelineSheet(row)
                }}
              >
                {t("expenses.workflow.approvalTimeline")}
              </Button>
            )}
            {rowAction?.tabId === "expense-sheets" && (
              <div className="rounded-md border p-3 text-sm space-y-2" data-testid="expenses-sheet-move-links">
                <div className="font-medium">
                  {t("expenses.workflow.accountingMoves", { defaultValue: "Accounting moves" })}
                </div>
                {(
                  [
                    ["accountMoveId", "account_move_id", "Post JE"],
                    ["reimbursementMoveId", "reimbursement_move_id", "Reimbursement"],
                    ["rebillMoveId", "rebill_move_id", "Rebill"],
                  ] as const
                ).map(([camel, snake, label]) => {
                  const moveId = rowAction.row[camel] ?? rowAction.row[snake]
                  const idStr = moveId != null && moveId !== "" ? String(moveId) : ""
                  return (
                    <div key={camel} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-muted-foreground">{label}</span>
                      {idStr ? (
                        <a
                          className="font-mono text-xs underline underline-offset-2"
                          href={`/accounting?tab=journal-entries&highlight=${encodeURIComponent(idStr)}`}
                          data-testid={`expenses-move-link-${camel}`}
                        >
                          #{idStr}
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  )
                })}
              </div>
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
            {rowAction?.tabId === "expense-sheets" && rowState(rowAction.row) === "Posted" && (
              <>
                <Button
                  variant="default"
                  className="justify-start"
                  onClick={() => {
                    const row = rowAction.row
                    setRowAction(null)
                    setWorkflowForm({ kind: "reimburseReport", row })
                  }}
                >
                  {t("expenses.workflow.reimburseReport")}
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => {
                    const row = rowAction.row
                    setRowAction(null)
                    setWorkflowForm({ kind: "projectRebill", row })
                  }}
                >
                  {t("expenses.workflow.projectRebill")}
                </Button>
              </>
            )}
            {rowAction?.tabId === "expense-sheets" && rowState(rowAction.row) === "Done" && (
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => {
                  const row = rowAction.row
                  setRowAction(null)
                  setWorkflowForm({ kind: "projectRebill", row })
                }}
              >
                {t("expenses.workflow.projectRebill")}
              </Button>
            )}
            {rowAction &&
              rowAction.tabId === "expenses" &&
              rowState(rowAction.row) !== "Draft" && (
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

      <Dialog open={timelineSheet !== null} onOpenChange={(open) => !open && setTimelineSheet(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("expenses.workflow.approvalTimeline")}</DialogTitle>
            <DialogDescription>
              {timelineSheet
                ? String(timelineSheet.name ?? timelineSheet.id ?? "")
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {timelineSheet && (
              <div className="rounded-md border p-3 text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">{t("expenses.workflow.timelineState")}: </span>
                  {rowState(timelineSheet)}
                </div>
                <div>
                  <span className="text-muted-foreground">{t("expenses.workflow.timelineSubmittedBy")}: </span>
                  {String(timelineSheet.submittedBy ?? timelineSheet.submitted_by ?? "—")}
                </div>
                <div>
                  <span className="text-muted-foreground">{t("expenses.workflow.timelineApprover")}: </span>
                  {String(timelineSheet.approverId ?? timelineSheet.approver_id ?? "—")}
                </div>
              </div>
            )}
            {timelineQuery.isLoading && (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            )}
            {!timelineQuery.isLoading && timelineQuery.rows.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("expenses.workflow.noApprovalRequests")}</p>
            )}
            {timelineQuery.rows.map((row) => (
              <div key={String(row.id)} className="rounded-md border p-3 text-sm space-y-1">
                <div className="font-medium">{String(row.summary ?? row.action ?? "Approval")}</div>
                <div className="text-muted-foreground">
                  {String(row.status ?? "pending")} · {String(row.action ?? "")}
                </div>
                {row.rejectReason ||
                row.reject_reason ||
                row.decisionComment ||
                row.decision_comment ? (
                  <div className="text-destructive">
                    {String(
                      row.rejectReason ??
                        row.reject_reason ??
                        row.decisionComment ??
                        row.decision_comment,
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTimelineSheet(null)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDialog(null)
            setRefuseReason("")
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmDialog?.kind === "approve"
                ? t("expenses.workflow.confirmApprove")
                : confirmDialog?.kind === "submit"
                  ? t("expenses.workflow.confirmSubmit")
                  : t("expenses.workflow.confirmRefuse")}
            </DialogTitle>
          </DialogHeader>
          {confirmDialog?.kind === "refuse" && (
            <div className="space-y-2 py-2">
              <label className="text-sm font-medium" htmlFor="refuse-reason">
                {t("expenses.workflow.refuseReason")}
              </label>
              <textarea
                id="refuse-reason"
                className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm"
                value={refuseReason}
                onChange={(e) => setRefuseReason(e.target.value)}
                placeholder={t("expenses.workflow.refuseReasonPlaceholder")}
              />
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              {t("common.cancel")}
            </Button>
            {confirmDialog?.kind === "submit" && (
              <Button
                onClick={() => {
                  const row = confirmDialog.row
                  setConfirmDialog(null)
                  void submitExpenseSheet.mutateAsync(rowId(row)).catch((e) =>
                    setToolbarError(e instanceof Error ? e.message : String(e)),
                  )
                }}
              >
                {t("common.confirm")}
              </Button>
            )}
            {confirmDialog?.kind === "approve" && (
              <Button
                onClick={() => {
                  const row = confirmDialog.row
                  setConfirmDialog(null)
                  void approveExpenseSheet.mutateAsync(rowId(row)).catch((e) =>
                    setToolbarError(e instanceof Error ? e.message : String(e)),
                  )
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
                  const reason = refuseReason.trim()
                  setConfirmDialog(null)
                  setRefuseReason("")
                  void refuseExpenseSheet
                    .mutateAsync({
                      sheetId: rowId(row),
                      params: { reason: reason || undefined },
                    })
                    .catch((e) => setToolbarError(e instanceof Error ? e.message : String(e)))
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
