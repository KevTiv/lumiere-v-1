"use client"

import { useWorkspaceProfile } from "@lumiere/ui/lib/workspace-profile-context"
import { isWorkspaceHrefVisible } from "@lumiere/ui/lib/workspace-profile"
import { useTranslation } from "@lumiere/i18n"
import { useRBAC } from "@/lib/rbac-context"
import type { Resource } from "@lumiere/ui/lib/rbac-types"
import Link from "next/link"
import { AlertTriangleIcon, ArrowRightIcon, BellRingIcon, CircleDollarSignIcon, PackageSearchIcon } from "lucide-react"

import { Badge } from "@lumiere/ui/components/badge"
import { buttonVariants } from "@lumiere/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lumiere/ui/components/card"

interface OwnerControlLoopProps {
  overdueInvoices: number | string
  unreconciledPayments: number | string
  lowStockProducts: number | string
  pendingMessageApprovals: number | string
  draftBills?: number | string
  expenseApprovals?: number | string
  companyReady?: boolean
}

const CONTROL_ITEMS: Array<{
  key: "overdueInvoices" | "unreconciledPayments" | "lowStockProducts" | "pendingMessageApprovals" | "draftBills" | "expenseApprovals"
  resource: Resource
  href: string
  icon: typeof CircleDollarSignIcon
}> = [
  { key: "overdueInvoices", resource: "account_move", href: "/accounting?tab=invoices", icon: CircleDollarSignIcon },
  { key: "unreconciledPayments", resource: "account_move", href: "/accounting?tab=payment-operations", icon: AlertTriangleIcon },
  { key: "lowStockProducts", resource: "module:inventory", href: "/inventory", icon: PackageSearchIcon },
  { key: "pendingMessageApprovals", resource: "module:messages", href: "/messages", icon: BellRingIcon },
  { key: "draftBills", resource: "account_move", href: "/accounting?tab=bills", icon: CircleDollarSignIcon },
  { key: "expenseApprovals", resource: "hr_expense_sheet", href: "/expenses?tab=expense-sheets&filter=state%3ASubmitted", icon: AlertTriangleIcon },
]

export function OwnerControlLoop(props: OwnerControlLoopProps) {
  const { t } = useTranslation()
  const { checkPermission } = useRBAC()
  const workspaceProfile = useWorkspaceProfile()
  const countFor = (key: (typeof CONTROL_ITEMS)[number]["key"]) => props.companyReady === false
    ? t("financeReview.selectCompany", { defaultValue: "Select a company" }) : props[key]
  const priority = (item: (typeof CONTROL_ITEMS)[number]) => {
    const value = countFor(item.key)
    return typeof value === "number" ? (value > 0 ? 2 : 0) : 1
  }
  const visibleItems = CONTROL_ITEMS.filter((item) => props[item.key] != null
    && isWorkspaceHrefVisible(workspaceProfile, item.href) && checkPermission(item.resource, "read").allowed)
    .sort((a, b) => priority(b) - priority(a))
  const values = visibleItems.map((item) => countFor(item.key))
  const hasIncompleteReads = values.some((value) => typeof value !== "number")
  const attentionCount = values.filter((value) => typeof value === "number" && value > 0).length

  return (
    <Card data-testid="owner-control-loop">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("financeReview.queueTitle", { defaultValue: "Finance work queue" })}</CardTitle>
            <CardDescription>{t("financeReview.queueScope", { defaultValue: "Open work for the active company. Counts reflect loaded records and are independent of the dashboard date range." })}</CardDescription>
          </div>
          <Badge variant={attentionCount > 0 ? "destructive" : "secondary"}>
            {hasIncompleteReads ? t("financeReview.queueIncomplete", { defaultValue: "Some counts unavailable" }) : t("financeReview.queueCount", { defaultValue: "{{count}} queues need attention", count: attentionCount })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {visibleItems.map((item) => {
          const count = countFor(item.key)
          const Icon = item.icon
          return (
            <div key={item.key} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`finance-queue-${item.key}`}>
              <div className="flex min-w-0 gap-3">
                <Icon className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{t(`financeReview.queues.${item.key}.title`)}</p>
                    <Badge variant={typeof count === "number" && count > 0 ? "destructive" : "secondary"}>{count}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{t(`financeReview.queues.${item.key}.description`)}</p>
                </div>
              </div>
              <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={item.href}>{t(`financeReview.queues.${item.key}.action`)}<ArrowRightIcon data-icon="inline-end" /></Link>
            </div>
          )
        })}
      </CardContent>
      <CardContent className="pt-0">
        <Link className={buttonVariants({ variant: "secondary" })} href="/reports">{t("overview.ownerControlLoop.reviewOwnerReports")}<ArrowRightIcon data-icon="inline-end" /></Link>
      </CardContent>
    </Card>
  )
}
