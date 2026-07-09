import { TrendingDown, TrendingUp } from "lucide-react"

interface TrendBadgeProps {
  change?: number
  label?: string
}

export function TrendBadge({ change, label = "vs prior period" }: TrendBadgeProps) {
  if (change === undefined) return null

  const isPositive = change > 0
  const isNegative = change < 0

  return (
    <div
      className={`mt-1 flex items-center gap-1 text-xs ${
        isPositive ? "text-success" : isNegative ? "text-destructive" : "text-muted-foreground"
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
