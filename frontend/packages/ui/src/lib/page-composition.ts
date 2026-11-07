import type { PersonalPageWidgetPlacement } from "@lumiere/presentation-core/personal-page-layout"
import type { ReactNode } from "react"
import type {
  DashboardSection,
  DashboardWidget,
  GridWidth,
} from "./dashboard-types"
import type { ReportExportSourceProvenance } from "./report-export-provenance"

/** A page owns placement; the referenced widget continues to own its data binding. */
export type PageWidgetPlacement = PersonalPageWidgetPlacement
export type PageWidgetWidth = PageWidgetPlacement["width"]
export const PAGE_WIDGET_WIDTHS = [
  3, 4, 6, 8, 12,
] as const satisfies readonly PageWidgetWidth[]

export interface PageWidgetCatalogItem {
  source: PageWidgetPlacement["source"]
  widgetId: string
  title: string
  description?: string
  category?: string
  defaultWidth?: PageWidgetWidth
  widget?: DashboardWidget
  unavailableReason?: string
  configurable?: boolean
  exportProvenance?: ReportExportSourceProvenance
}

/** Null follows the module template; an empty array is an intentionally empty page. */
export type PageCompositionValue = readonly PageWidgetPlacement[] | null

export interface PageCompositionRequest {
  id: string
  kind: "edit_page" | "add_widget"
  widgetKey?: string
  prompt?: string
}

export function pageWidgetKey(
  widget: Pick<PageWidgetPlacement, "source" | "widgetId">,
): string {
  return `${widget.source}:${widget.widgetId}`
}

export function findBuiltinPagePlacement(
  placements: readonly PageWidgetPlacement[],
  item: Pick<PageWidgetPlacement, "source" | "widgetId">,
): PageWidgetPlacement | undefined {
  return item.source === "builtin"
    ? placements.find(
        (placement) =>
          placement.source === "builtin" &&
          placement.widgetId === item.widgetId,
      )
    : undefined
}

export const pageWidgetWidthClasses: Record<PageWidgetWidth, string> = {
  3: "col-span-12 md:col-span-6 xl:col-span-3",
  4: "col-span-12 md:col-span-6 lg:col-span-4",
  6: "col-span-12 md:col-span-6",
  8: "col-span-12 lg:col-span-8",
  12: "col-span-12",
}

const widths: Record<GridWidth, PageWidgetWidth> = {
  "1/4": 3,
  "1/3": 4,
  "1/2": 6,
  "2/3": 8,
  full: 12,
}

function PageContent({ data }: { data: unknown }): ReactNode {
  return data as ReactNode
}

/** Register trusted existing page content without duplicating its own heading or controls. */
export function createPageContentSection({
  id,
  title,
  content,
  width = "full",
}: {
  id: string
  title: string
  content: ReactNode
  width?: GridWidth
}): DashboardSection {
  return {
    id: `${id}-section`,
    title,
    widgets: [
      {
        id,
        type: "custom",
        title: "",
        useCard: false,
        width,
        component: PageContent,
        data: content,
      },
    ],
  }
}

export function createBuiltinWidgetCatalog(
  sections: readonly DashboardSection[],
): PageWidgetCatalogItem[] {
  const catalog = new Map<string, PageWidgetCatalogItem>()
  for (const section of sections) {
    for (const widget of section.widgets) {
      catalog.set(widget.id, {
        source: "builtin",
        widgetId: widget.id,
        title: widget.title || section.title || widget.id,
        category: section.title,
        defaultWidth: widths[widget.width],
        widget,
      })
    }
  }
  return Array.from(catalog.values())
}

export function createDefaultPageLayout(
  sections: readonly DashboardSection[],
): PageWidgetPlacement[] {
  return sections.flatMap((section) =>
    section.widgets.map((widget) => ({
      id: `builtin:${section.id}:${widget.id}`,
      source: "builtin" as const,
      widgetId: widget.id,
      width: widths[widget.width],
    })),
  )
}

export function createPageWidgetPlacement(
  item: PageWidgetCatalogItem,
  id: string = crypto.randomUUID(),
): PageWidgetPlacement {
  return {
    id,
    source: item.source,
    widgetId: item.widgetId,
    width: defaultPageWidgetWidth(item),
  }
}

export function defaultPageWidgetWidth(
  item: PageWidgetCatalogItem,
): PageWidgetWidth {
  return item.defaultWidth ?? (item.widget ? widths[item.widget.width] : 6)
}

export function pageLayoutsEqual(
  a: PageCompositionValue,
  b: PageCompositionValue,
): boolean {
  if (a === b) return true
  if (a === null || b === null || a.length !== b.length) return false
  return a.every((item, index) => {
    const other = b[index]
    return (
      other !== undefined &&
      item.id === other.id &&
      item.source === other.source &&
      item.widgetId === other.widgetId &&
      item.width === other.width
    )
  })
}

export function movePageWidget(
  widgets: readonly PageWidgetPlacement[],
  id: string,
  targetId: string,
): readonly PageWidgetPlacement[] {
  const from = widgets.findIndex((widget) => widget.id === id)
  const to = widgets.findIndex((widget) => widget.id === targetId)
  if (from < 0 || to < 0 || from === to) return widgets
  const result = [...widgets]
  const [moved] = result.splice(from, 1)
  if (!moved) return widgets
  result.splice(to, 0, moved)
  return result
}

export interface PageCompositionHistory {
  past: readonly PageCompositionValue[]
  present: PageCompositionValue
  future: readonly PageCompositionValue[]
}

export type PageCompositionHistoryAction =
  | { type: "start"; value: PageCompositionValue }
  | { type: "change"; value: PageCompositionValue }
  | { type: "undo" }
  | { type: "redo" }

export function createPageCompositionHistory(
  value: PageCompositionValue,
): PageCompositionHistory {
  return { past: [], present: value, future: [] }
}

/** Keep a bounded draft history; saving remains the adapter's responsibility. */
export function pageCompositionHistoryReducer(
  state: PageCompositionHistory,
  action: PageCompositionHistoryAction,
): PageCompositionHistory {
  switch (action.type) {
    case "start":
      return createPageCompositionHistory(action.value)
    case "change":
      return pageLayoutsEqual(state.present, action.value)
        ? state
        : {
            past: [...state.past, state.present].slice(-50),
            present: action.value,
            future: [],
          }
    case "undo": {
      if (state.past.length === 0) return state
      const present = state.past[state.past.length - 1] ?? null
      return {
        past: state.past.slice(0, -1),
        present,
        future: [state.present, ...state.future],
      }
    }
    case "redo": {
      if (state.future.length === 0) return state
      const present = state.future[0] ?? null
      return {
        past: [...state.past, state.present],
        present,
        future: state.future.slice(1),
      }
    }
  }
}
