"use client"

import { cn } from "@/lib/utils"

export interface IosTileData {
  tiles: IosTile[]
}

export interface IosTile {
  id: string
  label: string
  value: string | number
  subtitle?: string
  icon?: React.ReactNode
  color?: "blue" | "green" | "orange" | "red" | "purple" | "teal"
  progress?: number // 0-100 for ring progress
  sparkline?: number[] // for mini trend line
  size?: "small" | "medium" | "large"
}

const colorMap = {
  blue: {
    bg: "bg-blue-500/10",
    ring: "stroke-blue-500",
    text: "text-blue-400",
    glow: "shadow-blue-500/20",
  },
  green: {
    bg: "bg-emerald-500/10",
    ring: "stroke-emerald-500",
    text: "text-emerald-400",
    glow: "shadow-emerald-500/20",
  },
  orange: {
    bg: "bg-orange-500/10",
    ring: "stroke-orange-500",
    text: "text-orange-400",
    glow: "shadow-orange-500/20",
  },
  red: {
    bg: "bg-red-500/10",
    ring: "stroke-red-500",
    text: "text-red-400",
    glow: "shadow-red-500/20",
  },
  purple: {
    bg: "bg-purple-500/10",
    ring: "stroke-purple-500",
    text: "text-purple-400",
    glow: "shadow-purple-500/20",
  },
  teal: {
    bg: "bg-teal-500/10",
    ring: "stroke-teal-500",
    text: "text-teal-400",
    glow: "shadow-teal-500/20",
  },
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
  const colors = colorMap[tile.color || "blue"]
  const isLarge = tile.size === "large"
  const isMedium = tile.size === "medium"

  return (
    <div
      className={cn(
        "group relative flex flex-col justify-between rounded-2xl p-4 transition-all duration-300",
        "bg-secondary/50 backdrop-blur-sm border border-border/30",
        "hover:border-border/60 hover:shadow-lg",
        colors.glow,
        isLarge ? "col-span-2 row-span-2 p-5" : "",
        isMedium ? "col-span-2" : ""
      )}
    >
      {/* Header with icon */}
      <div className="flex items-start justify-between">
        <div className={cn("p-2 rounded-xl", colors.bg)}>
          {tile.icon || (
            <div className={cn("w-5 h-5 rounded-full", colors.bg, colors.text)} />
          )}
        </div>
        
        {/* Progress ring or sparkline */}
        {tile.progress !== undefined && (
          <div className="relative flex items-center justify-center">
            <RingProgress 
              progress={tile.progress} 
              color={colors.ring} 
              size={isLarge ? 56 : 44}
            />
            <span className={cn(
              "absolute text-xs font-medium",
              colors.text
            )}>
              {tile.progress}%
            </span>
          </div>
        )}
        {tile.sparkline && !tile.progress && (
          <MiniSparkline data={tile.sparkline} color={colors.ring} />
        )}
      </div>

      {/* Content */}
      <div className={cn("mt-auto pt-3", isLarge && "pt-6")}>
        <p className={cn(
          "font-semibold tracking-tight",
          isLarge ? "text-3xl" : "text-2xl"
        )}>
          {tile.value}
        </p>
        <p className="text-sm text-muted-foreground mt-0.5">{tile.label}</p>
        {tile.subtitle && (
          <p className={cn("text-xs mt-1", colors.text)}>{tile.subtitle}</p>
        )}
      </div>

      {/* Subtle gradient overlay on hover */}
      <div className={cn(
        "absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none",
        "bg-gradient-to-br from-transparent via-transparent to-white/[0.02]"
      )} />
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
