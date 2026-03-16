"use client"

interface AccountEntry {
  code: string
  name: string
  balance: number
  type: string
}

interface AccountBalanceData {
  accounts: AccountEntry[]
}

export function AccountBalanceWidget({ data }: { data: AccountBalanceData }) {
  const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

  if (data.accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">No accounts configured</p>
    )
  }

  return (
    <div className="space-y-1">
      {data.accounts.map((a, i) => (
        <div
          key={i}
          className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0"
        >
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono shrink-0">{a.code}</span>
            <span className="text-sm font-medium truncate">{a.name}</span>
          </div>
          <span
            className={`text-sm font-semibold tabular-nums shrink-0 ${a.balance < 0 ? "text-red-500" : ""}`}
          >
            {fmt.format(a.balance)}
          </span>
        </div>
      ))}
    </div>
  )
}
