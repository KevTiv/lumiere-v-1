"use client"

import { cn } from "@/lib/utils"
import {
  widgetCountdownGradientClass,
  widgetCountdownBarClass,
  widgetAccentTileClass,
  type WidgetAccentKey,
} from "@/lib/theme-colors"

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
  color?: WidgetAccentKey
}

function CountdownCard({ item }: { item: CountdownItem }) {
  const color: WidgetAccentKey = item.color || "blue"
  const progress = item.maxValue ? (item.value / item.maxValue) * 100 : undefined

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center p-4 rounded-2xl",
        "bg-gradient-to-b border backdrop-blur-sm",
        "transition-all duration-300 hover:scale-105",
        widgetCountdownGradientClass[color]
      )}
    >
      {/* Value */}
      <span className={cn(
        "text-4xl font-bold tabular-nums tracking-tighter",
        widgetAccentTileClass[color].ringText
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
            className={cn("h-full rounded-full transition-all", widgetCountdownBarClass[color])}
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
