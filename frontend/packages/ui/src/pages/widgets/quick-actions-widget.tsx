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
            key={action.id}
            onClick={action.onClick}
            className={cn(
              "group flex flex-col items-center gap-3 p-4 rounded-2xl",
              "border border-border/30 hover:border-border/60",
              "transition-all duration-300 hover:shadow-lg",
              "bg-secondary/30 backdrop-blur-sm",
              colors.shadowGlow
            )}
          >
            <div className={cn(
              "p-3 rounded-xl transition-colors",
              colors.bgHover
            )}>
              <IconComponent className={cn("w-5 h-5", colors.icon)} />
            </div>
            <span className="text-sm font-medium text-center">{action.label}</span>
          </button>
        )
      })}
    </div>
  )
}
