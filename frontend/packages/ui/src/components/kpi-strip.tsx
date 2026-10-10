"use client"

import { cn } from "../lib/utils"
import type { KpiTone } from "../lib/kpi-tiles"
import { Skeleton } from "./skeleton"

export interface KpiStripTile {
  key: string
  label: string
  value: string | number
  hint?: string
  tone?: KpiTone
  active: boolean
  /** Absent for a figure that cannot filter; the tile is then plain text, not a button. */
  onSelect?: () => void
}

export interface KpiStripProps {
  tiles: readonly KpiStripTile[]
  loading?: boolean
  className?: string
}

const toneValueClass: Record<KpiTone, string> = {
  default: "text-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
}

/**
 * A row of actionable stat tiles above a list. A tile with `onSelect` is a toggle button
 * (`aria-pressed`) that narrows the list to the rows behind its figure; clicking it again clears.
 */
export function KpiStrip({ tiles, loading = false, className }: KpiStripProps) {
  if (tiles.length === 0) return null
  return (
    <div
      className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6", className)}
      data-testid="kpi-strip"
      data-loading={loading ? "true" : undefined}
    >
      {tiles.map((tile) => {
        const body = (
          <>
            <span className="truncate text-xs font-medium text-muted-foreground">{tile.label}</span>
            {loading ? (
              <Skeleton className="mt-1 h-6 w-16" data-testid={`kpi-tile-${tile.key}-loading`} />
            ) : (
              <span
                className={cn(
                  "mt-1 truncate text-xl font-semibold tabular-nums tracking-tight",
                  toneValueClass[tile.tone ?? "default"],
                )}
                data-testid={`kpi-tile-${tile.key}-value`}
              >
                {tile.value}
              </span>
            )}
            {tile.hint ? <span className="mt-0.5 truncate text-xs text-muted-foreground">{tile.hint}</span> : null}
          </>
        )
        const base =
          "flex min-w-0 flex-col items-start rounded-lg border bg-card px-3 py-2 text-left shadow-xs"
        if (!tile.onSelect) {
          return (
            <div key={tile.key} className={cn(base, "border-border")} data-testid={`kpi-tile-${tile.key}`}>
              {body}
            </div>
          )
        }
        return (
          <button
            key={tile.key}
            type="button"
            aria-pressed={tile.active}
            onClick={tile.onSelect}
            data-testid={`kpi-tile-${tile.key}`}
            data-active={tile.active ? "true" : undefined}
            className={cn(
              base,
              "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tile.active ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            {body}
          </button>
        )
      })}
    </div>
  )
}
