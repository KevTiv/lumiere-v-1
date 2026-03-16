"use client"

import { useState } from "react"
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
}

interface DashboardHeaderProps {
  title: string
  description?: string
  onRefresh?: () => void
  onExport?: () => void
  actions?: ActionItem[]
}

const timeRanges = [
  { label: "Today", value: "today" },
  { label: "Last 7 Days", value: "7d" },
  { label: "Last 30 Days", value: "30d" },
  { label: "Last 90 Days", value: "90d" },
  { label: "Year to Date", value: "ytd" },
]

export function DashboardHeader({ title, description, onRefresh, onExport, actions }: DashboardHeaderProps) {
  const [timeRange, setTimeRange] = useState(timeRanges[2])

  return (
    <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && (
          <p className="text-muted-foreground text-sm mt-1">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {actions?.map((action) => (
          <Button key={action.label} variant={action.variant ?? "default"} onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Calendar className="h-4 w-4" />
              {timeRange.label}
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {timeRanges.map((range) => (
              <DropdownMenuItem
                key={range.value}
                onClick={() => setTimeRange(range)}
              >
                {range.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="icon" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" onClick={onExport}>
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
