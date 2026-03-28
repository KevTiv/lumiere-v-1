"use client"

interface CashFlowData {
  arTotal: number
  apTotal: number
  netPosition: number
}

export function CashFlowWidget({ data }: { data: CashFlowData }) {
  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
  })
  const total = data.arTotal + data.apTotal
  const arPct = total > 0 ? (data.arTotal / total) * 100 : 50
  const isPositive = data.netPosition >= 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-success/10 p-3 text-center">
          <p className="text-xs text-muted-foreground">Receivable (AR)</p>
          <p className="text-lg font-bold text-success">{fmt.format(data.arTotal)}</p>
        </div>
        <div className="rounded-lg bg-destructive/10 p-3 text-center">
          <p className="text-xs text-muted-foreground">Payable (AP)</p>
          <p className="text-lg font-bold text-destructive">{fmt.format(data.apTotal)}</p>
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-destructive/20 dark:bg-destructive/35 overflow-hidden">
        <div
          className="h-full rounded-full bg-success"
          style={{ width: `${arPct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Net position</span>
        <span className={`font-semibold ${isPositive ? "text-success" : "text-destructive"}`}>
          {isPositive ? "+" : ""}
          {fmt.format(data.netPosition)}
        </span>
      </div>
    </div>
  )
}
