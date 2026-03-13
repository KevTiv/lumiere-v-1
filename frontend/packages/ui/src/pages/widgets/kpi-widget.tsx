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
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <p className="text-sm text-muted-foreground">{data.label}</p>
        <p className="text-3xl font-bold mt-1">{data.value}</p>
        {data.change !== undefined && (
          <div className={`flex items-center gap-1 mt-2 text-sm ${trendColor}`}>
            <TrendIcon className="h-4 w-4" />
            <span>{data.change > 0 ? "+" : ""}{data.change}%</span>
            {data.changeLabel && (
              <span className="text-muted-foreground ml-1">{data.changeLabel}</span>
            )}
          </div>
        )}
      </div>
      {Icon && (
        <div className="p-3 rounded-xl bg-primary/10">
          <Icon className="h-6 w-6 text-primary" />
        </div>
      )}
    </div>
  )
}
