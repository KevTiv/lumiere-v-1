"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@lumiere/i18n"
import { DashboardGrid, DashboardHeader, MissingOrganization } from "@lumiere/ui"
import type { DashboardSection } from "@lumiere/ui"
import { overviewDashboard } from "@/lib/module-dashboard-configs"
import { enumTag, moveTypeTagFromRow } from "@/lib/accounting-post-draft"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useSaleOrders } from "@lumiere/query-hooks/hooks/sales"
import { useAccountMoves } from "@lumiere/query-hooks/hooks/accounting"
import { useStockQuants, useProducts } from "@lumiere/query-hooks/hooks/inventory"
import { usePurchaseOrders } from "@lumiere/query-hooks/hooks/purchasing"
import { useTasks, useProjects } from "@lumiere/query-hooks/hooks/projects"
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
}

function matchesCompany(row: Record<string, unknown>, companyId: number | null): boolean {
  if (companyId == null || companyId <= 0) return true
  return Number(row.companyId ?? row.company_id ?? 0) === companyId
}

function taskStateLabel(task: Record<string, unknown>): string {
  const tag = enumTag(task.state)
  if (tag) return tag.replace(/([A-Z])/g, " $1").trim()
  return String(task.kanbanState ?? "Open")
}

function isOpenSaleOrder(row: Record<string, unknown>): boolean {
  const state = enumTag(row.state)
  return state !== "Done" && state !== "Cancelled"
}

function isOpenPurchaseOrder(row: Record<string, unknown>): boolean {
  const state = enumTag(row.state)
  return state !== "Done" && state !== "Cancelled" && state !== "Cancel"
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
}: OverviewClientProps & { organizationId: number }) {
  const { t } = useTranslation()
  const router = useRouter()
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useOperatingCompanyId(organizationId)

  const { data: orders = [] } = useSaleOrders(orgId, initialOrders)
  const { data: moves = [] } = useAccountMoves(orgId, { initialData: initialMoves })
  const { data: stockQuants = [] } = useStockQuants(orgId, initialStockQuants)
  const { data: products = [] } = useProducts(orgId, initialProducts)
  const { data: tasks = [] } = useTasks(orgId, initialTasks)
  const { data: projects = [] } = useProjects(orgId, initialProjects)
  const { data: purchaseOrders = [] } = usePurchaseOrders(orgId, initialPurchaseOrders)
  const { count: pendingAiDrafts = 0 } = useAiActionDraftInboxCount(
    organizationId,
    operatingCompanyId != null && operatingCompanyId > 0,
  )

  const scopedOrders = useMemo(
    () => orders.filter((row) => matchesCompany(row as Record<string, unknown>, operatingCompanyId)),
    [orders, operatingCompanyId],
  )
  const scopedMoves = useMemo(
    () => moves.filter((row) => matchesCompany(row as Record<string, unknown>, operatingCompanyId)),
    [moves, operatingCompanyId],
  )
  const scopedQuants = useMemo(
    () => stockQuants.filter((row) => matchesCompany(row as Record<string, unknown>, operatingCompanyId)),
    [stockQuants, operatingCompanyId],
  )
  const scopedTasks = useMemo(
    () => tasks.filter((row) => matchesCompany(row as Record<string, unknown>, operatingCompanyId)),
    [tasks, operatingCompanyId],
  )
  const scopedPurchaseOrders = useMemo(
    () =>
      purchaseOrders.filter((row) =>
        matchesCompany(row as Record<string, unknown>, operatingCompanyId),
      ),
    [purchaseOrders, operatingCompanyId],
  )

  const liveSections = useMemo(() => {
    const openSalesOrders = scopedOrders.filter(isOpenSaleOrder).length

    const invoices = scopedMoves.filter(
      (m) => moveTypeTagFromRow(m as Record<string, unknown>) === "OutInvoice",
    )
    const bills = scopedMoves.filter(
      (m) => moveTypeTagFromRow(m as Record<string, unknown>) === "InInvoice",
    )
    const ar = invoices.reduce((s, m) => s + Number(m.amountResidual ?? 0), 0)
    const ap = bills.reduce((s, m) => s + Number(m.amountResidual ?? 0), 0)

    const lowStockCount = scopedQuants.filter((q) => Number(q.availableQuantity ?? 0) <= 0).length
    const openTasks = scopedTasks.filter((task) => !task.isClosed).length

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
                  label: t("overview.dashboard.stats.openSalesOrders"),
                  value: String(openSalesOrders),
                  icon: "ShoppingCart",
                },
                {
                  label: t("overview.dashboard.stats.accountsReceivable"),
                  value: `$${Math.round(ar).toLocaleString()}`,
                  icon: "TrendingUp",
                },
                {
                  label: t("overview.dashboard.stats.accountsPayable"),
                  value: `$${Math.round(ap).toLocaleString()}`,
                  icon: "TrendingDown",
                },
                {
                  label: t("overview.dashboard.stats.lowStockAlerts"),
                  value: String(lowStockCount),
                  icon: "AlertTriangle",
                },
                {
                  label: t("overview.dashboard.stats.openTasks"),
                  value: String(openTasks),
                  icon: "CheckSquare",
                },
                {
                  label: t("overview.dashboard.stats.pendingAiDrafts"),
                  value: String(pendingAiDrafts),
                  icon: "Bell",
                },
              ],
            },
          }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            sales: () => router.push("/sales"),
            inventory: () => router.push("/inventory"),
            ai_drafts: () => router.push("/ai-action-drafts"),
            projects: () => router.push("/projects"),
          }
          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        if (w.id === "overview-upcoming-tasks") {
          const nowMs = Date.now()
          const rows = scopedTasks
            .filter((task) => !task.isClosed && task.dateDeadline != null)
            .sort((a, b) => Number(a.dateDeadline ?? 0) - Number(b.dateDeadline ?? 0))
            .slice(0, 6)
            .map((task) => {
              const deadlineMs = Number(task.dateDeadline ?? 0) / 1000
              const project = projects.find((p) => p.id === task.projectId)
              return {
                task: String(task.name ?? ""),
                project: String(project?.name ?? "—"),
                due: new Date(deadlineMs).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                }),
                status: taskStateLabel(task as Record<string, unknown>),
                overdue: deadlineMs < nowMs,
              }
            })
          return { ...w, data: { ...(w.data as Record<string, unknown>), rows } }
        }
        if (w.id === "overview-low-stock") {
          const rows = scopedQuants
            .filter((q) => Number(q.availableQuantity ?? 0) <= 0)
            .slice(0, 6)
            .map((q) => {
              const product = products.find((p) => p.id === q.productId)
              return {
                sku: String(product?.defaultCode ?? `SKU-${String(q.productId).slice(-4)}`),
                name: String(product?.name ?? t("inventory.dashboard.productFallback", { id: String(q.productId).slice(-4) })),
                qty: Math.round(Number(q.availableQuantity ?? 0)),
              }
            })
          return { ...w, data: { ...(w.data as Record<string, unknown>), rows } }
        }
        if (w.id === "overview-open-pos") {
          const rows = scopedPurchaseOrders
            .filter(isOpenPurchaseOrder)
            .slice(0, 8)
            .map((po) => ({
              reference: String(po.name ?? po.origin ?? `#${po.id}`),
              vendor: String(po.partnerId ?? "—"),
              amount: `$${Math.round(Number(po.amountTotal ?? 0)).toLocaleString()}`,
              status: enumTag(po.state) || "Open",
            }))
          return { ...w, data: { ...(w.data as Record<string, unknown>), rows } }
        }
        return w
      }),
    })) as DashboardSection[]
  }, [
    scopedOrders,
    scopedMoves,
    scopedQuants,
    scopedTasks,
    scopedPurchaseOrders,
    projects,
    products,
    pendingAiDrafts,
    t,
    router,
  ])

  return (
    <div className="space-y-6">
      <DashboardHeader title={t("overview.page.title")} description={t("overview.page.description")} />
      <DashboardGrid sections={liveSections} />
    </div>
  )
}
