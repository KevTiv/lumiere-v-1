"use client"

import type { ComponentType } from "react"
import {
  DollarSign,
  Users,
  ShoppingCart,
  Package,
  BarChart2,
  CheckCircle,
  Download,
  Scale,
  FileText,
  Calendar,
  LayoutTemplate,
  Activity,
  AlertCircle,
  TrendingUp,
} from "lucide-react"
import { TrendBadge } from "../../components/trend-badge"
import type { StatCardsWidget as StatCardsWidgetType } from "../../lib/dashboard-types"
import { cn } from "../../lib/utils"

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  dollar: DollarSign,
  users: Users,
  cart: ShoppingCart,
  package: Package,
  BarChart2,
  CheckCircle,
  Download,
  Scale,
  FileText,
  Calendar,
  template: LayoutTemplate,
  gauge: Activity,
  AlertCircle,
  TrendingUp,
  ShoppingCart,
  DollarSign,
}

export function StatCardsWidget({ data }: { data: StatCardsWidgetType["data"] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {data.stats.map((stat, index) => {
        const Icon = stat.icon ? iconMap[stat.icon] : null
        const statTestId = stat.testId ?? `stat-${index}`
        const clickable = typeof stat.onClick === "function"

        return (
          <div
            key={index}
            data-testid={statTestId}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? stat.onClick : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      stat.onClick?.()
                    }
                  }
                : undefined
            }
            className={cn(
              "p-4 rounded-xl bg-secondary/50 border border-border/50",
              clickable && "cursor-pointer transition-colors hover:bg-secondary/80",
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{stat.label}</span>
              {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            </div>
            <p className="text-xl font-bold">{stat.value}</p>
            <TrendBadge change={stat.change} />
          </div>
        )
      })}
    </div>
  )
}
