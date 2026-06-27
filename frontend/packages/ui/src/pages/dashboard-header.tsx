"use client"

import { Button } from "../components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/dropdown-menu"
import { RefreshCw, Download, ChevronDown, Calendar } from "lucide-react"

interface ActionItem {
  label: string
  onClick: () => void
  variant?: "default" | "outline" | "destructive" | "secondary" | "ghost" | "link"
  testId?: string
}

type TimeRangeValue = "today" | "7d" | "30d" | "90d" | "ytd"

interface DashboardHeaderProps {
  title: string
  description?: string
  onRefresh?: () => void
  onExport?: () => void
  actions?: ActionItem[]
  timeRange?: TimeRangeValue
  onTimeRangeChange?: (value: TimeRangeValue) => void
}

const timeRanges = [
  { label: "Today", value: "today" },
  { label: "Last 7 Days", value: "7d" },
  { label: "Last 30 Days", value: "30d" },
  { label: "Last 90 Days", value: "90d" },
  { label: "Year to Date", value: "ytd" },
]

export function DashboardHeader({
  title,
  description,
  onRefresh,
  onExport,
  actions,
  timeRange = "30d",
  onTimeRangeChange,
}: DashboardHeaderProps) {
  const selectedTimeRange = timeRanges.find((range) => range.value === timeRange) ?? timeRanges[2]

  return (
    <header className="mb-6 flex flex-col justify-between gap-4 border-b border-border/70 pb-5 md:flex-row md:items-end">
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        {description && (
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions?.map((action) => (
          <Button
            key={action.label}
            variant={action.variant ?? "default"}
            onClick={action.onClick}
            data-testid={action.testId}
          >
            {action.label}
          </Button>
        ))}
        {onTimeRangeChange ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Calendar className="h-4 w-4" />
                {selectedTimeRange.label}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {timeRanges.map((range) => (
                <DropdownMenuItem
                  key={range.value}
                  onClick={() => onTimeRangeChange(range.value as TimeRangeValue)}
                >
                  {range.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {onRefresh ? (
          <Button variant="outline" size="icon" onClick={onRefresh} aria-label="Refresh dashboard">
            <RefreshCw className="h-4 w-4" />
          </Button>
        ) : null}
        {onExport ? (
          <Button variant="outline" size="icon" onClick={onExport} aria-label="Export dashboard">
            <Download className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </header>
  )
}
