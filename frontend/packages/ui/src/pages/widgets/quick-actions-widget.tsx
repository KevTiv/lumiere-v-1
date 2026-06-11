"use client"

import { cn } from "@/lib/utils"
import { widgetAccentTileClass, type WidgetAccentKey } from "@/lib/theme-colors"
import {
  Plus,
  FileText,
  Users,
  Package,
  TrendingUp,
  Settings,
  Download,
  Upload,
  RefreshCw,
  Bell,
  Calendar,
  LayoutTemplate,
  Activity,
  type LucideIcon
} from "lucide-react"

export interface QuickActionsData {
  actions: QuickAction[]
  columns?: 2 | 3 | 4 | 6
}

export interface QuickAction {
  id: string
  label: string
  icon: string
  color?: WidgetAccentKey
  onClick?: () => void
}

const iconMap: Record<string, LucideIcon> = {
  plus: Plus,
  file: FileText,
  users: Users,
  package: Package,
  trending: TrendingUp,
  settings: Settings,
  download: Download,
  upload: Upload,
  refresh: RefreshCw,
  bell: Bell,
  calendar: Calendar,
  template: LayoutTemplate,
  gauge: Activity,
}

export function QuickActionsWidget({ data }: { data: QuickActionsData }) {
  const columns = data.columns || 4

  return (
    <div className={cn(
      "grid gap-3",
      columns === 2 && "grid-cols-2",
      columns === 3 && "grid-cols-3",
      columns === 4 && "grid-cols-2 sm:grid-cols-4",
      columns === 6 && "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
    )}>
      {data.actions.map((action) => {
        const IconComponent = iconMap[action.icon] || Plus
        const accentKey: WidgetAccentKey =
          action.color && action.color in widgetAccentTileClass ? action.color : "blue"
        const colors = widgetAccentTileClass[accentKey]

        return (
          <button
            type="button"
            key={action.id}
            onClick={action.onClick}
            data-testid={`quick-action-${action.id}`}
            className={cn(
              "group flex flex-col items-center gap-3 rounded-xl p-4",
              "border border-border bg-card shadow-xs hover:border-border/90 hover:bg-muted/20",
              "transition-[background-color,border-color,box-shadow] duration-150"
            )}
          >
            <div className={cn(
              "rounded-lg border border-border bg-muted/40 p-2.5 transition-colors",
              colors.icon
            )}>
              <IconComponent className="h-4 w-4" />
            </div>
            <span className="text-center text-sm font-medium">{action.label}</span>
          </button>
        )
      })}
    </div>
  )
}
