"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@lumiere/ui/lib/utils"
import type { MapLayerConfig, MapPinData } from "@/lib/map-types"

interface MapPinHoverCardProps {
  pin: MapPinData
  layer: MapLayerConfig
  className?: string
}

function formatCurrency(value: unknown): string {
  const num = Number(value)
  if (Number.isNaN(num)) return String(value ?? "—")
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num)
}

function formatNumber(value: unknown): string {
  const num = Number(value)
  if (Number.isNaN(num)) return String(value ?? "—")
  return new Intl.NumberFormat("en-US").format(num)
}

export function MapPinHoverCard({ pin, layer, className }: MapPinHoverCardProps) {
  return (
    <div
      className={cn(
        "w-56 rounded-xl border border-border bg-card text-card-foreground shadow-lg ring-1 ring-foreground/5",
        className
      )}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 rounded-t-xl px-3 py-2.5"
        style={{ borderBottom: `2px solid ${layer.color}` }}
      >
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: layer.color }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">{pin.label}</p>
          <p className="text-[10px] text-muted-foreground">{layer.label}</p>
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-1.5 px-3 py-2.5">
        {layer.fields.map((field) => {
          const raw = pin.data[field.key]
          const isEmpty = raw === undefined || raw === null || raw === ""

          let rendered: React.ReactNode

          if (field.format) {
            rendered = <span className="text-xs text-foreground">{field.format(raw)}</span>
          } else if (field.type === "badge") {
            const variantKey = String(raw ?? "")
            const variant = (field.badgeVariants?.[variantKey] ?? "secondary") as
              | "default" | "secondary" | "destructive" | "outline"
            const label = field.badgeLabels?.[variantKey] ?? variantKey
            rendered = <Badge variant={variant} className="text-[10px]">{label}</Badge>
          } else if (field.type === "currency") {
            rendered = (
              <span className="text-xs font-medium text-foreground">
                {isEmpty ? "—" : formatCurrency(raw)}
              </span>
            )
          } else if (field.type === "number") {
            rendered = (
              <span className="text-xs text-foreground">
                {isEmpty ? "—" : formatNumber(raw)}
              </span>
            )
          } else {
            rendered = (
              <span className="text-xs text-foreground">{isEmpty ? "—" : String(raw)}</span>
            )
          }

          return (
            <div key={field.key} className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-[10px] text-muted-foreground">{field.label}</span>
              <span className="min-w-0 truncate text-right">{rendered}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
