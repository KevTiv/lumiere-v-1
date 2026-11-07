import { describe, expect, it } from "vitest"
import type { DashboardSection } from "./dashboard-types"
import {
  createBuiltinWidgetCatalog,
  createDefaultPageLayout,
  createPageCompositionHistory,
  createPageWidgetPlacement,
  movePageWidget,
  pageCompositionHistoryReducer,
  pageLayoutsEqual,
  type PageWidgetPlacement,
} from "./page-composition"

const first: PageWidgetPlacement = {
  id: "first",
  source: "builtin",
  widgetId: "orders",
  width: 6,
}
const second: PageWidgetPlacement = {
  id: "second",
  source: "saved",
  widgetId: "42",
  width: 4,
}

describe("page composition draft model", () => {
  it("references live built-in definitions while keeping each placement independent", () => {
    const sections: DashboardSection[] = [
      {
        id: "sales",
        title: "Sales",
        widgets: [
          {
            id: "orders",
            type: "kpi",
            title: "Orders",
            width: "1/3",
            data: { value: 12, label: "orders" },
          },
        ],
      },
    ]
    const catalog = createBuiltinWidgetCatalog(sections)
    const layout = createDefaultPageLayout(sections)

    expect(layout).toEqual([
      {
        id: "builtin:sales:orders",
        source: "builtin",
        widgetId: "orders",
        width: 4,
      },
    ])
    expect(catalog[0]?.widget).toBe(sections[0]?.widgets[0])
    expect(createPageWidgetPlacement(catalog[0]!, "another-placement")).toEqual(
      { ...layout[0], id: "another-placement" },
    )
  })

  it("moves only the selected placement and ignores stale or cancelled drop targets", () => {
    const widgets = Object.freeze([Object.freeze(first), Object.freeze(second)])
    expect(movePageWidget(widgets, first.id, second.id)).toEqual([
      second,
      first,
    ])
    expect(widgets).toEqual([first, second])
    expect(movePageWidget(widgets, first.id, "deleted")).toBe(widgets)
    expect(movePageWidget(widgets, "deleted", second.id)).toBe(widgets)
    expect(movePageWidget(widgets, first.id, first.id)).toBe(widgets)
  })

  it("distinguishes reset from an empty page and preserves undo branches", () => {
    expect(pageLayoutsEqual(null, [])).toBe(false)
    expect(pageLayoutsEqual([first], [{ ...first }])).toBe(true)
    let state = createPageCompositionHistory([first])
    state = pageCompositionHistoryReducer(state, { type: "change", value: [] })
    state = pageCompositionHistoryReducer(state, {
      type: "change",
      value: null,
    })
    state = pageCompositionHistoryReducer(state, { type: "undo" })
    expect(state.present).toEqual([])
    state = pageCompositionHistoryReducer(state, { type: "undo" })
    expect(state.present).toEqual([first])
    state = pageCompositionHistoryReducer(state, { type: "redo" })
    expect(state.present).toEqual([])
    state = pageCompositionHistoryReducer(state, {
      type: "change",
      value: [second],
    })
    expect(state.future).toEqual([])
    expect(pageCompositionHistoryReducer(state, { type: "redo" })).toBe(state)
    expect(
      pageCompositionHistoryReducer(state, { type: "start", value: null }),
    ).toEqual({ past: [], present: null, future: [] })
  })
})
