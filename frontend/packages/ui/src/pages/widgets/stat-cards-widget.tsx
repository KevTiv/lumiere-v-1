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
import type { StatCardsWidget as StatCardsWidgetType } from "../../lib/dashboard-types"
import { StatCard, StatCardGrid } from "../../components/stat-card"

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
    <StatCardGrid>
      {data.stats.map((stat, index) => (
        <StatCard
          key={index}
          testId={stat.testId ?? `stat-${index}`}
          label={stat.label}
          value={stat.value}
          icon={stat.icon ? iconMap[stat.icon] : undefined}
          onClick={stat.onClick}
          change={stat.change ?? undefined}
          changeLabel={stat.changeLabel}
          invertChange={stat.invertChange}
        />
      ))}
    </StatCardGrid>
  )
}
