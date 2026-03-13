"use client"

import { cn } from "@/lib/utils"
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
  type LucideIcon
} from "lucide-react"

export interface QuickActionsData {
  actions: QuickAction[]
  columns?: 2 | 3 | 4
}

export interface QuickAction {
  id: string
  label: string
  icon: string
  color?: "blue" | "green" | "orange" | "red" | "purple" | "teal"
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
}

const colorStyles = {
  blue: {
    bg: "bg-blue-500/10 hover:bg-blue-500/20",
    icon: "text-blue-400",
    glow: "group-hover:shadow-blue-500/20",
  },
  green: {
    bg: "bg-emerald-500/10 hover:bg-emerald-500/20",
    icon: "text-emerald-400",
    glow: "group-hover:shadow-emerald-500/20",
  },
  orange: {
    bg: "bg-orange-500/10 hover:bg-orange-500/20",
    icon: "text-orange-400",
    glow: "group-hover:shadow-orange-500/20",
  },
  red: {
    bg: "bg-red-500/10 hover:bg-red-500/20",
    icon: "text-red-400",
    glow: "group-hover:shadow-red-500/20",
  },
  purple: {
    bg: "bg-purple-500/10 hover:bg-purple-500/20",
    icon: "text-purple-400",
    glow: "group-hover:shadow-purple-500/20",
  },
  teal: {
    bg: "bg-teal-500/10 hover:bg-teal-500/20",
    icon: "text-teal-400",
    glow: "group-hover:shadow-teal-500/20",
  },
}

export function QuickActionsWidget({ data }: { data: QuickActionsData }) {
  const columns = data.columns || 4

  return (
    <div className={cn(
      "grid gap-3",
      columns === 2 && "grid-cols-2",
      columns === 3 && "grid-cols-3",
      columns === 4 && "grid-cols-2 sm:grid-cols-4"
    )}>
      {data.actions.map((action) => {
        const IconComponent = iconMap[action.icon] || Plus
        const colors = colorStyles[action.color || "blue"]

        return (
          <button
            key={action.id}
            onClick={action.onClick}
            className={cn(
              "group flex flex-col items-center gap-3 p-4 rounded-2xl",
              "border border-border/30 hover:border-border/60",
              "transition-all duration-300 hover:shadow-lg",
              "bg-secondary/30 backdrop-blur-sm",
              colors.glow
            )}
          >
            <div className={cn(
              "p-3 rounded-xl transition-colors",
              colors.bg
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
