"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  DashboardGrid,
  DashboardHeader,
  MissingOrganization,
  type TimeRangeValue,
  isTimestampInRange,
  percentChange,
  previousPeriodMs,
  timeRangeToMs,
} from "@lumiere/ui"
import { Skeleton } from "@lumiere/ui/components/skeleton"
import type { DashboardSection } from "@lumiere/ui"
import { overviewDashboard } from "@/lib/module-dashboard-configs"
import { useOverviewModuleSubscription } from "@/lib/module-subscription-hooks"
import { enumTag, moveTypeTagFromRow } from "@/lib/accounting-post-draft"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useSaleOrders } from "@lumiere/query-hooks/hooks/sales"
import { useAccountMoves } from "@lumiere/query-hooks/hooks/accounting"
import { useStockQuants, useProducts } from "@lumiere/query-hooks/hooks/inventory"
import { usePurchaseOrders } from "@lumiere/query-hooks/hooks/purchasing"
import { useTasks, useProjects } from "@lumiere/query-hooks/hooks/projects"
import { useContacts } from "@lumiere/query-hooks/hooks/crm"
import { useAiActionDraftInboxCount } from "@lumiere/query-hooks/hooks/ai-action-drafts"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"

interface OverviewClientProps {
  organizationId?: number
  initialOrders?: Record<string, unknown>[]
  initialMoves?: Record<string, unknown>[]
  initialStockQuants?: Record<string, unknown>[]
  initialProducts?: Record<string, unknown>[]
  initialTasks?: Record<string, unknown>[]
  initialProjects?: Record<string, unknown>[]
  initialPurchaseOrders?: Record<string, unknown>[]
  initialContacts?: Record<string, unknown>[]
}

function matchesCompany(row: Record<string, unknown>, companyId: number | null): boolean {
  if (companyId == null || companyId <= 0) return true
  return Number(row.companyId ?? row.company_id ?? 0) === companyId
}

function isOpenSaleOrder(row: Record<string, unknown>): boolean {
  const state = enumTag(row.state)
  return state !== "Done" && state !== "Cancelled"
}

function isConfirmedSaleOrder(row: Record<string, unknown>): boolean {
  const state = enumTag(row.state)
  return state === "Sale" || state === "Done"
}

function orderTimestampMs(row: Record<string, unknown>): number {
  const raw = row.dateOrder ?? row.createDate ?? row.writeDate
  if (raw == null) return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n > 1e15 ? n / 1000 : n
}

function lastSixMonthLabels(): string[] {
  const labels: string[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    labels.push(d.toLocaleDateString(undefined, { month: "short" }))
  }
  return labels
}

function monthBucketKey(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { month: "short" })
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
  initialOrders,
  initialMoves,
  initialStockQuants,
  initialProducts,
  initialTasks,
  initialProjects,
  initialPurchaseOrders,
  initialContacts,
}: OverviewClientProps & { organizationId: number }) {
  useOverviewModuleSubscription()
  const { t } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useOperatingCompanyId(organizationId)

  const { data: orders = [], isLoading: ordersLoading } = useSaleOrders(orgId, initialOrders)
  const { data: moves = [], isLoading: movesLoading } = useAccountMoves(orgId, { initialData: initialMoves })
  const { isLoading: stockQuantsLoading } = useStockQuants(orgId, initialStockQuants)
  const { isLoading: productsLoading } = useProducts(orgId, initialProducts)
  const { data: tasks = [], isLoading: tasksLoading } = useTasks(orgId, initialTasks)
  const { isLoading: projectsLoading } = useProjects(orgId, initialProjects)
  const { isLoading: purchaseOrdersLoading } = usePurchaseOrders(orgId, initialPurchaseOrders)
  const { data: contacts = [], isLoading: contactsLoading } = useContacts(orgId, initialContacts)
  const { count: pendingAiDrafts = 0, isLoading: aiDraftsLoading } = useAiActionDraftInboxCount(
    organizationId,
    operatingCompanyId != null && operatingCompanyId > 0,
  )
  const [timeRange, setTimeRange] = useState<TimeRangeValue>("30d")

  const { startMs, endMs } = useMemo(() => timeRangeToMs(timeRange), [timeRange])
  const previousRange = useMemo(() => previousPeriodMs(timeRange), [timeRange])

  const isDataReady = !(
    ordersLoading ||
    movesLoading ||
    stockQuantsLoading ||
    productsLoading ||
    tasksLoading ||
    projectsLoading ||
    purchaseOrdersLoading ||
    contactsLoading ||
    aiDraftsLoading
  )

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

  const periodMetrics = useMemo(() => {
    const currentRevenue = scopedOrders
      .filter((order) => {
        if (!isConfirmedSaleOrder(order as Record<string, unknown>)) return false
        const ms = orderTimestampMs(order as Record<string, unknown>)
        return isTimestampInRange(ms, startMs, endMs)
      })
      .reduce((sum, order) => sum + Number(order.amountTotal ?? 0), 0)

    const previousRevenue = scopedOrders
      .filter((order) => {
        if (!isConfirmedSaleOrder(order as Record<string, unknown>)) return false
        const ms = orderTimestampMs(order as Record<string, unknown>)
        return isTimestampInRange(ms, previousRange.startMs, previousRange.endMs)
      })
      .reduce((sum, order) => sum + Number(order.amountTotal ?? 0), 0)

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
      currentRevenue,
      revenueChange: percentChange(currentRevenue, previousRevenue),
      currentOpenOrders,
      openOrdersChange: percentChange(currentOpenOrders, previousOpenOrders),
    }
  }, [scopedOrders, startMs, endMs, previousRange])

  const salesTrendValues = useMemo(() => {
    const monthLabels = lastSixMonthLabels()
    const buckets = new Map<string, number>()
    for (const label of monthLabels) buckets.set(label, 0)
    for (const order of scopedOrders) {
      if (!isConfirmedSaleOrder(order as Record<string, unknown>)) continue
      const ms = orderTimestampMs(order as Record<string, unknown>)
      if (ms <= 0) continue
      const key = monthBucketKey(ms)
      if (!buckets.has(key)) continue
      buckets.set(key, (buckets.get(key) ?? 0) + Number(order.amountTotal ?? 0))
    }
    return monthLabels.map((month) => ({
      month,
      revenue: Math.round(buckets.get(month) ?? 0),
    }))
  }, [scopedOrders])

  const liveSections = useMemo(() => {
    const openTasks = scopedTasks.filter((task) => !task.isClosed).length
    const { currentRevenue, revenueChange, currentOpenOrders, openOrdersChange } = periodMetrics

    const invoices = scopedMoves.filter(
      (m) => moveTypeTagFromRow(m as Record<string, unknown>) === "OutInvoice",
    )
    const nowMs = Date.now()
    const overdueInvoices = invoices.filter((m) => {
      const residual = Number(m.amountResidual ?? 0)
      if (residual <= 0) return false
      if (m.invoiceDateDue == null) return true
      const dueMs = Number(m.invoiceDateDue) / 1000
      return dueMs < nowMs
    })
    const overdueInvoiceTotal = overdueInvoices.reduce(
      (sum, m) => sum + Number(m.amountResidual ?? 0),
      0,
    )

    const overdueTaskCount = scopedTasks.filter((task) => {
      if (task.isClosed) return false
      const deadlineMs = Number(task.dateDeadline ?? 0) / 1000
      return deadlineMs > 0 && deadlineMs < nowMs
    }).length

    const needsAttentionRows = [
      {
        reference: `${t("overview.dashboard.overdue")} Invoices`,
        amount: String(overdueInvoices.length),
        status: `$${Math.round(overdueInvoiceTotal).toLocaleString()}`,
      },
      {
        reference: t("overview.dashboard.stats.pendingAiDrafts"),
        amount: String(pendingAiDrafts),
        status: t("overview.dashboard.actions.aiDrafts"),
      },
      {
        reference: t("projects.dashboard.overdueTasks"),
        amount: String(overdueTaskCount),
        status: t("overview.dashboard.actions.projects"),
      },
    ]

    const baseConfig = overviewDashboard(t)

    return baseConfig.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                {
                  label: t("sales.dashboard.widgets.revenue"),
                  value: `$${Math.round(currentRevenue).toLocaleString()}`,
                  change: revenueChange,
                  icon: "BarChart2",
                  testId: "overview-stat-revenue",
                },
                {
                  label: t("overview.dashboard.stats.openSalesOrders"),
                  value: String(currentOpenOrders),
                  change: openOrdersChange,
                  icon: "ShoppingCart",
                  testId: "overview-stat-open-sales-orders",
                },
                {
                  label: t("overview.dashboard.stats.openTasks"),
                  value: String(openTasks),
                  icon: "CheckSquare",
                  testId: "overview-stat-open-tasks",
                },
                {
                  label: t("crm.contacts.title"),
                  value: String(scopedContacts.length),
                  icon: "Users",
                  testId: "overview-stat-contacts",
                },
              ],
            },
          }
        }
        if (w.id === "overview-sales-trend") {
          return {
            ...w,
            data: {
              ...(w.data as Record<string, unknown>),
              values: salesTrendValues,
            },
          }
        }
        if (w.id === "overview-needs-attention") {
          return {
            ...w,
            data: {
              ...(w.data as Record<string, unknown>),
              rows: needsAttentionRows,
            },
          }
        }
        return w
      }),
    })) as DashboardSection[]
  }, [scopedMoves, scopedTasks, scopedContacts, pendingAiDrafts, salesTrendValues, periodMetrics, t])

  return (
    <div className="space-y-6">
      <DashboardHeader
        title={t("overview.page.title")}
        description={t("overview.page.description")}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
      />
      {isDataReady ? (
        <DashboardGrid
          sections={liveSections}
          testId="overview-dashboard"
          widgetTestIdPrefix="overview-widget"
        />
      ) : (
        <OverviewDashboardSkeleton />
      )}
    </div>
  )
}
