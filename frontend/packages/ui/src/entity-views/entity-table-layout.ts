import { entityColumnLayouts } from "../lib/entity-column-layouts"
import type {
  ColumnType,
  EntityColumn,
  EntityColumnLayout,
} from "../lib/entity-view-types"

interface ColumnTrack {
  min: number
  preferred: number
  max: number
  grow: number
}

export const SELECTION_COLUMN_REM = 2.75
export const ACTION_COLUMN_REM = 3.5

const typeLayouts: Partial<Record<ColumnType, EntityColumnLayout>> = {
  currency: entityColumnLayouts.amount,
  number: entityColumnLayouts.quantity,
  percent: entityColumnLayouts.quantity,
  boolean: entityColumnLayouts.flag,
  badge: entityColumnLayouts.status,
  status: entityColumnLayouts.status,
  date: entityColumnLayouts.date,
  datetime: entityColumnLayouts.date,
  "relative-date": entityColumnLayouts.date,
}

function getTrack(column: EntityColumn): ColumnTrack {
  // Existing configs use Tailwind's quarter-rem spacing scale for min-width.
  const legacySpacing = /(?:^|\s)min-w-(\d+(?:\.\d+)?)(?:$|\s)/.exec(column.width ?? "")?.[1]
  const fallback = column.type ? typeLayouts[column.type] : undefined
  const layout = column.layout ?? (legacySpacing ? undefined : fallback)
  const min = layout?.min ?? (legacySpacing ? Number(legacySpacing) / 4 : 6)
  const max = Math.max(min, layout?.max ?? Infinity)
  return {
    min,
    preferred: Math.max(min, Math.min(max, layout?.preferred ?? min)),
    max,
    grow: Math.max(0, layout?.grow ?? (layout ? 0 : 1)),
  }
}

/** Allocate one native table track per column, independent of individual row content. */
export function allocateEntityColumnWidths(
  columns: readonly EntityColumn[],
  availableRem: number | undefined,
): number[] {
  const tracks = columns.map(getTrack)
  const minTotal = tracks.reduce((total, track) => total + track.min, 0)
  const preferredTotal = tracks.reduce((total, track) => total + track.preferred, 0)
  const available = availableRem ?? preferredTotal

  if (available < preferredTotal) {
    if (preferredTotal === minTotal) return tracks.map((track) => track.min)
    const fraction = Math.max(0, available - minTotal) / (preferredTotal - minTotal)
    return tracks.map((track) => track.min + (track.preferred - track.min) * fraction)
  }

  const widths = tracks.map((track) => track.preferred)
  let spare = available - preferredTotal
  let flexible = tracks.flatMap((track, index) =>
    track.grow > 0 && track.preferred < track.max ? [index] : [],
  )
  while (spare > 0.001 && flexible.length > 0) {
    const totalGrow = flexible.reduce((total, index) => total + tracks[index]!.grow, 0)
    const share = spare / totalGrow
    for (const index of flexible) {
      const track = tracks[index]!
      const width = widths[index]!
      const growth = Math.min(track.max - width, track.grow * share)
      widths[index] = width + growth
      spare -= growth
    }
    flexible = flexible.filter((index) => widths[index]! < tracks[index]!.max)
  }
  return widths
}
