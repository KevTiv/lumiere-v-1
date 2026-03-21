"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ModuleView, FormModal, newJournalEntryForm, newTaxForm } from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { accountingModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useAccountAccounts,
  useAccountMoves,
  useAccountTaxes,
  useBudgets,
  useAnalyticAccounts,
  useBankStatements,
  useFixedAssets,
  useCreateAccount,
  useCreateMove,
  useCreateTax,
  useCreateBudget,
} from "@lumiere/stdb"
import type {
  AccountMove,
  CreateAccountAccountParams,
  CreateAccountMoveParams,
  CreateAccountTaxParams,
  CreateCrossoveredBudgetParams,
} from "@lumiere/stdb"

import {
  InvoiceListView,
  InvoiceDetailModal,
  CreateInvoiceModal,
  BillsListView,
  ChartOfAccountsView,
  GeneralLedgerView,
} from "@lumiere/ui"

interface AccountingClientProps {
  initialAccounts?: Record<string, unknown>[]
  initialMoves?: Record<string, unknown>[]
  initialTaxes?: Record<string, unknown>[]
  initialBudgets?: Record<string, unknown>[]
  initialAnalytic?: Record<string, unknown>[]
  organizationId?: number
}

export function AccountingClient({
  initialAccounts,
  initialMoves,
  initialTaxes,
  initialBudgets,
  initialAnalytic,
  organizationId,
}: AccountingClientProps) {
  const { t } = useTranslation()
  const moduleConfig = useMemo(() => accountingModuleConfig(t), [t])
  const orgId = BigInt(organizationId ?? 1)
  const companyId = BigInt(organizationId ?? 1)

  // Quick-action form modal (dashboard tab)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  // Invoice detail modal
  const [selectedInvoice, setSelectedInvoice] = useState<AccountMove | null>(null)
  // Create invoice / bill modals
  const [showCreateInvoice, setShowCreateInvoice] = useState(false)
  const [showCreateBill, setShowCreateBill] = useState(false)

  // ── Data hooks ──────────────────────────────────────────────────────────────
  const { data: accounts = [] } = useAccountAccounts(companyId, initialAccounts)
  const { data: allMoves = [] } = useAccountMoves(companyId, undefined, initialMoves)
  const { data: taxes = [] } = useAccountTaxes(companyId, initialTaxes)
  const { data: budgets = [] } = useBudgets(companyId, initialBudgets)
  const { data: analytic = [] } = useAnalyticAccounts(companyId, initialAnalytic)
  const { data: bankStatements = [] } = useBankStatements(companyId)
  const { data: fixedAssets = [] } = useFixedAssets(companyId)

  // ── Mutations ───────────────────────────────────────────────────────────────
  const createAccount = useCreateAccount(orgId, companyId)
  const createMove = useCreateMove(orgId, companyId)
  const createTax = useCreateTax(orgId, companyId)
  const createBudget = useCreateBudget(orgId, companyId)

  // ── Derived data ────────────────────────────────────────────────────────────
  const invoices = useMemo(
    () => allMoves.filter((m) => String(m.moveType) === "OutInvoice"),
    [allMoves],
  )
  const bills = useMemo(
    () => allMoves.filter((m) => String(m.moveType) === "InInvoice"),
    [allMoves],
  )

  // ── Live KPIs for dashboard ─────────────────────────────────────────────────
  const liveSections = useMemo(() => {
    const ar = invoices.reduce((s, m) => s + Number(m.amountResidual ?? 0), 0)
    const ap = bills.reduce((s, m) => s + Number(m.amountResidual ?? 0), 0)
    const cash = accounts
      .filter((a) => a.isBankAccount)
      .reduce((s, a) => s + Number(a.openingBalance ?? 0), 0)
    const revenue = invoices
      .filter((m) => String(m.state) === "Posted")
      .reduce((s, m) => s + Number(m.amountTotal ?? 0), 0)

    const dashboardTab = moduleConfig.tabs.find((t) => t.id === "dashboard")
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
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            create_invoice: () => setShowCreateInvoice(true),
            create_bill: () => setShowCreateBill(true),
            journal_entry: () => setQuickActionForm({ form: newJournalEntryForm(t), action: "createMove" }),
            create_tax: () => setQuickActionForm({ form: newTaxForm(t), action: "createTax" }),
          }

          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        if (w.id === "acc-overdue") {
          const overdueInvoices = invoices.filter((m) => Number(m.amountResidual ?? 0) > 0)
          const totalAmount = overdueInvoices.reduce((s, m) => s + Number(m.amountResidual ?? 0), 0)
          const nowMs = Date.now()
          const oldestDays = overdueInvoices.reduce((max, m) => {
            if (!m.invoiceDateDue) return max
            const dueMs = Number(m.invoiceDateDue) / 1000
            const days = Math.max(0, Math.round((nowMs - dueMs) / 86400000))
            return Math.max(max, days)
          }, 0)
          return { ...w, data: { count: overdueInvoices.length, totalAmount, oldestDays } }
        }
        if (w.id === "acc-budget") {
          const budgetRows = budgets.slice(0, 5).map((b) => ({
            name: String(b.name ?? ""),
            planned: Number(b.totalPlanned ?? 0),
            actual: Number(b.totalPractical ?? 0),
            variance: Number(b.variancePercentage ?? 0),
          }))
          return { ...w, data: { budgets: budgetRows } }
        }
        if (w.id === "acc-balances") {
          const accountRows = accounts.slice(0, 5).map((a) => ({
            code: String(a.code ?? ""),
            name: String(a.name ?? ""),
            balance: Number(a.openingBalance ?? 0),
            type: String(a.internalGroup ?? "Asset"),
          }))
          return { ...w, data: { accounts: accountRows } }
        }
        return w
      }),
    }))
  }, [accounts, invoices, bills, budgets, moduleConfig, t])

  // ── Form submit handler (entity tabs: taxes, budgets) ───────────────────────
  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createAccount") {
      createAccount.mutate(formData as unknown as CreateAccountAccountParams)
    } else if (action === "createMove") {
      createMove.mutate(formData as unknown as CreateAccountMoveParams)
    } else if (action === "createTax") {
      createTax.mutate(formData as unknown as CreateAccountTaxParams)
    } else if (action === "createBudget") {
      createBudget.mutate(formData as unknown as CreateCrossoveredBudgetParams)
    }
  }

  // ── Config: inject rich custom content for invoices/bills/accounts/ledger ───
  const config = useMemo(
    () => ({
      ...moduleConfig,
      tabs: moduleConfig.tabs.map((tab) => {
        if (tab.id === "dashboard") {
          return { ...tab, sections: liveSections }
        }
        if (tab.id === "invoices") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <InvoiceListView
                invoices={invoices}
                onSelectInvoice={(invoice) => setSelectedInvoice(invoice as unknown as AccountMove)}
                onCreateInvoice={() => setShowCreateInvoice(true)}
              />
            ),
          }
        }
        if (tab.id === "bills") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <BillsListView
                bills={bills}
                onCreateBill={() => setShowCreateBill(true)}
              />
            ),
          }
        }
        if (tab.id === "accounts") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <ChartOfAccountsView
                accounts={accounts}
                onCreate={(data) => createAccount.mutate(data as unknown as CreateAccountAccountParams)}
              />
            ),
          }
        }
        if (tab.id === "journal-entries") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <GeneralLedgerView
                moves={allMoves}
                onCreate={() => setQuickActionForm({ form: newJournalEntryForm(t), action: "createMove" })}
              />
            ),
          }
        }
        return tab
      }),
    }) as ModuleConfig,
    [liveSections, invoices, bills, accounts, allMoves, createAccount.mutate, t, moduleConfig],
  )

  // Entity tab data (taxes, budgets, analytic, etc. — non-rich tabs)
  const data = useMemo(
    () => ({
      taxes: taxes as unknown as Record<string, unknown>[],
      budgets: budgets as unknown as Record<string, unknown>[],
      analytic: analytic as unknown as Record<string, unknown>[],
      "bank-statements": bankStatements as unknown as Record<string, unknown>[],
      "fixed-assets": fixedAssets as unknown as Record<string, unknown>[],
    }),
    [taxes, budgets, analytic, bankStatements, fixedAssets],
  )

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
      />

      {/* Invoice detail */}
      <InvoiceDetailModal
        invoice={selectedInvoice}
        open={!!selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
      />

      {/* Create invoice */}
      <CreateInvoiceModal
        open={showCreateInvoice}
        onClose={() => setShowCreateInvoice(false)}
        onSave={(params) => {
          createMove.mutate({
            ...params,
            moveType: "OutInvoice",
          } as unknown as CreateAccountMoveParams)
        }}
      />

      {/* Create bill (same form, different move type) */}
      <CreateInvoiceModal
        open={showCreateBill}
        onClose={() => setShowCreateBill(false)}
        onSave={(params) => {
          createMove.mutate({
            ...params,
            moveType: "InInvoice",
          } as unknown as CreateAccountMoveParams)
        }}
      />

      {/* Dashboard quick-action form modal */}
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? newJournalEntryForm(t)}
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
