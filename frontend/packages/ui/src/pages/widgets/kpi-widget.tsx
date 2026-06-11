"use client"

import type { ComponentType } from "react"
import { TrendingUp, TrendingDown, Minus, DollarSign, Users, ShoppingCart, Package } from "lucide-react"
import type { KPIWidget as KPIWidgetType } from "../../lib/dashboard-types"

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  dollar: DollarSign,
  users: Users,
  cart: ShoppingCart,
  package: Package,
}

export function KPIWidget({ data }: { data: KPIWidgetType["data"] }) {
  const Icon = data.icon ? iconMap[data.icon] : null

  const TrendIcon = data.trend === "up"
    ? TrendingUp
    : data.trend === "down"
      ? TrendingDown
      : Minus

  const trendColor = data.trend === "up"
    ? "text-success"
    : data.trend === "down"
      ? "text-destructive"
      : "text-muted-foreground"

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-muted-foreground">{data.label}</p>
        <p className="mt-1 text-3xl font-semibold tracking-[-0.03em] tabular-nums">{data.value}</p>
        {data.change !== undefined && (
          <div className={`mt-3 flex items-center gap-1 text-sm ${trendColor}`}>
            <TrendIcon className="h-3.5 w-3.5" />
            <span>{data.change > 0 ? "+" : ""}{data.change}%</span>
            {data.changeLabel && (
              <span className="text-muted-foreground ml-1">{data.changeLabel}</span>
            )}
          </div>
        )}
      </div>
      {Icon && (
        <div className="rounded-lg border border-border bg-muted/40 p-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
      )}
    </div>
  )
}
