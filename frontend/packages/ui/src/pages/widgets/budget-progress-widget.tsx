"use client"

interface BudgetEntry {
  name: string
  planned: number
  actual: number
  variance: number
}

interface BudgetProgressData {
  budgets: BudgetEntry[]
}

export function BudgetProgressWidget({ data }: { data: BudgetProgressData }) {
  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
  })

  if (data.budgets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">No budget data</p>
    )
  }

  return (
    <div className="space-y-3">
      {data.budgets.map((b, i) => {
        const pct = b.planned > 0 ? Math.min((b.actual / b.planned) * 100, 150) : 0
        const barColor = pct <= 90 ? "bg-emerald-500" : pct <= 100 ? "bg-amber-500" : "bg-red-500"
        const textColor =
          pct <= 90 ? "text-emerald-600" : pct <= 100 ? "text-amber-500" : "text-red-500"
        return (
          <div key={i} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="font-medium truncate">{b.name}</span>
              <span className={`font-semibold ${textColor}`}>{b.variance.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${barColor} transition-all`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{fmt.format(b.actual)}</span>
              <span>of {fmt.format(b.planned)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
