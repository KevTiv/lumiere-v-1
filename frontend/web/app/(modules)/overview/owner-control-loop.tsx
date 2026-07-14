"use client"

import Link from "next/link"
import { AlertTriangleIcon, ArrowRightIcon, BellRingIcon, CircleDollarSignIcon, PackageSearchIcon } from "lucide-react"

import { Badge } from "@lumiere/ui/components/badge"
import { buttonVariants } from "@lumiere/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lumiere/ui/components/card"

interface OwnerControlLoopProps {
  overdueInvoices: number
  unreconciledPayments: number
  lowStockProducts: number
  pendingMessageApprovals: number
}

const CONTROL_ITEMS: Array<{
  key: keyof OwnerControlLoopProps
  title: string
  description: string
  href: string
  action: string
  icon: typeof CircleDollarSignIcon
}> = [
  { key: "overdueInvoices", title: "Overdue customer balances", description: "Review open receivables and follow up from accounting.", href: "/accounting", action: "Open accounting", icon: CircleDollarSignIcon },
  { key: "unreconciledPayments", title: "Reconciliation exceptions", description: "Match posted provider transactions to invoices or bills.", href: "/accounting", action: "Reconcile payments", icon: AlertTriangleIcon },
  { key: "lowStockProducts", title: "Low-stock alerts", description: "Review replenishment priorities and current stock availability.", href: "/inventory", action: "Open inventory", icon: PackageSearchIcon },
  { key: "pendingMessageApprovals", title: "Message approvals", description: "Approve or reject invoice reminders and customer batches.", href: "/messages", action: "Review messages", icon: BellRingIcon },
]

export function OwnerControlLoop(props: OwnerControlLoopProps) {
  const attentionCount = Object.values(props).reduce((total, value) => total + value, 0)

  return (
    <Card data-testid="owner-control-loop">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Owner control loop</CardTitle>
            <CardDescription>Resolve today’s cash, stock, and customer exceptions from one queue.</CardDescription>
          </div>
          <Badge variant={attentionCount > 0 ? "destructive" : "secondary"}>{attentionCount} needing attention</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {CONTROL_ITEMS.map((item) => {
          const count = props[item.key]
          const Icon = item.icon
          return (
            <div key={item.key} className="flex items-start justify-between gap-4 rounded-lg border p-4">
              <div className="flex min-w-0 gap-3">
                <Icon className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{item.title}</p>
                    <Badge variant={count > 0 ? "destructive" : "secondary"}>{count}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                </div>
              </div>
              <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={item.href}>{item.action}<ArrowRightIcon data-icon="inline-end" /></Link>
            </div>
          )
        })}
      </CardContent>
      <CardContent className="pt-0">
        <Link className={buttonVariants({ variant: "secondary" })} href="/reports">Review owner reports<ArrowRightIcon data-icon="inline-end" /></Link>
      </CardContent>
    </Card>
  )
}
