interface TaxDeadlineEntry {
  title: string
  dueDate: string
  status: string
  daysUntil: number
}

interface TaxDeadlineData {
  deadlines: TaxDeadlineEntry[]
}

export function TaxDeadlineWidget({ data }: { data: TaxDeadlineData }) {
  if (data.deadlines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">No upcoming deadlines</p>
    )
  }

  return (
    <div className="space-y-2">
      {data.deadlines.map((d, i) => {
        const isOverdue = d.daysUntil < 0
        const isSoon = d.daysUntil >= 0 && d.daysUntil <= 7
        const pillClass = isOverdue
          ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
          : isSoon
            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
            : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
        const label =
          isOverdue
            ? `${Math.abs(d.daysUntil)}d overdue`
            : d.daysUntil === 0
              ? "Today"
              : `${d.daysUntil}d`
        return (
          <div
            key={i}
            className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{d.title}</p>
              <p className="text-xs text-muted-foreground">{d.dueDate}</p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${pillClass}`}
            >
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
