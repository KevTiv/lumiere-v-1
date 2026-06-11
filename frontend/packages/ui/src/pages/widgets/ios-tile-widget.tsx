"use client"

import { cn } from "@/lib/utils"
import { widgetAccentTileClass, type WidgetAccentKey } from "@/lib/theme-colors"

export interface IosTileData {
  tiles: IosTile[]
}

export interface IosTile {
  id: string
  label: string
  value: string | number
  subtitle?: string
  icon?: React.ReactNode
  color?: WidgetAccentKey
  progress?: number // 0-100 for ring progress
  sparkline?: number[] // for mini trend line
  size?: "small" | "medium" | "large"
}

function RingProgress({
  progress,
  color,
  size = 48
}: {
  progress: number
  color: string
  size?: number
}) {
  const strokeWidth = 4
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (progress / 100) * circumference

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted/30"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className={cn("transition-all duration-500", color)}
      />
    </svg>
  )
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const width = 60
  const height = 24
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / range) * height
      return `${x},${y}`
    })
    .join(" ")

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        className={cn("transition-all duration-300", color)}
      />
    </svg>
  )
}

function SingleTile({ tile }: { tile: IosTile }) {
  const colors = widgetAccentTileClass[tile.color || "blue"]
  const isLarge = tile.size === "large"
  const isMedium = tile.size === "medium"

  return (
    <div
      className={cn(
        "group relative flex flex-col justify-between rounded-xl p-4 transition-[background-color,border-color,box-shadow] duration-150",
        "border border-border bg-card shadow-xs",
        "hover:border-border/90 hover:bg-muted/20",
        isLarge ? "col-span-2 row-span-2 p-5" : "",
        isMedium ? "col-span-2" : ""
      )}
    >
      {/* Header with icon */}
      <div className="flex items-start justify-between">
        <div className={cn("rounded-lg border border-border bg-muted/40 p-2", colors.ringText)}>
          {tile.icon || (
            <div className="h-4 w-4 rounded-full bg-current opacity-70" />
          )}
        </div>

        {/* Progress ring or sparkline */}
        {tile.progress !== undefined && (
          <div className="relative flex items-center justify-center">
            <RingProgress
              progress={tile.progress}
              color={colors.stroke}
              size={isLarge ? 56 : 44}
            />
            <span className={cn(
              "absolute text-xs font-medium",
              colors.ringText
            )}>
              {tile.progress}%
            </span>
          </div>
        )}
        {tile.sparkline && !tile.progress && (
          <MiniSparkline data={tile.sparkline} color={colors.stroke} />
        )}
      </div>

      {/* Content */}
      <div className={cn("mt-auto pt-3", isLarge && "pt-6")}>
        <p className={cn(
              "font-semibold tracking-[-0.03em] tabular-nums",
          isLarge ? "text-3xl" : "text-2xl"
        )}>
          {tile.value}
        </p>
        <p className="text-sm text-muted-foreground mt-0.5">{tile.label}</p>
        {tile.subtitle && (
          <p className={cn("text-xs mt-1", colors.ringText)}>{tile.subtitle}</p>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-border to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  )
}

export function IosTileWidget({ data }: { data: IosTileData }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 auto-rows-fr">
      {data.tiles.map((tile) => (
        <SingleTile key={tile.id} tile={tile} />
      ))}
    </div>
  )
}
