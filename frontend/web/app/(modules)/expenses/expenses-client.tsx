"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newExpenseForm, newExpenseSheetForm } from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { expensesModuleConfig } from "@/lib/module-dashboard-configs"
import { useExpenses, useExpenseSheets, useCreateExpense, useCreateExpenseSheet, useStdbConnection, getStdbConnection, expensesSubscriptions } from "@lumiere/stdb"
import type { CreateExpenseParams, CreateExpenseSheetParams } from "@lumiere/stdb"

interface ExpensesClientProps {
  initialExpenses?: Record<string, unknown>[]
  initialSheets?: Record<string, unknown>[]
  organizationId?: number
}

export function ExpensesClient({ initialExpenses, initialSheets, organizationId }: ExpensesClientProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => expensesModuleConfig(t), [t])
  const orgId = BigInt(organizationId ?? 1)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const { connected } = useStdbConnection()

  useEffect(() => {
    const conn = getStdbConnection()
    if (!conn || !connected) return
    conn.subscriptionBuilder()
      .onError((err) => console.error("[stdb] expenses subscription error", err))
      .subscribe(expensesSubscriptions(orgId))
  }, [connected, orgId])

  const { data: expenses = [] } = useExpenses(orgId, initialExpenses)
  const { data: sheets = [] } = useExpenseSheets(orgId, initialSheets)
  const createExpense = useCreateExpense(orgId, orgId)
  const createExpenseSheet = useCreateExpenseSheet(orgId, orgId)

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
                { label: "Total Expenses", value: String(expenses.length), icon: "Receipt" },
                { label: "Pending Approval", value: String(pending), icon: "Clock" },
                { label: "Approved", value: String(approved), icon: "CheckCircle" },
                { label: "Total Amount", value: `$${totalAmount.toLocaleString()}`, icon: "DollarSign" },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            new_expense: () => setQuickActionForm({ form: newExpenseForm(t), action: "createExpense" }),
            new_expense_sheet: () => setQuickActionForm({ form: newExpenseSheetForm(t), action: "createExpenseSheet" }),
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
  }, [expenses, moduleConfig, t])

  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab,
      ),
    }),
    [liveSections, moduleConfig],
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
      createExpense.mutate({
        employeeId: BigInt(formData.employeeId as number),
        name: formData.name as string,
        date: new Date(formData.date as string) as unknown as CreateExpenseParams["date"],
        unitAmount: Number(formData.totalAmount ?? 0),
        quantity: Number(formData.quantity ?? 1),
        currencyId: BigInt(1),
        description: formData.description as string | undefined,
        productId: undefined,
        taxIds: [],
        accountId: undefined,
        analyticAccountId: undefined,
        attachmentIds: [],
      } as unknown as CreateExpenseParams)
    } else if (action === "createExpenseSheet") {
      createExpenseSheet.mutate({
        employeeId: BigInt(formData.employeeId as number),
        name: formData.name as string,
        currencyId: BigInt(1),
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
        config={quickActionForm?.form ?? newExpenseForm(t)}
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
