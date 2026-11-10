import { useEffect, useMemo, useRef, useState } from "react"
import {
  cellKey,
  inRange,
  intersectRanges,
  rangeOrigin,
  tileKey,
  tilesFor,
  TILE_COLUMNS,
  TILE_ROWS,
  type SpreadsheetCell,
  type SpreadsheetRange,
  type SpreadsheetRect,
  type SpreadsheetSheet,
  type SpreadsheetSource,
} from "./spreadsheet-grid-model"

const TILE_CACHE_LIMIT = 48

export function useSheetTiles(
  source: SpreadsheetSource,
  sheet: SpreadsheetSheet,
  visible: SpreadsheetRect,
  onReadError: (error: unknown) => void,
) {
  const [cache, setCache] = useState(() => new Map<string, SpreadsheetRange>())
  const cacheRef = useRef(cache)
  cacheRef.current = cache
  const onError = useRef(onReadError)
  onError.current = onReadError

  // Keep a request alive while scrolling inside the same set of tiles.
  const firstRow = Math.floor(visible.rowStart / TILE_ROWS) * TILE_ROWS
  const firstColumn =
    Math.floor(visible.columnStart / TILE_COLUMNS) * TILE_COLUMNS
  const lastRow =
    Math.ceil((visible.rowStart + visible.rowCount) / TILE_ROWS) * TILE_ROWS
  const lastColumn =
    Math.ceil((visible.columnStart + visible.columnCount) / TILE_COLUMNS) *
    TILE_COLUMNS
  const requests = useMemo(() => {
    const coverage = {
      rowStart: firstRow,
      columnStart: firstColumn,
      rowCount: lastRow - firstRow,
      columnCount: lastColumn - firstColumn,
    }
    const tiles = tilesFor(coverage, sheet).map((rect) => ({
      rect,
      key: tileKey(rect),
    }))
    // A merged cell can start far above or to the left of the viewport.
    const anchors = (sheet.merges ?? []).flatMap((merge) =>
      intersectRanges(merge, coverage) && !inRange(rangeOrigin(merge), coverage)
        ? [
            {
              rect: { ...merge, rowCount: 1, columnCount: 1 },
              key: `merge:${tileKey(merge)}`,
            },
          ]
        : [],
    )
    return [...tiles, ...anchors]
  }, [sheet, firstRow, firstColumn, lastRow, lastColumn])

  useEffect(() => {
    const controller = new AbortController()
    const missing = requests.filter(({ key }) => !cacheRef.current.has(key))
    const active = new Set(requests.map(({ key }) => key))
    async function load() {
      // Bound the number of concurrent parse/range requests as the user scrolls.
      for (
        let index = 0;
        index < missing.length && !controller.signal.aborted;
        index += 4
      ) {
        const loaded = await Promise.all(
          missing
            .slice(index, index + 4)
            .map(
              async ({ key, rect }) =>
                [
                  key,
                  await source.readRange(sheet.id, rect, controller.signal),
                ] as const,
            ),
        )
        if (controller.signal.aborted) return
        setCache((previous) => {
          const next = new Map(previous)
          for (const [key, range] of loaded) next.set(key, range)
          for (const key of next.keys()) {
            if (next.size <= TILE_CACHE_LIMIT) break
            if (!active.has(key)) next.delete(key)
          }
          return next
        })
      }
    }
    void load().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        controller.abort()
        setCache(new Map())
        onError.current(error)
      }
    })
    return () => controller.abort()
  }, [source, sheet.id, requests])

  const { cells, merges } = useMemo(() => {
    const cells = new Map<string, SpreadsheetCell>()
    const merges = new Map(
      (sheet.merges ?? []).map((merge) => [tileKey(merge), merge]),
    )
    for (const range of cache.values()) {
      for (const cell of range.cells) cells.set(cellKey(cell), cell)
      for (const merge of range.merges ?? []) merges.set(tileKey(merge), merge)
    }
    return { cells, merges }
  }, [cache, sheet.merges])
  return {
    cells,
    merges,
    cache,
    loading: requests.some(({ key }) => !cache.has(key)),
  }
}
