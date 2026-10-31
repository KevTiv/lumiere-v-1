"use client"

import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { ModuleWorkView } from "../../../components/work-board/module-work-view"
import { useErpSession } from "@lumiere/erp-session"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { useGenericExpenseCreate } from "./use-generic-expense-create"
import { retainedExpenseForm } from "./generic-expense-attempt"
import { useCurrencyFormat } from "@lumiere/ui"
import { FinanceReviewWorkspace } from "@lumiere/ui/composed/finance-review-workspace"
import { expensesTableConfig } from "@lumiere/ui/lib/expenses-entity-configs"
import { ExpenseSourcePreview } from "../../../components/finance-source-preview"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"
import { canUseModuleData, mergeModuleStates, moduleCollection, moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { CompanyModuleInsights } from "../../../components/module-insights"
import { withInlineEdits } from "@lumiere/ui/lib/with-inline-edits"
import { useRouter } from "next/navigation"
import { ExpensesInboxPanel } from "./expenses-inbox-panel"
import { useExpenseReportDecision } from "./expense-report-decision"
import { companyWorkflowRows, eligibleExpenseReports, reportCurrencyTotals, workflowOptions } from "./expense-workflow-model"
import {
  inlineNumberAbove,
  isDraftExpense,
  isDraftStandardExpense,
  requiredInlineText,
} from "@/lib/inline-edit-params"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  EntityDetail,
  FormModal,
  CsvImportModal,
  CSV_IMPORT_CONTRACTS,
  newExpenseForm,
  newExpenseSheetForm,
  editExpenseForm,
  addExpenseToReportForm,
  setExpenseAllocationsForm,
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
import type { EntityAction, EntityViewConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
import { expensesModuleConfig } from "@/lib/module-dashboard-configs"
import Link from "next/link"
import { expenseReportHref } from "./expense-report"
import { useExpenseReportFinance } from "./expense-report-finance-dialogs"
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
  useSetExpenseAllocations,
  useExpensesCsvImportMutations,
  useExpenseMileageRates,
  useExpensePerDiemRates,
  type HrExpense,
  type HrExpenseSheet,
} from "@lumiere/query-hooks/hooks/expenses"
import { optionalBigIntU64 } from "@lumiere/erp-shared/form-coercion"
import { ExpensesCapturePanel } from "./expenses-capture-panel"
import { ExpensesOpsPanel } from "./expenses-ops-panel"
import { ExpensesAdminPanel } from "./expenses-admin-panel"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { usePricelists, type ProductPricelist } from "@lumiere/query-hooks/hooks/sales"
import { useEmployees, type HrEmployee } from "@lumiere/query-hooks/hooks/hr"
import { useProducts } from "@lumiere/query-hooks/hooks/inventory"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import { currencyCodeMap } from "@lumiere/ui/lib/kpi-tiles"
import type { ChartValueFormat } from "@lumiere/ui/lib/chart-format"
import type { TabbedTableRow } from "@lumiere/ui"
import { approvalBacklog, monthlySpend, spendByCategory } from "./expenses-dashboard-charts"
import { useProjects } from "@lumiere/query-hooks/hooks/projects"
import { useAccountTaxes, useAccountAnalyticAccounts } from "@lumiere/query-hooks/hooks/accounting"
import { allocationLookupRows, expenseAllocationLines } from "./expense-allocation-input"
import { expenseVariantTag } from "@/lib/expense-state"
import { createExpenseReceiptAttemptCache, expenseCreateContext, expenseCompanyLookupRows, expenseInputsForLineKind, expenseProductLookupRows, expenseTaxLookupRows, preserveExpenseEditSelections } from "./expense-capture-input"
import {
  expenseQuantity,
  newExpenseReceiptClientRequestId,
  parseAttachmentIds,
  toCreateExpenseParams,
  toCreateExpenseSheetParams,
} from "@/lib/expenses-create-params"
import { firstFileFromFormValue, uploadDocumentBlob } from "@/lib/document-blob-upload"
import {
  pricelistRowsToSelectOptions,
  employeeRowsToSelectOptions,
  expenseRateRowsToSelectOptions,
  projectRowsToSelectOptions,
  productRowsToSelectOptions,
} from "@/lib/form-lookup"
import {
  mapExpenseRow,
  mapExpenseSheetRow,
} from "@/lib/expense-state"

interface ExpensesClientProps {
  initialExpenses?: HrExpense[]
  initialSheets?: HrExpenseSheet[]
  initialPricelists?: ProductPricelist[]
  initialEmployees?: HrEmployee[]
  organizationId?: number
}

type ExpensesClientLoadedProps = Omit<ExpensesClientProps, "organizationId"> & {
  organizationId: number
}

type WorkflowForm =
  | { kind: "editExpense"; row: Record<string, unknown> }
  | { kind: "addToReport"; row: Record<string, unknown> }
  | { kind: "setAllocations"; row: Record<string, unknown> }

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

/** The report's name opens its page; the row itself still opens the actions dialog. */
function withReportLink(ec: EntityViewConfig): EntityViewConfig {
  if (ec.view.mode !== "table") return ec
  return {
    ...ec,
    view: {
      ...ec.view,
      columns: ec.view.columns.map((column) =>
        column.key === "name"
          ? {
              ...column,
              render: (_value: unknown, row: Record<string, unknown>) => {
                const href = expenseReportHref(row)
                const shown = String(row.name ?? "").trim()
                if (!href || !shown) return shown || "—"
                return (
                  <Link
                    href={href}
                    className="font-medium text-primary hover:underline"
                    data-testid={`expense-report-link-${String(row.id)}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {shown}
                  </Link>
                )
              },
            }
          : column,
      ),
    },
  }
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
  const router = useRouter()
  const { identity } = useErpSession()
  const { checkPermission, permissionsReady } = useRBAC()
  const moduleConfig = useMemo(() => expensesModuleConfig(t), [t])
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const [quickActionForm, setQuickActionForm] = useState<{ action: "createExpense" | "createSheet" } | null>(null)
  const [rowAction, setRowAction] = useState<
    { tabId: "expenses"; row: Record<string, unknown> } | null
  >(null)
  const [workflowForm, setWorkflowForm] = useState<WorkflowForm | null>(null)
  const [csvKind, setCsvKind] = useState<ExpensesCsvImportKind | null>(null)
  const [toolbarError, setToolbarError] = useState<string | null>(null)
  const [reportContinuation, setReportContinuation] = useState<WorkflowForm | null>(null)
  const [resolveReceiptAttempt] = useState(createExpenseReceiptAttemptCache)
  useEffect(() => { setQuickActionForm(null); setWorkflowForm(null); setReportContinuation(null) }, [identity, orgId, operatingCompanyId])

  const expensesRead = moduleCollection(useExpenses(orgId, initialExpenses))
  const expensesRaw = expensesRead.rows
  const sheetsRead = moduleCollection(useExpenseSheets(orgId, initialSheets))
  const sheetsRaw = sheetsRead.rows
  const sheetsToApproveRead = moduleCollection(useExpenseSheetsToApprove(orgId))
  const sheetsToApprove = sheetsToApproveRead.rows
  const missingReceiptsRead = moduleCollection(useExpensesMissingReceipt(orgId))
  const missingReceipts = missingReceiptsRead.rows
  const unmatchedCardsRead = moduleCollection(useExpenseCardStatementUnmatched(orgId))
  const unmatchedCards = unmatchedCardsRead.rows
  const expensesUsable = canUseModuleData(expensesRead.state)
  const sheetsUsable = canUseModuleData(sheetsRead.state)
  const currenciesQuery = useCurrencies()
  const sheetsState = sheetsRead.state
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)
  const { data: employees = [] } = useEmployees(orgId, initialEmployees)
  const { data: products = [] } = useProducts(orgId)
  const { data: currencies = [] } = useCurrencies()
  const { data: mileageRates = [] } = useExpenseMileageRates(orgId)
  const { data: perDiemRates = [] } = useExpensePerDiemRates(orgId)
  const projectsQuery = useProjects(orgId)
  const { data: projects = [] } = projectsQuery
  const allocationAccountsQuery = useAccountAnalyticAccounts(orgId, { enabled: workflowForm?.kind === "setAllocations" && operatingCompanyId > 0n })
  const { data: taxes = [] } = useAccountTaxes(orgId, { enabled: operatingCompanyId > 0n })

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
  const expenseCreate = useGenericExpenseCreate({
    organizationId: orgId, companyId: operatingCompanyId, actorIdentity: identity,
    create: (params) => createExpense.mutateAsync(params),
    onConfirmed: () => setQuickActionForm(null),
    canWrite: () => expensesUsable && permissionsReady !== false && checkPermission("hr_expense", "create").allowed,
  })
  const openExpenseCreate = useCallback(() => {
    if (!expensesUsable || permissionsReady === false || !checkPermission("hr_expense", "create").allowed) return
    setToolbarError(null)
    try {
      if (expenseCreate.open()) setQuickActionForm({ action: "createExpense" })
    } catch (cause) { setToolbarError(cause instanceof Error ? cause.message : String(cause)) }
  }, [expensesUsable, permissionsReady, checkPermission, expenseCreate.open])

  const resolveAttachmentIds = useCallback(
    async (formData: Record<string, unknown>, employeeIdRaw: unknown): Promise<bigint[]> => {
      const hasReceipt = formData.hasReceipt !== false && formData.hasReceipt !== "false"
      if (!hasReceipt) return []
      const employeeId = optionalBigIntU64(employeeIdRaw)
      if (employeeId === undefined) {
        throw new Error(t("expenses.forms.capture.employeeRequired", { defaultValue: "Select an employee before uploading a receipt." }))
      }
      const receiptFile = firstFileFromFormValue(formData.receiptFile)
      if (!receiptFile) {
        throw new Error(t("expenses.forms.capture.receiptRequired", { defaultValue: "Choose a receipt file, or clear the receipt checkbox." }))
      }
      const receiptId = await resolveReceiptAttempt(receiptFile, { organizationId: orgId, companyId: operatingCompanyId, employeeId }, {
        upload: (file, companyId) => uploadDocumentBlob({ file, companyId, purpose: "expense_receipt" }),
        register: (params, companyId) => createExpenseReceipt.mutateAsync({ ...params, companyId }),
        newRequestId: newExpenseReceiptClientRequestId,
      })
      return [receiptId]
    },
    [createExpenseReceipt, operatingCompanyId, orgId, resolveReceiptAttempt, t],
  )
  const submitExpense = useSubmitExpense(orgId)
  const submitExpenseSheet = useSubmitExpenseSheet(orgId, operatingCompanyId)
  const approveExpenseSheet = useApproveExpenseSheet(orgId, operatingCompanyId)
  const decision = useExpenseReportDecision(orgId, operatingCompanyId, sheetsUsable)
  const finance = useExpenseReportFinance(orgId, operatingCompanyId, sheetsUsable)
  const setExpenseAllocations = useSetExpenseAllocations(orgId)
  const csvImports = useExpensesCsvImportMutations(orgId)

  const addCsvToolbar = (
    ec: EntityViewConfig,
    actions: EntityAction[],
  ): EntityViewConfig => {
    if (ec.view.mode !== "table") return ec
    return {
      ...ec,
      view: {
        ...ec.view,
        // Use checkboxes for selection; opening a report must not also select it.
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
    const codes = currencyCodeMap(currencies)
    const fromApi = pricelistRowsToSelectOptions(pricelists).map((option) => {
      const row = pricelists.find((candidate) => String(candidate.id) === option.value)
      const code = codes.get(String(row?.currencyId))
      return { ...option, label: code ? `${option.label} · ${code}` : option.label }
    })
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noPricelists"), disabled: true }]
  }, [pricelists, currencies, t])

  const employeeFieldOptions = useMemo(() => {
    const fromApi = employeeRowsToSelectOptions(expenseCompanyLookupRows(employees, orgId, operatingCompanyId))
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noEmployees"), disabled: true }]
  }, [employees, orgId, operatingCompanyId, t])

  const mileageRateFieldOptions = useMemo(() => {
    const fromApi = expenseRateRowsToSelectOptions(expenseCompanyLookupRows(mileageRates, orgId, operatingCompanyId))
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("expenses.forms.newExpense.fields.noMileageRates"), disabled: true }]
  }, [mileageRates, orgId, operatingCompanyId, t])

  const perDiemRateFieldOptions = useMemo(() => {
    const fromApi = expenseRateRowsToSelectOptions(expenseCompanyLookupRows(perDiemRates, orgId, operatingCompanyId))
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("expenses.forms.newExpense.fields.noPerDiemRates"), disabled: true }]
  }, [perDiemRates, orgId, operatingCompanyId, t])

  const projectFieldOptions = useMemo(() => {
    const rows = expenseCompanyLookupRows(projects, orgId, operatingCompanyId)
    return [{ value: "", label: t("expenses.forms.capture.noProject", { defaultValue: "No project" }) }, ...projectRowsToSelectOptions(rows)]
  }, [projects, orgId, operatingCompanyId, t])
  const productFieldOptions = useMemo(() => [
    { value: "", label: t("expenses.forms.capture.noProduct", { defaultValue: "No expense product" }) },
    ...productRowsToSelectOptions(expenseProductLookupRows(products, orgId)),
  ], [products, orgId, t])
  const taxFieldOptions = useMemo(() => expenseTaxLookupRows(taxes, orgId, operatingCompanyId).map((row) => ({
    value: String(row.id), label: String(row.name),
  })), [taxes, orgId, operatingCompanyId])

  const expenseFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newExpenseForm(t), {
        pricelistId: pricelistFieldOptions,
        employeeId: employeeFieldOptions,
        mileageRateId: mileageRateFieldOptions,
        perDiemRateId: perDiemRateFieldOptions,
        projectId: projectFieldOptions,
        productId: productFieldOptions,
        taxIds: taxFieldOptions,
      }),
    [t, pricelistFieldOptions, employeeFieldOptions, mileageRateFieldOptions, perDiemRateFieldOptions, projectFieldOptions, productFieldOptions, taxFieldOptions],
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
        projectId: projectFieldOptions,
        productId: productFieldOptions,
        taxIds: taxFieldOptions,
      }),
    [t, mileageRateFieldOptions, perDiemRateFieldOptions, projectFieldOptions, productFieldOptions, taxFieldOptions],
  )
  const addToReportFormBase = useMemo(() => addExpenseToReportForm(t), [t])
  const allocationProjectsState = moduleQueryState(projectsQuery)
  const allocationAccountsState = moduleQueryState(allocationAccountsQuery)
  const allocationProjects = allocationProjectsState.status === "ready" ? allocationLookupRows(projects, orgId, operatingCompanyId) : []
  const allocationAccounts = allocationAccountsState.status === "ready" ? allocationLookupRows(allocationAccountsQuery.data ?? [], orgId, operatingCompanyId, true) : []
  const allocationChoicesReady = allocationProjects.length > 0 || allocationAccounts.length > 0
  const allocationsFormConfig = setExpenseAllocationsForm(t, {
    projectOptions: allocationProjects.map((row) => ({ value: String(row.id), label: String(row.name ?? row.id) })),
    analyticAccountOptions: allocationAccounts.map((row) => ({ value: String(row.id), label: [row.code, row.name].filter(Boolean).map(String).join(" · ") || String(row.id) })),
    projectsState: allocationProjectsState, analyticAccountsState: allocationAccountsState,
  }, setExpenseAllocations.isPending)
  const companyCurrencyRows = useCompanies(Number(orgId), orgId > 0n).data ?? []
  const { locale } = useCurrencyFormat()
  const liveSections = useMemo(() => {
    const pendingApproval = sheetsToApprove.length
    const missingReceiptCount = missingReceipts.length
    const unmatchedCardCount = unmatchedCards.length
    const scopedSheets = companyWorkflowRows(sheetsRaw, orgId, operatingCompanyId)
    const approved = sheets.filter((s) => {
      const st = String(s.state)
      return st === "Approved" || st === "Posted" || st === "Done"
    }).length

    const now = new Date()
    const nowMs = now.getTime()
    const currencyCodeById = currencyCodeMap(currencies)
    const productNames = new Map(products.map((product) => [String(product.id), String(product.name ?? "")]))
    const employeeNames = new Map(employees.map((employee) => [String(employee.id), String(employee.name ?? "")]))
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
    const chartExpenses = expensesRaw.filter((expense) => expense.companyId === operatingCompanyId)
    const expenseCurrencies = new Set(chartExpenses.map((expense) => currencyCodeById.get(String(expense.currencyId)) ?? ""))
    if (chartExpenses.length === 0) {
      const base = companyCurrencyRows.find(company => company.id === operatingCompanyId)?.currencyId
      const code = base == null ? undefined : currencyCodeById.get(String(base))
      if (code) expenseCurrencies.add(code)
    }
    const money: ChartValueFormat =
      expenseCurrencies.size === 1 && [...expenseCurrencies][0]
        ? { kind: "currency", currency: [...expenseCurrencies][0]! }
        : { kind: "number" }

    return mapDashboardWidgets(moduleConfig, (w) => {
        if (["exp-monthly-spend", "exp-spend-by-category"].includes(w.id) && (expenseCurrencies.size !== 1 || expenseCurrencies.has(""))) {
          return { ...w, type: "diagnostic", data: { code: "missing-measure", message: "This aggregate requires one known currency. Mixed currencies need verified conversion." } }
        }
        if (w.type === "combo-chart" && w.id === "exp-monthly-spend") {
          return { ...w, data: { ...w.data, values: monthlySpend(chartExpenses, now, 6, locale), valueFormat: money } }
        }
        if (w.type === "ranked-bars" && w.id === "exp-spend-by-category") {
          return {
            ...w,
            data: {
              ...w.data,
              items: spendByCategory(
                chartExpenses,
                productNames,
                { startMs: monthStart, endMs: nowMs },
                { startMs: lastMonthStart, endMs: monthStart - 1 },
              ),
              valueFormat: money,
              changeLabel: "vs last month",
            },
          }
        }
        if (w.type === "tabbed-table" && w.id === "exp-approval-backlog") {
          return {
            ...w,
            data: {
              tabs: [
                { id: "all", label: "All" },
                { id: "awaiting-approval", label: "Awaiting approval" },
                { id: "awaiting-posting", label: "Awaiting posting" },
              ],
              columns: [
                { key: "report", label: "Report" },
                { key: "employee", label: "Employee" },
                { key: "submitted", label: "Created" },
                { key: "ageDays", label: "Age (days)", type: "number", align: "right" },
                { key: "amount", label: "Amount", type: "currency", currencyKey: "currency", align: "right" },
                {
                  key: "status",
                  label: "Status",
                  type: "badge",
                  badgeVariants: { "Awaiting approval": "warning", "Awaiting posting": "info" },
                },
              ],
              rows: approvalBacklog(sheetsRaw, employeeNames, currencyCodeById, nowMs),
              emptyMessage: "Nothing waiting — every expense report is handled.",
              onRowClick: (row: TabbedTableRow) => {
                const sheet = sheetsRaw.find((candidate) => String(candidate.id) === String(row.id))
                if (sheet) router.push(expenseReportHref(sheet)!)
              },
            },
          }
        }
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
                { label: t("expenses.dashboard.totalAmount"), value: reportCurrencyTotals(scopedSheets, currencyCodeById, locale, t("expenses.workflowUi.amountUnavailable")), icon: "DollarSign" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_expense: openExpenseCreate,
            new_expense_sheet: () => setQuickActionForm({ action: "createSheet" }),
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
    companyCurrencyRows,
    locale,
    expenses,
    sheets,
    expensesRaw,
    sheetsRaw,
    products,
    employees,
    currencies,
    sheetsToApprove.length,
    missingReceipts.length,
    unmatchedCards.length,
    moduleConfig,
    t,
    expenseFormConfig,
    expenseSheetFormConfig,
    openExpenseCreate,
    router, orgId, operatingCompanyId,
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
              entityConfig: withInlineEdits(
                addCsvToolbar(tab.entityConfig, [
                  {
                    id: "csv-expenses",
                    label: t("expenses.csvImport.toolbarExpenses"),
                    permission: { resource: CSV_IMPORT_CONTRACTS.expense.resource, action: "create" },
                    onClick: () => setCsvKind("expense"),
                  },
                ]),
                {
                  // The backend only edits Draft expenses.
                  name: {
                    kind: "text",
                    canEdit: isDraftExpense,
                    save: async (row, value) => {
                      const name = requiredInlineText(
                        value,
                        t("expenses.inlineEdit.nameRequired", { defaultValue: "An expense needs a description" }),
                      )
                      await updateExpense.mutateAsync({ expenseId: row.id as string | number, params: { name } })
                    },
                  },
                  // Mileage and per diem lines derive their quantity, so only standard lines take it.
                  quantity: {
                    kind: "number",
                    canEdit: isDraftStandardExpense,
                    save: async (row, value) => {
                      const quantity = inlineNumberAbove(
                        value,
                        0,
                        t("expenses.inlineEdit.quantityInvalid", { defaultValue: "Quantity must be above 0" }),
                      )
                      await updateExpense.mutateAsync({ expenseId: row.id as string | number, params: { quantity } })
                    },
                  },
                },
              ),
            }
          }
          if (tab.id === "expense-sheets" && tab.entityConfig) {
            return {
              ...tab,
              createForm: expenseSheetFormConfig,
              entityConfig: addCsvToolbar(withReportLink(tab.entityConfig), [
                {
                  id: "csv-sheets",
                  label: t("expenses.csvImport.toolbarSheets"),
                  permission: { resource: CSV_IMPORT_CONTRACTS.expenseSheet.resource, action: "create" },
                  onClick: () => setCsvKind("sheet"),
                },
                {
                  id: "submit-sheets",
                  permission: { resource: "hr_expense_sheet", action: "update" },
                  label: t("expenses.workflow.submitReport"),
                  requiresSelection: true,
                  selection: "multiple",
                  isApplicable: (rows) => rows.some((r) => rowState(r) === "Draft"),
                  onClick: async (rows) => {
                    const draft = rows.filter((r) => rowState(r) === "Draft")
                    if (draft.length === 0) {
                      setToolbarError(t("expenses.workflow.noDraftSheets"))
                      return
                    }
                    if (draft.length === 1) { decision.open("submit", draft[0]!); return }
                    await runSheetAction(draft, "report", (row) =>
                      submitExpenseSheet.mutateAsync(rowId(row)),
                    )
                  },
                },
                {
                  id: "approve-sheets",
                  permission: { resource: "hr_expense_sheet", action: "approve" },
                  label: t("expenses.workflow.approveReport"),
                  requiresSelection: true,
                  selection: "multiple",
                  isApplicable: (rows) => rows.some((r) => rowState(r) === "Submitted"),
                  onClick: async (rows) => {
                    const submitted = rows.filter((r) => rowState(r) === "Submitted")
                    if (submitted.length === 0) {
                      setToolbarError(t("expenses.workflow.noSubmittedSheets"))
                      return
                    }
                    if (submitted.length === 1) { decision.open("approve", submitted[0]!); return }
                    await runSheetAction(submitted, "report", (row) =>
                      approveExpenseSheet.mutateAsync(rowId(row)),
                    )
                  },
                },
                {
                  id: "refuse-sheets",
                  permission: { resource: "hr_expense_sheet", action: "approve" },
                  label: t("expenses.workflow.refuseReport"),
                  requiresSelection: true,
                  selection: "multiple",
                  isApplicable: (rows) => rows.some((r) => rowState(r) === "Submitted"),
                  variant: "destructive",
                  onClick: (rows) => {
                    const submitted = rows.filter((r) => rowState(r) === "Submitted")
                    if (submitted.length === 0) {
                      setToolbarError(t("expenses.workflow.noSubmittedSheets"))
                      return
                    }
                    if (submitted.length === 1) {
                      decision.open("refuse", submitted[0]!)
                      return
                    }
                    setToolbarError("Select one submitted report to refuse (reason required).")
                  },
                },
                {
                  id: "post-sheets",
                  label: t("expenses.workflow.postReport"),
                  requiresSelection: true,
                  selection: "multiple",
                  isApplicable: (rows) => rows.some((r) => rowState(r) === "Approved"),
                  onClick: (rows) => {
                    const approved = rows.filter((r) => rowState(r) === "Approved")
                    if (approved.length === 0) {
                      setToolbarError(t("expenses.workflow.noApprovedSheets"))
                      return
                    }
                    if (approved.length === 1) {
                      finance.open("postReport", approved[0]!)
                      return
                    }
                    setToolbarError("Select one approved report to post (accounts required).")
                  },
                },
                {
                  id: "reimburse-sheets",
                  label: t("expenses.workflow.reimburseReport"),
                  requiresSelection: true,
                  selection: "multiple",
                  isApplicable: (rows) => rows.some((r) => rowState(r) === "Posted"),
                  onClick: (rows) => {
                    const posted = rows.filter((r) => rowState(r) === "Posted")
                    if (posted.length === 0) {
                      setToolbarError(t("expenses.workflow.noPostedSheets"))
                      return
                    }
                    if (posted.length === 1) {
                      finance.open("reimburseReport", posted[0]!)
                      return
                    }
                    setToolbarError("Select one posted report to reimburse.")
                  },
                },
              ]),
            }
          }
          if (tab.id === "inbox") return { ...tab, customContent: <ExpensesInboxPanel
            organizationId={organizationId} companyId={operatingCompanyId}
            onOpenExpense={(row) => setWorkflowForm({ kind: "editExpense", row })} /> }
          return tab
        }).concat({
          // Capture queue, statement/FX operations and admin settings live in
          // their own tab rather than above the module header.
          id: "operations",
          label: t("expenses.workflowUi.capture"),
          type: "custom" as const,
          description: t("expenses.operationsTabDescription", {
            defaultValue: "Capture receipts and review retained expense saves",
          }),
          customContent: (
            <div className="space-y-6">
              <ExpensesCapturePanel organizationId={organizationId} />
            </div>
          ),
        }, {
          id: "card-reconciliation", label: t("expenses.workflowUi.reconciliation"), type: "custom" as const,
          customContent: <ExpensesOpsPanel organizationId={organizationId} section="cards" />,
        }, {
          id: "expense-settings", label: t("expenses.workflowUi.settings"), type: "custom" as const,
          customContent: <div className="space-y-6"><ExpensesOpsPanel organizationId={organizationId} section="rates" /><ExpensesAdminPanel organizationId={organizationId} /></div>,
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
      decision,
      organizationId,
      updateExpense,
    ],
  )

  const data = useMemo(() => {
    // Show the employee's name in the Employee column instead of their id.
    const employeeNames = new Map(
      (employees as Record<string, unknown>[]).map((e) => [String(e.id), String(e.name ?? "")]),
    )
    const withEmployeeName = (rows: Record<string, unknown>[]) =>
      rows.map((row) => {
        const name = employeeNames.get(String(row.employeeId ?? ""))
        return { ...row, employeeName: name || String(row.employeeId ?? "") }
      })
    return {
      expenses: withEmployeeName(expenses as unknown as Record<string, unknown>[]),
      "expense-sheets": withEmployeeName(sheets as unknown as Record<string, unknown>[]),
    }
  }, [expenses, sheets, employees])

  const dataState = {
    dashboard: mergeModuleStates([
      expensesRead.state, sheetsRead.state, sheetsToApproveRead.state, missingReceiptsRead.state, unmatchedCardsRead.state,
    ]),
    expenses: expensesRead.state,
    "expense-sheets": sheetsRead.state,
  }
  const actionUsable = (action: string) =>
    action === "createExpense" ? expensesUsable
      : action === "createExpenseSheet" || action === "createSheet" ? sheetsUsable : true
  const quickActionUsable = quickActionForm == null || (quickActionForm.action === "createExpense" && expenseCreate.attempt !== null) || actionUsable(quickActionForm.action)
  const csvUsable = csvKind == null || (csvKind === "expense" ? expensesUsable : sheetsUsable)
  const rowActionUsable = rowAction == null || expensesUsable
  useEffect(() => {
    // Dialogs close when the collection their rows came from is denied or fails.
    if (!quickActionUsable) setQuickActionForm(null)
    // Keep CSV request identity and recovery mounted when the source becomes unavailable.
    if (!rowActionUsable) setRowAction(null)
    if (!expensesUsable) setWorkflowForm(null)
  }, [quickActionUsable, rowActionUsable, expensesUsable, sheetsUsable])

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (!actionUsable(action)) throw new Error(t("common.recordsUnavailable", { defaultValue: "Records could not be loaded." }))
    if (action === "createExpense") {
      if (permissionsReady === false || !checkPermission("hr_expense", "create").allowed) throw new Error(t("common.recordsUnavailable"))
      const context = expenseCreateContext(formData, employees, pricelists, orgId, operatingCompanyId, t)
      const params = toCreateExpenseParams(expenseInputsForLineKind(formData), context.currencyId)
      if (params === null) throw new Error(t("expenses.forms.capture.dateRequired", { defaultValue: "Enter a valid expense date before saving. Your entries have been retained." }))
      await expenseCreate.submit(params, formData)
    } else if (action === "createExpenseSheet" || action === "createSheet") {
      const context = expenseCreateContext(formData, employees, pricelists, orgId, operatingCompanyId, t)
      const params = toCreateExpenseSheetParams(formData, context.currencyId)
      if (params === null) throw new Error(t("expenses.forms.capture.contextRequired", { defaultValue: "Check the employee and price list before saving this report. Your entries have been retained." }))
      if (reportContinuation && (String(context.currencyId) !== String(reportContinuation.row.currencyId) || String(context.employeeId) !== String(reportContinuation.row.employeeId))) {
        throw new Error(t("expenses.workflowUi.reportCurrencyMismatch"))
      }
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
    decision.isPending ||
    finance.isPending ||
    setExpenseAllocations.isPending ||
    csvImports.importExpense.isPending ||
    csvImports.importExpenseSheet.isPending

  const addToReportFormForRow = useCallback(
    (row: Record<string, unknown>) => {
      const opts = workflowOptions(eligibleExpenseReports(companyWorkflowRows(sheets, orgId, operatingCompanyId), row))
      const options =
        opts.length > 0
          ? opts
          : [{ value: "", label: t("expenses.forms.addToReport.emptySheets"), disabled: true }]
      return mergeSelectOptionsForFields(addToReportFormBase, { sheetId: options })
    },
    [addToReportFormBase, sheets, t, orgId, operatingCompanyId],
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
      const taxIds = parseAttachmentIds({ attachmentIds: taxRaw }).map(String)
      const hasReceipt = Boolean(row.hasReceipt ?? row.has_receipt)
      return preserveExpenseEditSelections(mergeFieldDefaultValues(editExpenseFormConfig, {
        name: String(row.name ?? ""),
        lineKind: expenseVariantTag(row.lineKind ?? row.line_kind) || "Standard",
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
      }), (value) => t("common.form.unavailableSelection", { value, defaultValue: "Unavailable selection: {{value}}" }))
    }
    if (workflowForm.kind === "addToReport") {
      return addToReportFormForRow(workflowForm.row)
    }
    if (workflowForm.kind === "setAllocations") {
      return allocationsFormConfig
    }
    return null
  }, [
    workflowForm,
    editExpenseFormConfig,
    addToReportFormForRow,
    allocationsFormConfig,
  ])

  const handleWorkflowSubmit = async (formData: Record<string, unknown>) => {
    if (!workflowForm) return
    if (!expensesUsable) throw new Error(t("common.recordsUnavailable", { defaultValue: "Records could not be loaded." }))
    if (workflowForm.kind === "editExpense") {
      formData = expenseInputsForLineKind(formData, workflowForm.row.lineKind ?? workflowForm.row.line_kind)
      const id = rowId(workflowForm.row)
      if (!id) return
      const hasReceipt = formData.hasReceipt !== false && formData.hasReceipt !== "false"
      const existingIds = parseAttachmentIds({
        attachmentIds: workflowForm.row.attachmentIds ?? workflowForm.row.attachment_ids,
      })
      let attachmentIds: bigint[] = []
      if (hasReceipt) {
        const replacementFile = firstFileFromFormValue(formData.receiptFile)
        attachmentIds = replacementFile || existingIds.length === 0
          ? [...existingIds, ...await resolveAttachmentIds(formData, workflowForm.row.employeeId ?? workflowForm.row.employee_id)]
          : existingIds
      }
      const paymentTag = String(formData.paymentMode ?? "OutOfPocket")
      const lineKindTag = expenseVariantTag(workflowForm.row.lineKind ?? workflowForm.row.line_kind) || "Standard"
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
                quantity: expenseQuantity(formData.quantity),
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
      if (!sheetsUsable || !eligibleExpenseReports(companyWorkflowRows(sheets, orgId, operatingCompanyId), workflowForm.row).some(sheet => String(sheet.id) === String(sheetRaw))) {
        throw new Error(t("expenses.workflowUi.selectionUnavailable"))
      }
      await submitExpense.mutateAsync({
        expenseId: rowId(workflowForm.row),
        sheetId: String(sheetRaw),
      })
    } else if (workflowForm.kind === "setAllocations") {
      const currentExpense = companyWorkflowRows(expenses, orgId, operatingCompanyId).find((row) => rowId(row) === rowId(workflowForm.row))
      if (!currentExpense || expenseVariantTag(currentExpense.state) !== "Draft" || permissionsReady === false || !checkPermission("hr_expense", "write").allowed || formData.confirmAllocationReplacement !== true) {
        throw new Error(t("expenses.allocations.reviewRequired", { defaultValue: "Confirm the replacement for a current draft expense you can edit. Your rows are retained." }))
      }
      const lines = expenseAllocationLines(formData.allocationLines,
        new Set(allocationProjects.map((row) => String(row.id))), new Set(allocationAccounts.map((row) => String(row.id))),
        t("expenses.allocations.invalidRow", { defaultValue: "Each allocation needs a current company project or active analytic account, a share greater than 0 and at most 100, and a billable choice. Correct invalid or unavailable selections; your rows are retained." }),
        t("expenses.ops.shareTotalInvalid"),
      )
      await setExpenseAllocations.mutateAsync({
        expenseId: rowId(workflowForm.row),
        params: { lines },
      })
    }
    setWorkflowForm(null)
  }

  const handleRowClick = useCallback((tabId: string, row: Record<string, unknown>) => {
    if (tabId === "expense-sheets") router.push(expenseReportHref(row)!)
    else if (tabId === "expenses") setRowAction({ tabId, row })
  }, [router])

  const rowState = (row: Record<string, unknown>) => String(row.state ?? "")

  const expenseReviewTable = expensesTableConfig(t).view
  const expenseReviewColumns = expenseReviewTable.mode === "table" ? expenseReviewTable.columns.map(({ width: _width, ...column }) => column) : []
  const rowReviewActions = (
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
            {rowAction &&
              rowAction.tabId === "expenses" &&
              rowState(rowAction.row) !== "Draft" && (
                <p className="text-sm text-muted-foreground">{t("expenses.workflow.noActions")}</p>
              )}
          </div>
  )

  const visibleToolbarError = toolbarError || decision.error || (quickActionForm === null ? expenseCreate.error : null)

  const retainedExpenseMessage = quickActionForm?.action === "createExpense" ? [
    expenseCreate.error,
    expenseCreate.attempt ? expenseCreate.attempt.companyId !== String(operatingCompanyId)
      ? t("expenses.forms.recovery.scopeChanged", { defaultValue: "Switch back to the company saved with this request to check its status." })
      : t("expenses.forms.recovery.retained", { defaultValue: "Your entries and the original request are retained. Check the result before starting another expense." }) : null,
    expenseCreate.attempt?.receipt ? expenseCreate.attempt.receipt.receiptId
      ? t("expenses.forms.recovery.receiptAttached", { defaultValue: "Receipt attached: {{fileName}}.", fileName: expenseCreate.attempt.receipt.fileName })
      : expenseCreate.attempt.receipt.uploaded
        ? t("expenses.forms.recovery.receiptUploaded", { defaultValue: "Receipt uploaded: {{fileName}}. Its registration will be checked with the original request.", fileName: expenseCreate.attempt.receipt.fileName })
        : t("expenses.forms.recovery.receiptRetained", { defaultValue: "Receipt: {{fileName}}. If the upload has not completed after a reload, select the original file to continue.", fileName: expenseCreate.attempt.receipt.fileName }) : null,
  ].filter(Boolean).join(" ") || null : null

  return (
    <>
      {visibleToolbarError ? (
        <p className="text-sm text-destructive mb-2" role="alert">
          {visibleToolbarError}
        </p>
      ) : null}
      {expenseCreate.attempt ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" data-testid="expense-create-resume" disabled={expenseCreate.busy} onClick={() => {
            setToolbarError(null)
            try { expenseCreate.resume(); setQuickActionForm({ action: "createExpense" }) }
            catch (cause) { setToolbarError(cause instanceof Error ? cause.message : String(cause)) }
          }}>
            {t("expenses.forms.recovery.reviewRequest", { defaultValue: "Review retained expense" })}
          </Button>
        </div>
      ) : null}
      <ModuleWorkView
        organizationId={organizationId}
        config={config}
        dashboardContent={<CompanyModuleInsights input={{ module: "expenses", organizationId, companyId: operatingCompanyId, records: { rows: sheetsRaw, state: sheetsState }, currencies: { rows: currenciesQuery.data ?? [], state: moduleQueryState(currenciesQuery) } }} sections={liveSections} />}
        data={data}
        dataState={dataState}
        onOpenCreateForm={(tabId) => {
          if (tabId === "expenses") openExpenseCreate()
          else if (tabId === "expense-sheets") setQuickActionForm({ action: "createSheet" })
        }}
        onFormSubmit={handleFormSubmit}
        onRowClick={handleRowClick}
        isPending={isFormMutationPending}
      />
      <FormModal
        open={quickActionForm !== null && quickActionUsable}
        onOpenChange={(open) => {
          if (!open) {
            setQuickActionForm(null)
            if (reportContinuation) { setWorkflowForm(reportContinuation); setReportContinuation(null) }
          }
        }}
        config={quickActionForm?.action === "createSheet" ? mergeFieldDefaultValues(expenseSheetFormConfig, reportContinuation ? { employeeId: String(reportContinuation.row.employeeId) } : {}) : { ...retainedExpenseForm(expenseFormConfig, expenseCreate.attempt, expenseCreate.attempt?.companyId === String(operatingCompanyId)), ...(expenseCreate.attempt ? { cancelLabel: t("common.close") } : {}) }}
        hasDurableRecovery={quickActionForm?.action === "createExpense" && expenseCreate.attempt !== null}
        isPending={isFormMutationPending || expenseCreate.busy}
        closeOnSubmit={quickActionForm?.action === "createSheet"}
        showSubmitSuccessToast={quickActionForm?.action === "createSheet"}
        draft={quickActionForm?.action === "createSheet"}
        draftKey={reportContinuation ? `report-for-expense-${rowId(reportContinuation.row)}` : undefined}
        submissionDisabled={quickActionForm?.action === "createExpense" && expenseCreate.attempt !== null}
        submitError={retainedExpenseMessage}
        onValuesChange={quickActionForm?.action === "createExpense" ? expenseCreate.reattach : undefined}
        formLeadingActions={quickActionForm?.action === "createExpense" && expenseCreate.attempt ? (
          <div role="status" data-testid="expense-create-attempt" data-client-request-id={expenseCreate.attempt.clientRequestId} data-company-id={expenseCreate.attempt.companyId} data-sync-state={expenseCreate.attempt.syncState} className="flex min-w-0 flex-wrap items-center gap-2 text-sm [overflow-wrap:anywhere]">
            <span className="font-medium">{t("expenses.forms.recovery.title", { defaultValue: "Expense save status" })}</span>
            <Button type="button" variant="outline" data-testid="expense-create-check-status" disabled={expenseCreate.busy || expenseCreate.attempt.companyId !== String(operatingCompanyId)} onClick={() => { void expenseCreate.checkStatus().catch(() => undefined) }}>
              {expenseCreate.attempt.syncState === "unknown" || expenseCreate.attempt.syncState === "submitting"
                ? t("expenses.forms.recovery.checkStatus", { defaultValue: "Check status" })
                : t("expenses.forms.recovery.continue", { defaultValue: "Continue retained request" })}
            </Button>
          </div>
        ) : undefined}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            if (quickActionForm.action === "createSheet") {
              setQuickActionForm(null)
              if (reportContinuation) { setWorkflowForm(reportContinuation); setReportContinuation(null) }
            }
          }
        }}
      />

      {csvKind && csvFormConfig ? (
        <CsvImportModal
          sourceState={csvKind === "expense" ? expensesRead.state : sheetsRead.state}
          trackedImport={{ companyId: operatingCompanyId }}
          organizationId={orgId}
          tableName={csvKind === "expense" ? "hr_expense" : "hr_expense_sheet"}
          key={csvKind}
          onClose={() => setCsvKind(null)}
          config={csvFormConfig}
          columns={csvKind === "expense" ? CSV_IMPORT_CONTRACTS.expense : CSV_IMPORT_CONTRACTS.expenseSheet}
          templateFileName={`${csvKind}-import-template.csv`}
          isPending={isFormMutationPending}
          onImport={async (text) => {
            if (!csvUsable) throw new Error(t("common.recordsUnavailable", { defaultValue: "Records could not be loaded." }))
            if (csvKind === "expense") await csvImports.importExpense.mutateAsync(text)
            else await csvImports.importExpenseSheet.mutateAsync(text)
          }}
        />
      ) : null}

      <Dialog open={rowAction !== null && rowActionUsable} onOpenChange={(open) => !open && setRowAction(null)}>
        <DialogContent className={rowAction?.tabId === "expenses" ? "max-h-[90dvh] overflow-y-auto sm:max-w-[min(1280px,calc(100vw-1rem))]" : "sm:max-w-md"}>
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
          {rowAction?.tabId === "expenses" ? <FinanceReviewWorkspace
            editorLabel={t("financeReview.savedDetails", { defaultValue: "Saved details" })}
            editor={<div className="flex flex-col gap-4"><EntityDetail config={{ mode: "detail", sections: [{ id: "expense", fields: expenseReviewColumns }] }} data={rowAction.row} />{rowReviewActions}</div>}
            preview={<ExpenseSourcePreview organizationId={orgId} companyId={operatingCompanyId} record={rowAction.row} />}
          /> : rowReviewActions}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRowAction(null)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {decision.modal}
      {finance.modal}
      {workflowFormConfig && workflowForm && expensesUsable && (
        <FormModal
          key={`${workflowForm.kind}-${rowId(workflowForm.row)}`}
          open={quickActionForm === null}
          onOpenChange={(open) => !open && setWorkflowForm(null)}
          config={workflowFormConfig}
          isPending={isFormMutationPending}
          draftKey={workflowForm.kind === "setAllocations" ? rowId(workflowForm.row) : undefined}
          submissionDisabled={workflowForm.kind === "setAllocations" && (!allocationChoicesReady || permissionsReady === false || !checkPermission("hr_expense", "write").allowed)}
          formLeadingActions={workflowForm.kind === "addToReport" ? <Button type="button" variant="outline"
            data-testid="expense-create-report-continuation" disabled={!sheetsUsable || permissionsReady === false || !checkPermission("hr_expense_sheet", "create").allowed} onClick={() => {
              setReportContinuation(workflowForm); setQuickActionForm({ action: "createSheet" })
            }}>{t("expenses.workflowUi.createReport")}</Button> : undefined}
          onSubmit={(fd) => handleWorkflowSubmit(fd)}
        />
      )}
    </>
  )
}
