"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newExpenseForm,
  newExpenseSheetForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
} from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { expensesModuleConfig } from "@/lib/module-dashboard-configs"
import { useExpenses, useExpenseSheets, useCreateExpense, useCreateExpenseSheet } from "@/hooks/expenses"
import type { CreateExpenseParams, CreateExpenseSheetParams } from "@/hooks/expenses"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { usePricelists } from "@/hooks/sales"
import { useEmployees } from "@/hooks/hr"
import { pricelistRowsToSelectOptions, employeeRowsToSelectOptions } from "@/lib/form-lookup"

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

export function ExpensesClient(props: ExpensesClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <ExpensesClientLoaded {...props} organizationId={props.organizationId} />
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
  const { orgId, companyId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const { data: expenses = [] } = useExpenses(orgId, initialExpenses)
  const { data: sheets = [] } = useExpenseSheets(orgId, initialSheets)
  const { data: pricelists = [] } = usePricelists(companyId, initialPricelists)
  const { data: employees = [] } = useEmployees(orgId, initialEmployees)

  const createExpense = useCreateExpense(orgId, orgId)
  const createExpenseSheet = useCreateExpenseSheet(orgId, orgId)

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

  const liveSections = useMemo(() => {
    const pending = expenses.filter((e) => String(e.state) === "draft" || String(e.state) === "reported").length
    const totalAmount = expenses.reduce((sum, e) => sum + Number(e.totalAmount ?? 0), 0)
    const approved = expenses.filter((e) => String(e.state) === "approved" || String(e.state) === "done").length

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
                { label: t("expenses.dashboard.pendingApproval"), value: String(pending), icon: "Clock" },
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
  }, [expenses, moduleConfig, t, expenseFormConfig, expenseSheetFormConfig])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") return { ...tab, sections: liveSections }
          if (tab.id === "expenses") return { ...tab, createForm: expenseFormConfig }
          if (tab.id === "expense-sheets") return { ...tab, createForm: expenseSheetFormConfig }
          return tab
        }),
      }) as ModuleConfig,
    [liveSections, moduleConfig, expenseFormConfig, expenseSheetFormConfig],
  )

  const data = useMemo(
    () => ({
      expenses: expenses as unknown as Record<string, unknown>[],
      "expense-sheets": sheets as unknown as Record<string, unknown>[],
    }),
    [expenses, sheets],
  )

  const handleFormSubmit = (
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
      createExpense.mutate({
        employeeId: BigInt(String(empRaw)),
        name: formData.name as string,
        date: new Date(formData.date as string) as unknown as CreateExpenseParams["date"],
        unitAmount: Number(formData.totalAmount ?? 0),
        quantity: Number(formData.quantity ?? 1),
        currencyId: BigInt(String(pl.currencyId)),
        description: formData.description as string | undefined,
        productId: undefined,
        taxIds: [],
        accountId: undefined,
        analyticAccountId: undefined,
        attachmentIds: [],
      } as unknown as CreateExpenseParams)
    } else if (action === "createExpenseSheet" || action === "createSheet") {
      const plRaw = formData.pricelistId
      const empRaw = formData.employeeId
      if (plRaw === "" || plRaw == null || empRaw === "" || empRaw == null) return
      const pl = pricelists.find((p) => String(p.id) === String(plRaw))
      if (pl == null || pl.currencyId === undefined || pl.currencyId === null) return
      createExpenseSheet.mutate({
        employeeId: BigInt(String(empRaw)),
        name: formData.name as string,
        currencyId: BigInt(String(pl.currencyId)),
        notes: formData.notes as string | undefined,
        accountingDate: formData.accountingDate
          ? (new Date(formData.accountingDate as string) as unknown as CreateExpenseSheetParams["accountingDate"])
          : undefined,
      } as unknown as CreateExpenseSheetParams)
    }
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? expenseFormConfig}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
    </>
  )
}
