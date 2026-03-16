"use client"

import { cn } from "@/lib/utils"

export interface ActivityRingData {
  rings: ActivityRing[]
  showLegend?: boolean
  size?: "sm" | "md" | "lg"
}

export interface ActivityRing {
  id: string
  label: string
  value: number
  max: number
  color: "red" | "green" | "blue" | "orange" | "purple" | "teal"
  unit?: string
}

const ringColors = {
  red: "stroke-red-500",
  green: "stroke-emerald-500",
  blue: "stroke-blue-500",
  orange: "stroke-orange-500",
  purple: "stroke-purple-500",
  teal: "stroke-teal-500",
}

const textColors = {
  red: "text-red-400",
  green: "text-emerald-400",
  blue: "text-blue-400",
  orange: "text-orange-400",
  purple: "text-purple-400",
  teal: "text-teal-400",
}

const bgColors = {
  red: "bg-red-500",
  green: "bg-emerald-500",
  blue: "bg-blue-500",
  orange: "bg-orange-500",
  purple: "bg-purple-500",
  teal: "bg-teal-500",
}

export function ActivityRingWidget({ data }: { data: ActivityRingData }) {
  const size = data.size || "md"
  const baseSize = size === "sm" ? 120 : size === "md" ? 160 : 200
  const strokeWidth = size === "sm" ? 10 : size === "md" ? 12 : 14
  const gap = 4

  return (
    <div className="flex flex-col lg:flex-row items-center gap-6">
      {/* Rings visualization */}
      <div className="relative" style={{ width: baseSize, height: baseSize }}>
        <svg width={baseSize} height={baseSize} className="transform -rotate-90">
          {data.rings.map((ring, index) => {
            const radius = (baseSize / 2) - (strokeWidth / 2) - (index * (strokeWidth + gap))
            const circumference = 2 * Math.PI * radius
            const progress = Math.min(ring.value / ring.max, 1)
            const offset = circumference - progress * circumference

            return (
              <g key={ring.id}>
                {/* Background track */}
                <circle
                  cx={baseSize / 2}
                  cy={baseSize / 2}
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={strokeWidth}
                  className="text-muted/20"
                />
                {/* Progress arc */}
                <circle
                  cx={baseSize / 2}
                  cy={baseSize / 2}
                  r={radius}
                  fill="none"
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={offset}
                  className={cn(
                    "transition-all duration-700 ease-out",
                    ringColors[ring.color]
                  )}
                  style={{
                    filter: `drop-shadow(0 0 6px ${ring.color === 'red' ? '#ef4444' : ring.color === 'green' ? '#10b981' : ring.color === 'blue' ? '#3b82f6' : ring.color === 'orange' ? '#f97316' : ring.color === 'purple' ? '#a855f7' : '#14b8a6'}40)`,
                  }}
                />
              </g>
            )
          })}
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold">
            {Math.round((data.rings.reduce((acc, r) => acc + r.value, 0) / data.rings.reduce((acc, r) => acc + r.max, 0)) * 100)}%
          </span>
          <span className="text-xs text-muted-foreground">Complete</span>
        </div>
      </div>

      {/* Legend */}
      {data.showLegend !== false && (
        <div className="flex flex-col gap-3 flex-1">
          {data.rings.map((ring) => {
            const percentage = Math.round((ring.value / ring.max) * 100)
            return (
              <div key={ring.id} className="flex items-center gap-3">
                <div className={cn("w-3 h-3 rounded-full", bgColors[ring.color])} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium truncate">{ring.label}</span>
                    <span className={cn("text-sm font-semibold", textColors[ring.color])}>
                      {ring.value}{ring.unit || ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all duration-500", bgColors[ring.color])}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-12 text-right">
                      / {ring.max}{ring.unit || ''}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
