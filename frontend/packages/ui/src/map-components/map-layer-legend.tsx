"use client"

import { cn } from "@lumiere/ui/lib/utils"
import type { MapLayerConfig } from "@/lib/map-types"

interface MapLayerLegendProps {
  layers: MapLayerConfig[]
  visibleLayers: Set<string>
  onToggle: (layerId: string) => void
  className?: string
}

export function MapLayerLegend({ layers, visibleLayers, onToggle, className }: MapLayerLegendProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {layers.map((layer) => {
        const active = visibleLayers.has(layer.id)
        return (
          <button
            key={layer.id}
            type="button"
            onClick={() => onToggle(layer.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
              active
                ? "border-transparent text-white shadow-sm"
                : "border-border bg-card text-muted-foreground opacity-60 hover:opacity-80"
            )}
            style={active ? { backgroundColor: layer.color } : undefined}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: active ? "white" : layer.color, opacity: active ? 0.9 : 1 }}
            />
            {layer.label}
          </button>
        )
      })}
    </div>
  )
}
