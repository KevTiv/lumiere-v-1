import { TrendingDown, TrendingUp } from "lucide-react"

interface TrendBadgeProps {
  change?: number
  label?: string
  /** Set when a rise is unfavorable (costs, expenses, overdue): flips positive/negative colors. */
  invertChange?: boolean
}

export function TrendBadge({ change, label = "vs prior period", invertChange = false }: TrendBadgeProps) {
  if (change === undefined) return null

  const isPositive = change > 0
  const isNegative = change < 0
  const isGood = invertChange ? isNegative : isPositive
  const isBad = invertChange ? isPositive : isNegative

  return (
    <div
      className={`mt-1 flex items-center gap-1 text-xs tabular-nums ${
        isGood ? "text-success" : isBad ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {isPositive ? (
        <TrendingUp className="h-3 w-3" />
      ) : isNegative ? (
        <TrendingDown className="h-3 w-3" />
      ) : null}
      <span>
        {change > 0 ? "+" : ""}
        {change.toFixed(1)}% {label}
      </span>
    </div>
  )
}
