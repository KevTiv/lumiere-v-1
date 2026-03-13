"use client"

import { cn } from "@/lib/utils"

export interface CountdownData {
  items: CountdownItem[]
  layout?: "horizontal" | "grid"
}

export interface CountdownItem {
  id: string
  label: string
  value: number
  unit: string
  maxValue?: number
  color?: "blue" | "green" | "orange" | "red" | "purple" | "teal"
}

const colorVariants = {
  blue: "from-blue-500/20 to-blue-600/5 border-blue-500/30",
  green: "from-emerald-500/20 to-emerald-600/5 border-emerald-500/30",
  orange: "from-orange-500/20 to-orange-600/5 border-orange-500/30",
  red: "from-red-500/20 to-red-600/5 border-red-500/30",
  purple: "from-purple-500/20 to-purple-600/5 border-purple-500/30",
  teal: "from-teal-500/20 to-teal-600/5 border-teal-500/30",
}

const textVariants = {
  blue: "text-blue-400",
  green: "text-emerald-400",
  orange: "text-orange-400",
  red: "text-red-400",
  purple: "text-purple-400",
  teal: "text-teal-400",
}

function CountdownCard({ item }: { item: CountdownItem }) {
  const color = item.color || "blue"
  const progress = item.maxValue ? (item.value / item.maxValue) * 100 : undefined

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center p-4 rounded-2xl",
        "bg-gradient-to-b border backdrop-blur-sm",
        "transition-all duration-300 hover:scale-105",
        colorVariants[color]
      )}
    >
      {/* Value */}
      <span className={cn(
        "text-4xl font-bold tabular-nums tracking-tighter",
        textVariants[color]
      )}>
        {String(item.value).padStart(2, '0')}
      </span>
      
      {/* Unit */}
      <span className="text-xs uppercase tracking-wider text-muted-foreground mt-1">
        {item.unit}
      </span>

      {/* Optional progress indicator */}
      {progress !== undefined && (
        <div className="absolute bottom-2 left-3 right-3 h-1 rounded-full bg-muted/20 overflow-hidden">
          <div 
            className={cn("h-full rounded-full transition-all", `bg-${color}-500`)}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  )
}

export function CountdownWidget({ data }: { data: CountdownData }) {
  const isHorizontal = data.layout === "horizontal"

  return (
    <div className={cn(
      "flex gap-3",
      isHorizontal ? "flex-row justify-center" : "grid grid-cols-2 sm:grid-cols-4"
    )}>
      {data.items.map((item, index) => (
        <div key={item.id} className="flex items-center gap-2">
          <CountdownCard item={item} />
          {isHorizontal && index < data.items.length - 1 && (
            <span className="text-2xl font-light text-muted-foreground/50">:</span>
          )}
        </div>
      ))}
    </div>
  )
}
