"use client"

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react"
import {
  ChevronDown,
  ChevronUp,
  Clipboard,
  Expand,
  ListChecks,
  Maximize2,
  Minimize2,
  Search,
  Sparkles,
} from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import { cn } from "@lumiere/ui/lib/utils"
import {
  cellKey,
  cellLabel,
  columnAt,
  columnLabel,
  inRange,
  intersectRanges,
  MAX_COPY_CELLS,
  rangeBetween,
  rangeEnd,
  rangeOrigin,
  selectionChunks,
  serializeSpreadsheetSelection,
  tileKey,
  tilesFor,
  type SpreadsheetAction,
  type SpreadsheetCell,
  type SpreadsheetPoint,
  type SpreadsheetRect,
  type SpreadsheetSelection,
  type SpreadsheetSheet,
  type SpreadsheetSource,
} from "./spreadsheet-grid-model"
import { useSheetTiles } from "./use-spreadsheet-tiles"

export type {
  SpreadsheetAction,
  SpreadsheetSelection,
  SpreadsheetSource,
} from "./spreadsheet-grid-model"

const HEADER_HEIGHT = 30
const ROW_HEIGHT = 28
const MAX_SCROLL_HEIGHT = 8_000_000
const ROW_GUTTER = 64
const COLUMN_WIDTH = 152
const MIN_COLUMN_WIDTH = 76
const MAX_COLUMN_WIDTH = 640
const ORIGIN: SpreadsheetPoint = { row: 0, column: 0 }

type Selection = { anchor: SpreadsheetPoint; focus: SpreadsheetPoint }
type Viewport = { top: number; left: number; height: number; width: number }

type SpreadsheetGridProps = {
  source: SpreadsheetSource
  label: string
  fullscreen: boolean
  onFullscreenChange(fullscreen: boolean): void
  onReadError(error: unknown): void
  onSelectionAction?(
    action: SpreadsheetAction,
    selection: SpreadsheetSelection,
    signal: AbortSignal,
  ): Promise<void>
  options?: ReactNode
  /** Header text augments the column coordinate without changing source row numbering. */
  columnHeading?(column: number): string | undefined
}

export function SpreadsheetGrid(props: SpreadsheetGridProps) {
  const { source, options, fullscreen, onFullscreenChange } = props
  const { t } = useTranslation()
  const [sheetId, setSheetId] = useState<string>()
  const sheets = source.sheets
  const sheet =
    sheets.find((item) => item.id === sheetId) ??
    sheets.find((item) => !item.visibility || item.visibility === "visible") ??
    sheets[0]
  const sheetLabel = t("documents.spreadsheet.sheet", {
    defaultValue: "Sheet",
  })

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border bg-background"
      aria-label={props.label}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/30 px-2 py-2 sm:px-3">
        {sheet ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium sm:flex-none">
            <span>{sheetLabel}</span>
            {sheets.length > 1 ? (
              <Select
                value={sheet.id}
                onValueChange={(value) => {
                  if (value !== null) setSheetId(value)
                }}
              >
                <SelectTrigger
                  aria-label={sheetLabel}
                  className="h-8 min-w-0 max-w-48"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sheets.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.visibility && item.visibility !== "visible"
                        ? t("documents.spreadsheet.hiddenSheet", {
                            defaultValue: "{{name}} (hidden)",
                            name: item.name,
                          })
                        : item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="min-w-0 truncate font-medium">{sheet.name}</span>
            )}
          </div>
        ) : null}
        {options}
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          className="ml-auto"
          aria-label={
            fullscreen
              ? t("documents.spreadsheet.exitFullscreen", {
                  defaultValue: "Exit full screen",
                })
              : t("documents.spreadsheet.fullscreen", {
                  defaultValue: "Full screen",
                })
          }
          title={
            fullscreen
              ? t("documents.spreadsheet.exitFullscreen", {
                  defaultValue: "Exit full screen",
                })
              : t("documents.spreadsheet.fullscreen", {
                  defaultValue: "Full screen",
                })
          }
          onClick={() => onFullscreenChange(!fullscreen)}
        >
          {fullscreen ? (
            <Minimize2 aria-hidden="true" />
          ) : (
            <Maximize2 aria-hidden="true" />
          )}
        </Button>
      </div>
      {sheet && sheet.rowCount > 0 && sheet.columnCount > 0 ? (
        <WorksheetGrid key={sheet.id} {...props} sheet={sheet} />
      ) : (
        <div
          role="status"
          className="grid flex-1 place-items-center p-4 text-center text-sm text-muted-foreground"
        >
          {sheet
            ? t("documents.spreadsheet.emptySheet", {
                defaultValue: "This sheet is empty.",
              })
            : t("documents.spreadsheet.noSheets", {
                defaultValue: "This workbook has no sheets.",
              })}
        </div>
      )}
    </section>
  )
}

function WorksheetGrid({
  source,
  sheet,
  label,
  onReadError,
  onSelectionAction,
  columnHeading,
}: SpreadsheetGridProps & { sheet: SpreadsheetSheet }) {
  const { t } = useTranslation()
  const id = useId()
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const [viewport, setViewport] = useState<Viewport>({
    top: 0,
    left: 0,
    height: 400,
    width: 700,
  })
  const [widths, setWidths] = useState<Record<number, number>>({})
  const [selection, setSelection] = useState<Selection | null>(null)
  const [detail, setDetail] = useState(false)
  const [extendTouchSelection, setExtendTouchSelection] = useState(false)
  const [query, setQuery] = useState("")
  const [match, setMatch] = useState<SpreadsheetPoint | null>(null)
  const [searchStatus, setSearchStatus] = useState("")
  const [operation, setOperation] = useState<string | null>(null)
  const [status, setStatus] = useState("")
  const searchRequest = useRef<AbortController | null>(null)
  const selectionRequest = useRef<AbortController | null>(null)
  const pendingTap = useRef(false)
  const dragging = useRef<{ pointer: number; anchor: SpreadsheetPoint } | null>(
    null,
  )
  const resize = useRef<{ pointer: number; x: number; width: number } | null>(
    null,
  )

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const measure = () => {
      setViewport({
        top: scroller.scrollTop,
        left: scroller.scrollLeft,
        height: scroller.clientHeight || 400,
        width: scroller.clientWidth || 700,
      })
    }
    measure()
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(scroller)
    scroller.addEventListener("scroll", measure, { passive: true })
    return () => {
      observer?.disconnect()
      scroller.removeEventListener("scroll", measure)
      searchRequest.current?.abort()
      selectionRequest.current?.abort()
    }
  }, [])

  const offsets = useMemo(() => {
    const positions = [0]
    for (let column = 0; column < sheet.columnCount; column++) {
      positions.push(positions[column]! + (widths[column] ?? COLUMN_WIDTH))
    }
    return positions
  }, [sheet.columnCount, widths])
  const sheetHeight = sheet.rowCount * ROW_HEIGHT + HEADER_HEIGHT
  const scrollHeight = Math.min(sheetHeight, MAX_SCROLL_HEIGHT)
  // Cap the physical track below browser layout limits while keeping real row heights.
  const scrollScale =
    sheetHeight > scrollHeight
      ? (sheetHeight - viewport.height) /
        Math.max(1, scrollHeight - viewport.height)
      : 1
  const sheetTop = viewport.top * scrollScale
  const rowOffset = viewport.top - sheetTop
  const firstVisibleRow = Math.floor(sheetTop / ROW_HEIGHT)
  const lastVisibleRow = Math.min(
    sheet.rowCount - 1,
    Math.floor(
      (sheetTop + Math.max(0, viewport.height - HEADER_HEIGHT - 1)) /
        ROW_HEIGHT,
    ),
  )
  const firstVisibleColumn = columnAt(offsets, viewport.left)
  const lastVisibleColumn = columnAt(
    offsets,
    viewport.left + Math.max(0, viewport.width - ROW_GUTTER - 1),
  )
  const rowStart = Math.max(0, firstVisibleRow - 5)
  const columnStart = Math.max(0, firstVisibleColumn - 2)
  const visible = {
    rowStart,
    rowCount: Math.min(sheet.rowCount - 1, lastVisibleRow + 5) - rowStart + 1,
    columnStart,
    columnCount:
      Math.min(sheet.columnCount - 1, lastVisibleColumn + 2) - columnStart + 1,
  }
  const { cells, merges, cache, loading } = useSheetTiles(
    source,
    sheet,
    visible,
    onReadError,
  )
  const mergeAt = (point: SpreadsheetPoint) => {
    for (const merge of merges.values()) if (inRange(point, merge)) return merge
  }
  const visibleMerges = new Map<
    string,
    { merge: SpreadsheetRect; clipped: SpreadsheetRect }
  >()
  for (const merge of merges.values()) {
    const clipped = intersectRanges(merge, visible)
    if (!clipped) continue
    const entry = { merge, clipped }
    for (
      let row = clipped.rowStart;
      row < clipped.rowStart + clipped.rowCount;
      row++
    ) {
      for (
        let column = clipped.columnStart;
        column < clipped.columnStart + clipped.columnCount;
        column++
      ) {
        visibleMerges.set(cellKey({ row, column }), entry)
      }
    }
  }

  let rect = selection ? rangeBetween(selection.anchor, selection.focus) : null
  if (rect && selection) {
    // A merged cell occupies its full rectangle when selected.
    for (const point of [selection.anchor, selection.focus]) {
      const merge = mergeAt(point)
      if (!merge) continue
      const start = rangeOrigin(rect)
      const end = rangeEnd(rect)
      const mergeEnd = rangeEnd(merge)
      rect = rangeBetween(
        {
          row: Math.min(start.row, merge.rowStart),
          column: Math.min(start.column, merge.columnStart),
        },
        {
          row: Math.max(end.row, mergeEnd.row),
          column: Math.max(end.column, mergeEnd.column),
        },
      )
    }
  }
  const focus = selection?.focus
  const focusCell = focus ? cells.get(cellKey(focus)) : undefined
  const columns = Array.from(
    { length: visible.columnCount },
    (_, index) => columnStart + index,
  )
  const rows = Array.from(
    { length: visible.rowCount },
    (_, index) => rowStart + index,
  )
  const rangeLabel =
    rect && selection
      ? cellLabel({ row: rect.rowStart, column: rect.columnStart }) +
        (rect.rowCount === 1 && rect.columnCount === 1
          ? ""
          : `:${cellLabel({ row: rect.rowStart + rect.rowCount - 1, column: rect.columnStart + rect.columnCount - 1 })}`)
      : ""
  const copyable = rect && rect.rowCount * rect.columnCount <= MAX_COPY_CELLS
  const focusedMerge = focus ? mergeAt(focus) : undefined
  const focusId =
    focus &&
    (inRange(focus, visible) ||
      (focusedMerge && intersectRanges(focusedMerge, visible)))
      ? `${id}-${cellKey(focus)}`
      : undefined

  function reveal(point: SpreadsheetPoint) {
    const node = scrollRef.current
    if (!node) return
    const rowTop = point.row * ROW_HEIGHT
    const colLeft = offsets[point.column]!
    const colRight = offsets[point.column + 1]!
    const availableHeight = Math.max(
      ROW_HEIGHT,
      node.clientHeight - HEADER_HEIGHT,
    )
    const availableWidth = Math.max(
      MIN_COLUMN_WIDTH,
      node.clientWidth - ROW_GUTTER,
    )
    const currentTop = node.scrollTop * scrollScale
    if (rowTop < currentTop) node.scrollTop = rowTop / scrollScale
    else if (rowTop + ROW_HEIGHT > currentTop + availableHeight)
      node.scrollTop = (rowTop + ROW_HEIGHT - availableHeight) / scrollScale
    if (colLeft < node.scrollLeft || colRight - colLeft > availableWidth)
      node.scrollLeft = colLeft
    else if (colRight > node.scrollLeft + availableWidth)
      node.scrollLeft = colRight - availableWidth
  }

  function selectionPoint(point: SpreadsheetPoint): SpreadsheetPoint {
    const merge = mergeAt(point)
    return merge ? rangeOrigin(merge) : point
  }

  function select(point: SpreadsheetPoint, extend = false) {
    point = selectionPoint(point)
    setSelection((previous) => ({
      anchor: extend ? (previous?.anchor ?? ORIGIN) : point,
      focus: point,
    }))
    setStatus("")
  }

  function pointFromPointer(
    event: PointerEvent<HTMLDivElement>,
  ): SpreadsheetPoint {
    const node = event.currentTarget
    const bounds = node.getBoundingClientRect()
    const top =
      event.clientY - bounds.top + node.scrollTop * scrollScale - HEADER_HEIGHT
    const left = event.clientX - bounds.left + node.scrollLeft - ROW_GUTTER
    return {
      row: Math.max(
        0,
        Math.min(sheet.rowCount - 1, Math.floor(top / ROW_HEIGHT)),
      ),
      column: columnAt(offsets, left),
    }
  }

  async function find(direction: "next" | "previous") {
    const search = query.trim()
    if (!search) return
    if (new TextEncoder().encode(search).length > 256) {
      setSearchStatus(
        t("documents.spreadsheet.searchTooLong", {
          defaultValue: "Enter a shorter search term.",
        }),
      )
      return
    }
    searchRequest.current?.abort()
    const controller = new AbortController()
    searchRequest.current = controller
    setSearchStatus(
      t("documents.spreadsheet.searching", { defaultValue: "Searching…" }),
    )
    try {
      const result = await source.search(
        sheet.id,
        search,
        match,
        direction,
        controller.signal,
      )
      if (controller.signal.aborted) return
      setMatch(result.match)
      if (!result.match) {
        setSearchStatus(
          t("documents.spreadsheet.noMatches", { defaultValue: "No matches" }),
        )
        return
      }
      const address = cellLabel(result.match)
      setSearchStatus(
        result.wrapped
          ? t("documents.spreadsheet.wrapped", {
              defaultValue: "{{address}} · Wrapped",
              address,
            })
          : address,
      )
      select(result.match)
      reveal(result.match)
    } catch (error) {
      if (!controller.signal.aborted) onReadError(error)
    }
  }

  function cachedSelection() {
    return rect &&
      tilesFor(rect, sheet).every((tile) => cache.has(tileKey(tile)))
      ? serializeSpreadsheetSelection(sheet.name, rect, cells)
      : null
  }

  async function act(action: SpreadsheetAction | "copy") {
    if (!rect || !copyable || operation) return
    const controller = new AbortController()
    selectionRequest.current?.abort()
    selectionRequest.current = controller
    setOperation(action)
    setStatus("")
    try {
      let payload = cachedSelection()
      if (!payload) {
        const selectedCells = new Map<string, SpreadsheetCell>()
        for (const chunk of selectionChunks(rect)) {
          if (controller.signal.aborted) return
          const range = await source.readRange(
            sheet.id,
            chunk,
            controller.signal,
          )
          for (const cell of range.cells) selectedCells.set(cellKey(cell), cell)
        }
        payload = serializeSpreadsheetSelection(sheet.name, rect, selectedCells)
      }
      if (controller.signal.aborted) return
      if (!payload) {
        setStatus(
          t("documents.spreadsheet.copyTooLarge", {
            defaultValue:
              "This selection is too large. Select a smaller range.",
          }),
        )
        return
      }
      try {
        if (action === "copy") {
          await navigator.clipboard.writeText(payload.text)
          if (!controller.signal.aborted)
            setStatus(
              t("documents.spreadsheet.copied", {
                defaultValue: "Selection copied",
              }),
            )
        } else {
          await onSelectionAction?.(action, payload, controller.signal)
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setStatus(
            action !== "copy" && error instanceof Error
              ? error.message
              : t("documents.spreadsheet.actionFailed", {
                  defaultValue: "The action could not be completed. Try again.",
                }),
          )
      }
    } catch (error) {
      if (!controller.signal.aborted) onReadError(error)
    } finally {
      if (!controller.signal.aborted) setOperation(null)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.altKey) return
    const current = focus ?? ORIGIN
    let { row, column } = current
    const jump = event.ctrlKey || event.metaKey
    const end = focusedMerge ? rangeEnd(focusedMerge) : current
    switch (event.key) {
      case "f":
        if (!jump) return
        event.preventDefault()
        searchInput.current?.focus()
        searchInput.current?.select()
        return
      case "ArrowUp":
        row = jump ? 0 : row - 1
        break
      case "ArrowDown":
        row = jump ? sheet.rowCount - 1 : end.row + 1
        break
      case "ArrowLeft":
        column = jump ? 0 : column - 1
        break
      case "ArrowRight":
        column = jump ? sheet.columnCount - 1 : end.column + 1
        break
      case "Home":
        column = 0
        if (jump) row = 0
        break
      case "End":
        column = sheet.columnCount - 1
        if (jump) row = sheet.rowCount - 1
        break
      case "PageUp":
        row -= Math.max(1, lastVisibleRow - firstVisibleRow)
        break
      case "PageDown":
        row += Math.max(1, lastVisibleRow - firstVisibleRow)
        break
      case "Enter":
        event.preventDefault()
        if (!focus) select(ORIGIN)
        setDetail((shown) => !shown)
        return
      default:
        return
    }
    event.preventDefault()
    const point = selectionPoint({
      row: Math.max(0, Math.min(sheet.rowCount - 1, row)),
      column: Math.max(0, Math.min(sheet.columnCount - 1, column)),
    })
    select(point, event.shiftKey)
    reveal(point)
  }

  const formula = focusCell?.formula
  const actions = [
    {
      id: "explain",
      label: t("documents.spreadsheet.explain", { defaultValue: "Explain" }),
      Icon: Sparkles,
    },
    {
      id: "check",
      label: t("documents.spreadsheet.check", { defaultValue: "Check" }),
      Icon: ListChecks,
    },
    {
      id: "prepare",
      label: t("documents.spreadsheet.prepare", {
        defaultValue: "Prepare import",
      }),
      Icon: Clipboard,
    },
  ] as const

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-2 sm:px-3">
        <form
          className="flex min-w-0 flex-1 items-center gap-1 sm:flex-none"
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            void find("next")
          }}
        >
          <div className="relative min-w-20 flex-1 sm:w-48">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-2 left-2 size-4 text-muted-foreground"
            />
            <input
              ref={searchInput}
              type="search"
              maxLength={256}
              value={query}
              aria-label={t("documents.spreadsheet.find", {
                defaultValue: "Find in sheet",
              })}
              placeholder={t("documents.spreadsheet.find", {
                defaultValue: "Find in sheet",
              })}
              className="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) => {
                searchRequest.current?.abort()
                setQuery(event.target.value)
                setMatch(null)
                setSearchStatus("")
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.shiftKey) {
                  event.preventDefault()
                  void find("previous")
                }
              }}
            />
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={!query.trim()}
            aria-label={t("documents.spreadsheet.previousMatch", {
              defaultValue: "Previous match",
            })}
            onClick={() => void find("previous")}
          >
            <ChevronUp aria-hidden="true" />
          </Button>
          <Button
            type="submit"
            size="icon-sm"
            variant="ghost"
            disabled={!query.trim()}
            aria-label={t("documents.spreadsheet.nextMatch", {
              defaultValue: "Next match",
            })}
          >
            <ChevronDown aria-hidden="true" />
          </Button>
        </form>
        <span
          role="status"
          className="text-xs tabular-nums text-muted-foreground"
        >
          {searchStatus}
        </span>
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-2 border-b bg-muted/20 px-2 py-1 sm:px-3">
        <span className="min-w-12 shrink-0 border-r pr-2 font-mono text-xs tabular-nums">
          {rangeLabel || "—"}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-sm"
          title={formula ?? focusCell?.displayValue}
        >
          {formula
            ? formula.startsWith("=")
              ? formula
              : `=${formula}`
            : focusCell?.displayValue}
        </span>
        <Button
          type="button"
          size="sm"
          variant={extendTouchSelection ? "secondary" : "ghost"}
          className="hidden pointer-coarse:inline-flex"
          disabled={!focus}
          aria-pressed={extendTouchSelection}
          onClick={() => setExtendTouchSelection((enabled) => !enabled)}
        >
          {t("documents.spreadsheet.extendSelection", {
            defaultValue: "Extend selection",
          })}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={!focus}
          aria-expanded={detail && !!focus}
          aria-label={t("documents.spreadsheet.cellDetails", {
            defaultValue: "Cell details",
          })}
          title={t("documents.spreadsheet.cellDetails", {
            defaultValue: "Cell details",
          })}
          onClick={() => setDetail((shown) => !shown)}
        >
          <Expand aria-hidden="true" />
        </Button>
      </div>
      {detail && focus ? (
        <div
          className="max-h-[22dvh] shrink-0 overflow-auto border-b px-3 py-2 text-sm"
          aria-label={t("documents.spreadsheet.cellDetails", {
            defaultValue: "Cell details",
          })}
        >
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {focusCell?.displayValue ||
              (focusCell?.formulaStatus === "missing"
                ? t("documents.spreadsheet.noCachedValue", {
                    defaultValue: "This formula has no saved result.",
                  })
                : t("documents.spreadsheet.emptyCell", {
                    defaultValue: "Empty cell",
                  }))}
          </p>
          {formula ? (
            <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {formula.startsWith("=") ? formula : `=${formula}`}
            </p>
          ) : null}
          {focusCell?.formulaStatus === "cached" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("documents.spreadsheet.savedFormulaValue", {
                defaultValue: "Saved formula result",
              })}
            </p>
          ) : null}
          {focusCell?.formatStatus === "raw" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("documents.spreadsheet.rawFormat", {
                defaultValue:
                  "Raw value shown. This number format is unavailable in the preview.",
              })}
            </p>
          ) : null}
          {focusCell?.value != null &&
          String(focusCell.value) !== focusCell.displayValue ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {t("documents.spreadsheet.rawValue", {
                defaultValue: "Raw value: {{value}}",
                value: String(focusCell.value),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain outline-none [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        role="grid"
        tabIndex={0}
        aria-label={label}
        aria-readonly="true"
        aria-rowcount={sheet.rowCount + 1}
        aria-colcount={sheet.columnCount + 1}
        aria-multiselectable="true"
        aria-activedescendant={focusId}
        aria-busy={loading}
        onFocus={(event) => {
          if (event.target === event.currentTarget && !focus) select(ORIGIN)
        }}
        onKeyDown={onKeyDown}
        onCopy={(event) => {
          event.preventDefault()
          const payload = cachedSelection()
          if (payload) {
            event.clipboardData.setData("text/plain", payload.text)
            setStatus(
              t("documents.spreadsheet.copied", {
                defaultValue: "Selection copied",
              }),
            )
          } else if (copyable) {
            void act("copy")
          }
        }}
        onPointerMove={(event) => {
          if (dragging.current?.pointer === event.pointerId) {
            const point = selectionPoint(pointFromPointer(event))
            setSelection({ anchor: dragging.current.anchor, focus: point })
          }
        }}
        onLostPointerCapture={(event) => {
          if (dragging.current?.pointer === event.pointerId)
            dragging.current = null
        }}
      >
        <div
          className="relative min-w-full overflow-clip"
          style={{
            width: offsets[sheet.columnCount]! + ROW_GUTTER,
            height: scrollHeight,
          }}
        >
          <div
            role="row"
            aria-rowindex={1}
            className="sticky top-0 z-20 border-b bg-muted"
            style={{ height: HEADER_HEIGHT }}
          >
            <div
              role="columnheader"
              aria-label={t("documents.spreadsheet.rowNumbers", {
                defaultValue: "Row numbers",
              })}
              aria-colindex={1}
              className="sticky left-0 z-10 flex h-full items-center justify-center border-r bg-muted text-xs text-muted-foreground"
              style={{ width: ROW_GUTTER }}
            >
              #
            </div>
            {columns.map((column) => {
              const width = widths[column] ?? COLUMN_WIDTH
              const name = columnLabel(column)
              const heading = columnHeading?.(column)
              const resizeLabel = t("documents.spreadsheet.resizeColumn", {
                defaultValue: "Resize column {{column}}",
                column: name,
              })
              return (
                <div
                  key={column}
                  role="columnheader"
                  aria-colindex={column + 2}
                  className="absolute top-0 flex h-full items-center justify-center gap-2 border-r px-3 text-xs font-medium"
                  style={{ left: offsets[column]! + ROW_GUTTER, width }}
                >
                  <span
                    className={cn(
                      "shrink-0 tabular-nums",
                      heading && "text-muted-foreground",
                    )}
                  >
                    {name}
                  </span>
                  {heading ? (
                    <span title={heading} className="truncate">
                      {heading}
                    </span>
                  ) : null}
                  <div
                    role="separator"
                    tabIndex={0}
                    aria-label={resizeLabel}
                    aria-orientation="vertical"
                    aria-valuemin={MIN_COLUMN_WIDTH}
                    aria-valuemax={MAX_COLUMN_WIDTH}
                    aria-valuenow={width}
                    className="absolute inset-y-0 -right-1 z-10 w-3 cursor-col-resize touch-none outline-none hover:bg-primary/25 focus-visible:bg-primary/40"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return
                      event.preventDefault()
                      event.currentTarget.setPointerCapture(event.pointerId)
                      resize.current = {
                        pointer: event.pointerId,
                        x: event.clientX,
                        width,
                      }
                    }}
                    onPointerMove={(event) => {
                      const active = resize.current
                      if (active?.pointer !== event.pointerId) return
                      const next = Math.max(
                        MIN_COLUMN_WIDTH,
                        Math.min(
                          MAX_COLUMN_WIDTH,
                          active.width + event.clientX - active.x,
                        ),
                      )
                      setWidths((previous) => ({
                        ...previous,
                        [column]: next,
                      }))
                    }}
                    onLostPointerCapture={() => {
                      resize.current = null
                    }}
                    onDoubleClick={() =>
                      setWidths((previous) => ({
                        ...previous,
                        [column]: COLUMN_WIDTH,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (
                        event.key !== "ArrowLeft" &&
                        event.key !== "ArrowRight"
                      )
                        return
                      event.preventDefault()
                      const next = Math.max(
                        MIN_COLUMN_WIDTH,
                        Math.min(
                          MAX_COLUMN_WIDTH,
                          width + (event.key === "ArrowRight" ? 16 : -16),
                        ),
                      )
                      setWidths((previous) => ({
                        ...previous,
                        [column]: next,
                      }))
                    }}
                  />
                </div>
              )
            })}
          </div>
          {rows.map((row) => (
            <div
              key={row}
              role="row"
              aria-rowindex={row + 2}
              className="absolute left-0 w-full"
              style={{
                top: HEADER_HEIGHT + row * ROW_HEIGHT + rowOffset,
                height: ROW_HEIGHT,
              }}
            >
              <div
                role="rowheader"
                aria-colindex={1}
                className="sticky left-0 z-10 flex h-full items-center justify-end border-b border-r bg-muted pr-3 text-xs tabular-nums text-muted-foreground"
                style={{ width: ROW_GUTTER }}
              >
                {row + 1}
              </div>
              {columns.map((column) => {
                const entry = visibleMerges.get(cellKey({ row, column }))
                if (
                  entry &&
                  (row !== entry.clipped.rowStart ||
                    column !== entry.clipped.columnStart)
                )
                  return null
                const merge = entry?.merge
                const point = merge ? rangeOrigin(merge) : { row, column }
                const key = cellKey(point)
                const cell = cells.get(key)
                const isFocus =
                  focus?.row === point.row && focus.column === point.column
                const selected =
                  !!rect &&
                  (merge
                    ? !!intersectRanges(rect, merge)
                    : inRange(point, rect))
                const columnEnd = entry
                  ? entry.clipped.columnStart + entry.clipped.columnCount
                  : column + 1
                const height = (entry?.clipped.rowCount ?? 1) * ROW_HEIGHT
                return (
                  <div
                    key={column}
                    id={`${id}-${key}`}
                    role="gridcell"
                    aria-colindex={column + 2}
                    aria-colspan={
                      entry && entry.clipped.columnCount > 1
                        ? entry.clipped.columnCount
                        : undefined
                    }
                    aria-rowspan={
                      entry && entry.clipped.rowCount > 1
                        ? entry.clipped.rowCount
                        : undefined
                    }
                    aria-selected={selected}
                    className={cn(
                      "absolute top-0 cursor-cell select-none truncate border-b border-r px-2 leading-[27px] whitespace-nowrap",
                      merge && "z-[2] bg-background",
                      selected ? "bg-primary/10" : "hover:bg-muted/60",
                      isFocus && "z-[3] ring-2 ring-primary ring-inset",
                      !merge &&
                        (cell?.kind === "number" || cell?.kind === "date") &&
                        "text-right tabular-nums",
                      cell?.kind === "error" && "text-destructive",
                    )}
                    style={{
                      left: offsets[column]! + ROW_GUTTER,
                      width: offsets[columnEnd]! - offsets[column]!,
                      height,
                      paddingTop: merge
                        ? Math.max(0, sheetTop - row * ROW_HEIGHT)
                        : undefined,
                      paddingLeft: merge
                        ? Math.max(8, viewport.left - offsets[column]! + 8)
                        : undefined,
                    }}
                    data-merged={merge ? true : undefined}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return
                      pendingTap.current = event.pointerType === "touch"
                      // A touch gesture may become a native scroll instead of a tap.
                      if (pendingTap.current) return
                      const node = scrollRef.current
                      if (node && event.pointerType === "mouse") {
                        event.preventDefault()
                        node.focus({ preventScroll: true })
                      }
                      const extend = event.shiftKey || extendTouchSelection
                      select(point, extend)
                      if (
                        event.pointerType === "mouse" &&
                        typeof event.currentTarget.setPointerCapture ===
                          "function"
                      ) {
                        event.currentTarget.setPointerCapture(event.pointerId)
                        dragging.current = {
                          pointer: event.pointerId,
                          anchor: extend
                            ? (selection?.anchor ?? ORIGIN)
                            : point,
                        }
                      }
                    }}
                    onClick={(event) => {
                      if (event.detail === 0 || pendingTap.current)
                        select(point, event.shiftKey || extendTouchSelection)
                      pendingTap.current = false
                    }}
                    onDoubleClick={() => {
                      select(point)
                      setDetail(true)
                    }}
                  >
                    {cell?.displayValue}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t bg-muted/20 px-2 py-1 sm:px-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-xs tabular-nums text-muted-foreground">
          <span>
            {t("documents.spreadsheet.size", {
              defaultValue: "{{rows}} rows · {{columns}} columns",
              rows: sheet.rowCount.toLocaleString(),
              columns: sheet.columnCount.toLocaleString(),
            })}
          </span>
          <span role="status">
            {status ||
              (loading
                ? t("documents.spreadsheet.loadingCells", {
                    defaultValue: "Loading cells…",
                  })
                : rect && !copyable
                  ? t("documents.spreadsheet.copyTooLarge", {
                      defaultValue:
                        "This selection is too large. Select a smaller range.",
                    })
                  : "")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!copyable || !!operation}
            onClick={() => void act("copy")}
          >
            <Clipboard aria-hidden="true" />
            {t("documents.spreadsheet.copy", { defaultValue: "Copy" })}
          </Button>
          {onSelectionAction
            ? actions.map(({ id: action, label, Icon }) => (
                <Button
                  key={action}
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!copyable || !!operation}
                  onClick={() => void act(action)}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </Button>
              ))
            : null}
        </div>
      </div>
    </>
  )
}
