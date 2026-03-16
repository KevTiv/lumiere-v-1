"use client"

interface OverdueInvoicesData {
  count: number
  totalAmount: number
  oldestDays: number
}

export function OverdueInvoicesWidget({ data }: { data: OverdueInvoicesData }) {
  const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
  const status = data.count === 0 ? "green" : data.oldestDays > 60 ? "red" : "amber"
  const colorClass =
    status === "green" ? "text-emerald-600" : status === "red" ? "text-red-500" : "text-amber-500"
  const bgClass =
    status === "green"
      ? "bg-emerald-50 dark:bg-emerald-950/30"
      : status === "red"
        ? "bg-red-50 dark:bg-red-950/30"
        : "bg-amber-50 dark:bg-amber-950/30"

  return (
    <div className={`rounded-lg p-4 ${bgClass}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-3xl font-bold ${colorClass}`}>{data.count}</p>
          <p className="text-sm text-muted-foreground mt-1">
            overdue invoice{data.count !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-semibold ${colorClass}`}>{fmt.format(data.totalAmount)}</p>
          <p className="text-xs text-muted-foreground">total outstanding</p>
        </div>
      </div>
      {data.count > 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          Oldest:{" "}
          <span className={`font-medium ${colorClass}`}>{data.oldestDays} days</span> overdue
        </p>
      )}
    </div>
  )
}
