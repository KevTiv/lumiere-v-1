"use client"

import { useMemo } from "react"
import { ModuleView } from "@lumiere/ui"
import { accountingModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useAccountAccounts,
  useAccountMoves,
  useAccountTaxes,
  useBudgets,
  useAnalyticAccounts,
  useCreateAccount,
  useCreateMove,
  useCreateTax,
  useCreateBudget,
} from "@lumiere/stdb"
import type {
  CreateAccountAccountParams,
  CreateAccountMoveParams,
  CreateAccountTaxParams,
  CreateCrossoveredBudgetParams,
} from "@lumiere/stdb"

// TODO: replace with real org/company IDs from auth context
const ORG_ID = 1n
const COMPANY_ID = 1n

export default function AccountingPage() {
  const { data: accounts = [] } = useAccountAccounts(COMPANY_ID)
  const { data: allMoves = [] } = useAccountMoves(COMPANY_ID)
  const { data: taxes = [] } = useAccountTaxes(COMPANY_ID)
  const { data: budgets = [] } = useBudgets(COMPANY_ID)
  const { data: analytic = [] } = useAnalyticAccounts(COMPANY_ID)

  const createAccount = useCreateAccount(ORG_ID, COMPANY_ID)
  const createMove = useCreateMove(ORG_ID, COMPANY_ID)
  const createTax = useCreateTax(ORG_ID, COMPANY_ID)
  const createBudget = useCreateBudget(ORG_ID, COMPANY_ID)

  // Pre-filter moves by type for Invoices / Bills tabs
  const invoices = useMemo(
    () => allMoves.filter((m) => String(m.moveType) === "out_invoice"),
    [allMoves],
  )
  const bills = useMemo(
    () => allMoves.filter((m) => String(m.moveType) === "in_invoice"),
    [allMoves],
  )

  // Compute live KPIs to override the dashboard tab's static stat-cards / cash-flow widgets
  const liveSections = useMemo(() => {
    const ar = invoices.reduce((s, m) => s + Number(m.amountResidual ?? 0), 0)
    const ap = bills.reduce((s, m) => s + Number(m.amountResidual ?? 0), 0)
    const cash = accounts
      .filter((a) => a.isBankAccount)
      .reduce((s, a) => s + Number(a.openingBalance ?? 0), 0)
    const revenue = invoices
      .filter((m) => String(m.state) === "posted")
      .reduce((s, m) => s + Number(m.amountTotal ?? 0), 0)

    const dashboardTab = accountingModuleConfig.tabs.find((t) => t.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: "Accounts Receivable", value: `$${ar.toLocaleString()}`, icon: "TrendingUp" },
                { label: "Accounts Payable", value: `$${ap.toLocaleString()}`, icon: "TrendingDown" },
                { label: "Cash Balance", value: `$${cash.toLocaleString()}`, icon: "DollarSign" },
                { label: "Revenue MTD", value: `$${revenue.toLocaleString()}`, icon: "BarChart2" },
              ],
            },
          }
        }
        if (w.type === "cash-flow") {
          return { ...w, data: { arTotal: ar, apTotal: ap, netPosition: ar - ap } }
        }
        return w
      }),
    }))
  }, [accounts, invoices, bills])

  // Build final config with live dashboard sections replacing static ones
  const config = useMemo(
    () => ({
      ...accountingModuleConfig,
      tabs: accountingModuleConfig.tabs.map((tab) =>
        tab.id === "dashboard" ? { ...tab, sections: liveSections } : tab,
      ),
    }),
    [liveSections],
  )

  // Data keyed by tab id consumed by entity view tabs
  const data = useMemo(
    () => ({
      accounts: accounts as unknown as Record<string, unknown>[],
      "journal-entries": allMoves as unknown as Record<string, unknown>[],
      invoices: invoices as unknown as Record<string, unknown>[],
      bills: bills as unknown as Record<string, unknown>[],
      taxes: taxes as unknown as Record<string, unknown>[],
      budgets: budgets as unknown as Record<string, unknown>[],
      analytic: analytic as unknown as Record<string, unknown>[],
    }),
    [accounts, allMoves, invoices, bills, taxes, budgets, analytic],
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createAccount") {
      createAccount.mutate(formData as unknown as CreateAccountAccountParams)
    } else if (action === "createMove") {
      createMove.mutate(formData as unknown as CreateAccountMoveParams)
    } else if (action === "createInvoice") {
      createMove.mutate({ ...formData, moveType: "out_invoice" } as unknown as CreateAccountMoveParams)
    } else if (action === "createBill") {
      createMove.mutate({ ...formData, moveType: "in_invoice" } as unknown as CreateAccountMoveParams)
    } else if (action === "createTax") {
      createTax.mutate(formData as unknown as CreateAccountTaxParams)
    } else if (action === "createBudget") {
      createBudget.mutate(formData as unknown as CreateCrossoveredBudgetParams)
    }
  }

  return (
    <ModuleView
      config={config}
      data={data}
      onFormSubmit={handleFormSubmit}
    />
  )
}
