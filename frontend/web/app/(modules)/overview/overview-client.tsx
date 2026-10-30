"use client"

import { useMemo, useState, useRef, useCallback, useEffect } from "react"
import { useWorkspaceProfile } from "@lumiere/ui/lib/workspace-profile-context"
import { isWorkspaceSurfaceVisible } from "@lumiere/ui/lib/workspace-profile"
import { useRouter } from "next/navigation"
import { useTranslation } from "@lumiere/i18n"
import {
  DashboardGrid,
  DashboardHeader,
  MissingOrganization,
  exportDashboardToPng,
  type TimeRangeValue,
  isTimestampInRange,
  percentChange,
  previousPeriodMs,
  timeRangeToMs,
} from "@lumiere/ui"
import { Skeleton } from "@lumiere/ui/components/skeleton"
import { toDashboardSections, overviewDashboardWebOptions } from "@lumiere/ui/lib/presentation-dashboard"
import { overviewDashboardDefinition, type DashboardDefinition, type OverviewDashboardData } from "@lumiere/presentation-core"
import { useOverviewModuleSubscription } from "@/lib/module-subscription-hooks"
import { enumTag } from "@/lib/accounting-post-draft"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useSaleOrders, type SaleOrder } from "@lumiere/query-hooks/hooks/sales"
import { useAccountMoves } from "@lumiere/query-hooks/hooks/accounting"
import { usePaymentReconciliations, usePaymentTransactions } from "@lumiere/query-hooks/hooks/accounting"
import { useStockQuants, useProducts } from "@lumiere/query-hooks/hooks/inventory"
import { usePurchaseOrders, type PurchaseOrder } from "@lumiere/query-hooks/hooks/purchasing"
import { useTasks, useProjects, type ProjectTask, type ProjectProject } from "@lumiere/query-hooks/hooks/projects"
import { useContacts, type Contact } from "@lumiere/query-hooks/hooks/crm"
import { useAiActionDraftInboxCount } from "@lumiere/query-hooks/hooks/ai-action-drafts"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useExpenseSheetsToApprove } from "@lumiere/query-hooks/hooks/expenses"
import { useMessageBatches } from "@lumiere/query-hooks/hooks/messages"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import { currencyCodeMap } from "@lumiere/ui/lib/kpi-tiles"
import { OwnerControlLoop } from "./owner-control-loop"
import { useProductivitySections } from "@/lib/use-productivity-sections"
import { DailyWorkWorkspace } from "../../../components/daily-work-workspace"
import { overviewResourceStatus, resourceStatusLabel, combinedResourceStatus, type OverviewInitialStates } from "./resource-state"
import type { StockQuant, Product } from "@lumiere/stdb/types"
import { confirmedOrder, confirmedOrderTrend, orderDate, overduePostedInvoices, overviewFinancialInputsComplete, overviewMoneySummary } from "./financial-summary"

interface OverviewClientProps {
  organizationId?: number
  initialResourceStates?: OverviewInitialStates
  initialOrders?: SaleOrder[]
  initialStockQuants?: StockQuant[]
  initialProducts?: Product[]
  initialTasks?: ProjectTask[]
  initialProjects?: ProjectProject[]
  initialPurchaseOrders?: PurchaseOrder[]
  initialContacts?: Contact[]
}

function matchesCompany(row: Record<string, unknown>, companyId: number | null): boolean {
  if (companyId == null || companyId <= 0) return false
  return String(row.companyId ?? row.company_id ?? "") === String(companyId)
}

function isOpenSaleOrder(row: Record<string, unknown>): boolean {
  const state = enumTag(row.state).toLowerCase()
  return state !== "" && !["done", "cancel", "cancelled"].includes(state)
}

function orderTimestampMs(row: Record<string, unknown>): number {
  return orderDate(row)?.getTime() ?? 0
}

function OverviewDashboardSkeleton() {
  return (
    <div className="space-y-10" data-testid="overview-dashboard-skeleton">
      <section className="space-y-4">
        <Skeleton className="h-4 w-28" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
      </section>
      <section className="space-y-4">
        <Skeleton className="h-[340px] w-full rounded-xl" />
      </section>
      <section className="space-y-4">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </section>
    </div>
  )
}

export function OverviewClient(props: OverviewClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <OverviewClientLoaded {...props} organizationId={props.organizationId} />
}

function OverviewClientLoaded({
  organizationId,
  initialResourceStates,
  initialOrders,
  initialStockQuants,
  initialProducts,
  initialTasks,
  initialProjects,
  initialPurchaseOrders,
  initialContacts,
}: OverviewClientProps & { organizationId: number }) {
  useOverviewModuleSubscription()
  const { t, i18n } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useOperatingCompanyId(organizationId)

  const ordersQuery = useSaleOrders(orgId, initialOrders)
  const movesQuery = useAccountMoves(orgId)
  const stockQuantsQuery = useStockQuants(orgId, initialStockQuants)
  const productsQuery = useProducts(orgId, initialProducts)
  const tasksQuery = useTasks(orgId, initialTasks)
  const projectsQuery = useProjects(orgId, initialProjects)
  const purchaseOrdersQuery = usePurchaseOrders(orgId, initialPurchaseOrders)
  const contactsQuery = useContacts(orgId, initialContacts)
  const paymentTransactionsQuery = usePaymentTransactions(orgId)
  const paymentReconciliationsQuery = usePaymentReconciliations(orgId)
  const messageBatchesQuery = useMessageBatches(orgId)
  const currenciesQuery = useCurrencies()
  const currencyCodes = useMemo(() => currencyCodeMap(currenciesQuery.data ?? []), [currenciesQuery.data])
  const expenseApprovalsQuery = useExpenseSheetsToApprove(orgId)
  const aiDraftsQuery = useAiActionDraftInboxCount(
    organizationId,
    operatingCompanyId != null && operatingCompanyId > 0,
  )
  // Arrays are calculation inputs only; canonical statuses gate every displayed value.
  const orders = ordersQuery.data ?? []
  const moves = movesQuery.data ?? []
  const stockQuants = stockQuantsQuery.data ?? []
  const products = productsQuery.data ?? []
  const tasks = tasksQuery.data ?? []
  const contacts = contactsQuery.data ?? []
  const paymentTransactions = paymentTransactionsQuery.data ?? []
  const paymentReconciliations = paymentReconciliationsQuery.data ?? []
  const messageBatches = messageBatchesQuery.data ?? []
  const pendingAiDrafts = aiDraftsQuery.count
  const resourceStates = {
    "sale-orders": overviewResourceStatus(ordersQuery, initialResourceStates?.["sale-orders"]),
    "account-moves": overviewResourceStatus(movesQuery),
    "stock-quants": overviewResourceStatus(stockQuantsQuery, initialResourceStates?.["stock-quants"]),
    products: overviewResourceStatus(productsQuery, initialResourceStates?.products),
    tasks: overviewResourceStatus(tasksQuery, initialResourceStates?.tasks),
    projects: overviewResourceStatus(projectsQuery, initialResourceStates?.projects),
    "purchase-orders": overviewResourceStatus(purchaseOrdersQuery, initialResourceStates?.["purchase-orders"]),
    contacts: overviewResourceStatus(contactsQuery, initialResourceStates?.contacts),
    "payment-transactions": overviewResourceStatus(paymentTransactionsQuery),
    "payment-reconciliations": overviewResourceStatus(paymentReconciliationsQuery),
    "message-batches": overviewResourceStatus(messageBatchesQuery),
    "ai-action-drafts": overviewResourceStatus(aiDraftsQuery),
    currencies: overviewResourceStatus(currenciesQuery),
  }
  const companyState = operatingCompanyId != null && operatingCompanyId > 0 ? undefined
    : t("overview.financial.selectCompany", { defaultValue: "Select an operating company" })
  const salesState = companyState ?? resourceStatusLabel(resourceStates["sale-orders"])
  const tasksState = companyState ?? resourceStatusLabel(resourceStates.tasks)
  const contactsState = companyState ?? resourceStatusLabel(resourceStates.contacts)
  const movesState = companyState ?? resourceStatusLabel(resourceStates["account-moves"])
  const currencyState = resourceStatusLabel(resourceStates.currencies)
  const aiState = resourceStatusLabel(resourceStates["ai-action-drafts"])
  const paymentsState = companyState ?? resourceStatusLabel(combinedResourceStatus(resourceStates["payment-transactions"], resourceStates["payment-reconciliations"]))
  const stockState = companyState ?? resourceStatusLabel(combinedResourceStatus(resourceStates["stock-quants"], resourceStates.products))
  const messagesState = companyState ?? resourceStatusLabel(resourceStates["message-batches"])
  const [timeRange, setTimeRange] = useState<TimeRangeValue>("30d")
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  const { startMs, endMs } = useMemo(() => timeRangeToMs(timeRange), [timeRange])
  const previousRange = useMemo(() => previousPeriodMs(timeRange), [timeRange])

  const scopedOrders = useMemo(
    () => orders.filter((row) => matchesCompany(row as Record<string, unknown>, operatingCompanyId)),
    [orders, operatingCompanyId],
  )
  const scopedMoves = useMemo(
    () => moves.filter((row) => matchesCompany(row as Record<string, unknown>, operatingCompanyId)),
    [moves, operatingCompanyId],
  )
  const scopedTasks = useMemo(
    () => tasks.filter((row) => matchesCompany(row as Record<string, unknown>, operatingCompanyId)),
    [tasks, operatingCompanyId],
  )
  const scopedContacts = useMemo(
    () => contacts.filter((row) => matchesCompany(row as Record<string, unknown>, operatingCompanyId)),
    [contacts, operatingCompanyId],
  )
  const ordersComplete = overviewFinancialInputsComplete(scopedOrders, "orders")
  const invoicesComplete = overviewFinancialInputsComplete(scopedMoves, "invoices")
  const incompleteFinancialData = t("overview.financial.incompleteSource", { defaultValue: "Required financial fields unavailable" })

  const periodMetrics = useMemo(() => {
    const currentOrders = scopedOrders
      .filter((order) => {
        if (!confirmedOrder(order)) return false
        const ms = orderTimestampMs(order as Record<string, unknown>)
        return isTimestampInRange(ms, startMs, endMs)
      })

    const currentOpenOrders = scopedOrders.filter((order) => {
      if (!isOpenSaleOrder(order as Record<string, unknown>)) return false
      const ms = orderTimestampMs(order as Record<string, unknown>)
      return isTimestampInRange(ms, startMs, endMs)
    }).length

    const previousOpenOrders = scopedOrders.filter((order) => {
      if (!isOpenSaleOrder(order as Record<string, unknown>)) return false
      const ms = orderTimestampMs(order as Record<string, unknown>)
      return isTimestampInRange(ms, previousRange.startMs, previousRange.endMs)
    }).length

    return {
      currentOrders,
      currentOpenOrders,
      openOrdersChange: percentChange(currentOpenOrders, previousOpenOrders),
    }
  }, [scopedOrders, startMs, endMs, previousRange])

  const salesTrendValues = useMemo(() => confirmedOrderTrend(scopedOrders, new Date(), i18n.language), [scopedOrders, i18n.language])

  const liveSections = useMemo(() => {
    const openTasks = scopedTasks.filter((task) => !task.isClosed).length
    const { currentOrders, currentOpenOrders, openOrdersChange } = periodMetrics
    const nowMs = Date.now()
    const overdueInvoices = overduePostedInvoices(scopedMoves)
    const unavailableMoney = t("overview.financial.incompleteMoney", { defaultValue: "Amount or currency unavailable" })
    const orderTotal = overviewMoneySummary(currentOrders, currencyCodes, "amountTotal", i18n.language)
    const overdueTotal = overviewMoneySummary(overdueInvoices, currencyCodes, "amountResidual", i18n.language)

    const overdueTaskCount = scopedTasks.filter((task) => {
      if (task.isClosed) return false
      const deadlineMs = Number(task.dateDeadline ?? 0) / 1000
      return deadlineMs > 0 && deadlineMs < nowMs
    }).length

    const needsAttentionRows = [
      {
        reference: `${t("overview.dashboard.overdue")} Invoices`,
        amount: movesState ?? (!invoicesComplete ? incompleteFinancialData : String(overdueInvoices.length)),
        status: movesState ?? currencyState ?? (!invoicesComplete ? incompleteFinancialData : overdueTotal == null ? unavailableMoney : overdueTotal || t("overview.financial.noOverdueBalance", { defaultValue: "No known overdue balance" })),
      },
      {
        reference: t("overview.dashboard.stats.pendingAiDrafts"),
        amount: aiState ?? String(pendingAiDrafts),
        status: t("overview.dashboard.actions.aiDrafts"),
      },
      {
        reference: t("projects.dashboard.overdueTasks"),
        amount: tasksState ?? String(overdueTaskCount),
        status: t("overview.dashboard.actions.projects"),
      },
    ]

    const data: OverviewDashboardData = {
      metrics: {
        revenue: {
          value: salesState ?? currencyState ?? (!ordersComplete ? incompleteFinancialData : orderTotal == null ? unavailableMoney : orderTotal || t("overview.financial.noConfirmedOrders", { defaultValue: "No confirmed orders" })),
        },
        "open-sales-orders": { value: salesState ?? (!ordersComplete ? incompleteFinancialData : String(currentOpenOrders)), change: salesState || !ordersComplete ? undefined : openOrdersChange },
        "open-tasks": { value: tasksState ?? String(openTasks) },
        contacts: { value: contactsState ?? String(scopedContacts.length) },
      },
      series: {
        revenue: salesTrendValues,
      },
      tables: { "needs-attention": needsAttentionRows },
    }
    // The shared presentation binding is retained; visible labels describe order values/counts.
    const definition: DashboardDefinition = { ...overviewDashboardDefinition,
      sections: overviewDashboardDefinition.sections
        .filter((section) => !(salesState || !ordersComplete) || section.id !== "overview-revenue")
        .map((section) => section.id === "overview-revenue" ? { ...section, widgets: [{ ...section.widgets[0],
          series: [{ id: t("overview.financial.orders", { defaultValue: "Confirmed orders" }), binding: "revenue" }],
        }] } : section),
    }
    return toDashboardSections(definition, data, (key) => key === "sales.dashboard.widgets.revenue"
      ? t("overview.financial.confirmedOrderValue", { defaultValue: "Confirmed order value · by currency" })
      : key === "overview.dashboard.widgets.salesTrend"
        ? t("overview.financial.confirmedOrderTrend", { defaultValue: "Confirmed orders · last six months" }) : t(key), overviewDashboardWebOptions)
  }, [scopedMoves, scopedTasks, scopedContacts, pendingAiDrafts, salesTrendValues, periodMetrics, salesState, tasksState, contactsState, movesState, aiState, currencyState, currencyCodes, i18n.language, ordersComplete, invoicesComplete, incompleteFinancialData, t])

  const ownerControlLoop = useMemo(() => {
    const reconciledTransactionIds = new Set(paymentReconciliations.map((row) => String((row as Record<string, unknown>).paymentTransactionId ?? "")))
    const unreconciledPayments = paymentTransactions.filter((row) => {
      const payment = row as Record<string, unknown>
      return matchesCompany(payment, operatingCompanyId) && enumTag(payment.status) === "Posted" && !reconciledTransactionIds.has(String(payment.id))
    }).length
    const productByTemplate = new Map(products.map((row) => [String((row as Record<string, unknown>).productTmplId ?? (row as Record<string, unknown>).id ?? ""), row as Record<string, unknown>]))
    const lowStockProducts = stockQuants.filter((row) => {
      const quant = row as Record<string, unknown>
      if (!matchesCompany(quant, operatingCompanyId)) return false
      const product = productByTemplate.get(String(quant.productId ?? ""))
      return Number(quant.availableQuantity ?? 0) <= Number(product?.reorderingMinQty ?? 0) || Boolean(quant.isOutdated)
    }).length
    const pendingMessageApprovals = messageBatches.filter((row) => matchesCompany(row as Record<string, unknown>, operatingCompanyId) && enumTag((row as Record<string, unknown>).status) === "PendingApproval").length
    const overdueInvoices = invoicesComplete ? overduePostedInvoices(scopedMoves).length : incompleteFinancialData
    const draftBills = scopedMoves.filter((row) => enumTag(row.moveType) === "InInvoice" && enumTag(row.state) === "Draft").length
    return { overdueInvoices, unreconciledPayments, lowStockProducts, pendingMessageApprovals, draftBills }
  }, [messageBatches, operatingCompanyId, paymentReconciliations, paymentTransactions, products, scopedMoves, stockQuants, invoicesComplete, incompleteFinancialData])

  const router = useRouter()
  const workspaceProfile = useWorkspaceProfile()
  const myWorkActions = useMemo(
    () => [
      { id: "new-task", label: t("workspace.actions.openMyWork", { defaultValue: "Open my work" }), icon: "plus", color: "blue" as const, onClick: () => router.push("/tasks") },
      { id: "upload", label: t("workspace.actions.upload"), icon: "upload", color: "green" as const, onClick: () => router.push("/documents?tab=documents") },
      ...(isWorkspaceSurfaceVisible(workspaceProfile, "projects") ? [{ id: "log-time", label: t("workspace.actions.logTime"), icon: "refresh", color: "orange" as const, onClick: () => router.push("/projects?tab=timesheets") }] : []),
      { id: "new-event", label: t("workspace.actions.newEvent"), icon: "calendar", color: "purple" as const, onClick: () => router.push("/calendar?tab=calendar&create=event") },
    ],
    [t, router, workspaceProfile],
  )
  const myWorkSections = useProductivitySections({
    organizationId: orgId,
    tasks,
    projects: projectsQuery.data ?? [],
    quickActions: myWorkActions,
    idPrefix: "overview-work",
    workspaceProfile,
  })
  const dashboardGridRef = useRef<HTMLDivElement>(null)
  const handleDashboardExport = useCallback(async () => {
    if (!dashboardGridRef.current) return
    await exportDashboardToPng(dashboardGridRef.current, "overview-dashboard")
  }, [])

  return (
    <div className="space-y-6">
      <DashboardHeader
        title={t(overviewDashboardDefinition.titleKey)}
        description={t(overviewDashboardDefinition.descriptionKey)}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        onExport={() => void handleDashboardExport()}
      />
      <p className="text-sm text-muted-foreground">{t("overview.financial.meaning", { defaultValue: "Confirmed order values are shown separately by transaction currency; they are not accounting revenue. Overdue invoices are posted customer invoices with an unpaid balance and a known due date before today." })}</p>
      {isHydrated ? (
        <div className="flex flex-col gap-6">
          <section aria-label="Dashboard resource status" data-testid="overview-resource-status" className="space-y-1 text-sm">
            {Object.entries(resourceStates).flatMap(([resource, state]) => {
              const label = resourceStatusLabel(state)
              return label ? [<p key={resource} data-resource={resource} data-state={state}>{resource}: {label}</p>] : []
            })}
          </section>
          <OwnerControlLoop
            companyReady={operatingCompanyId != null && operatingCompanyId > 0}
            draftBills={movesState ?? ownerControlLoop.draftBills}
            expenseApprovals={resourceStatusLabel(overviewResourceStatus(expenseApprovalsQuery))
              ?? ((expenseApprovalsQuery.data ?? []).some((row) => !(Number(row.companyId ?? row.company_id) > 0))
                ? "Scope unavailable"
                : (expenseApprovalsQuery.data ?? []).filter((row) => matchesCompany(row, operatingCompanyId)).length)}
            overdueInvoices={movesState ?? ownerControlLoop.overdueInvoices}
            unreconciledPayments={paymentsState ?? ownerControlLoop.unreconciledPayments}
            lowStockProducts={stockState ?? ownerControlLoop.lowStockProducts}
            pendingMessageApprovals={messagesState ?? ownerControlLoop.pendingMessageApprovals}
          />
          {workspaceProfile === "finance-alpha" && <DailyWorkWorkspace organizationId={organizationId} summary />}
          <DashboardGrid sections={myWorkSections} testId="overview-my-work" widgetTestIdPrefix="overview-widget" />
          {salesState ? <p data-testid="overview-sales-trend-state">Sales trend: {salesState}</p> : null}
          <DashboardGrid
            ref={dashboardGridRef}
            sections={liveSections}
            testId="overview-dashboard"
            widgetTestIdPrefix="overview-widget"
          />
        </div>
      ) : (
        <OverviewDashboardSkeleton />
      )}
    </div>
  )
}
