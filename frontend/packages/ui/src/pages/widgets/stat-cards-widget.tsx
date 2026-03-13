import type { ComponentType } from "react"
import { TrendingUp, TrendingDown, DollarSign, Users, ShoppingCart, Package } from "lucide-react"
import type { StatCardsWidget as StatCardsWidgetType } from "../../lib/dashboard-types"

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  dollar: DollarSign,
  users: Users,
  cart: ShoppingCart,
  package: Package,
}

export function StatCardsWidget({ data }: { data: StatCardsWidgetType["data"] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {data.stats.map((stat, index) => {
        const Icon = stat.icon ? iconMap[stat.icon] : null
        const isPositive = stat.change && stat.change > 0
        const isNegative = stat.change && stat.change < 0

        return (
          <div
            key={index}
            className="p-4 rounded-xl bg-secondary/50 border border-border/50"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{stat.label}</span>
              {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            </div>
            <p className="text-xl font-bold">{stat.value}</p>
            {stat.change !== undefined && (
              <div className={`flex items-center gap-1 mt-1 text-xs ${isPositive ? "text-success" : isNegative ? "text-destructive" : "text-muted-foreground"}`}>
                {isPositive ? <TrendingUp className="h-3 w-3" /> : isNegative ? <TrendingDown className="h-3 w-3" /> : null}
                <span>{stat.change > 0 ? "+" : ""}{stat.change}%</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
