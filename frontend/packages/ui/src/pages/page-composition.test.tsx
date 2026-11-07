import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { DndContextProps, DragEndEvent } from "@dnd-kit/core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { chooseSelectValue } from "../components/select-test-utils"
import type { DashboardWidget } from "../lib/dashboard-types"
import type {
  PageWidgetCatalogItem,
  PageWidgetPlacement,
} from "../lib/page-composition"
import { PageComposition, type PageCompositionProps } from "./page-composition"

const sensor = vi.hoisted(() => ({
  props: undefined as DndContextProps | undefined,
}))

// Exercise the editor's sensor boundary; jsdom does not calculate grid geometry.
// The real sortable hooks, drag handles, and keyboard sensors remain mounted.
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>()
  return {
    ...actual,
    DndContext: (props: DndContextProps) => {
      sensor.props = props
      return <actual.DndContext {...props} />
    },
  }
})

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(
        /\{\{(\w+)\}\}/g,
        (_, field: string) => String(options?.[field] ?? ""),
      ),
  }),
}))

// Chart rendering has its own tests; these assertions cover composition and persistence.
vi.mock("./dashboard-widget-renderer", () => ({
  DashboardWidgetRenderer: ({
    widget,
    testId,
  }: {
    widget: DashboardWidget
    testId?: string
  }) => {
    if (widget.type === "custom") {
      const Component = widget.component
      return <Component data={widget.data} />
    }
    return (
      <div data-testid={testId}>
        <h3>{widget.title}</h3>
        <span>Live widget</span>
      </div>
    )
  },
}))

const revenue: PageWidgetCatalogItem = {
  source: "builtin",
  widgetId: "revenue",
  title: "Revenue",
  category: "Sales",
  widget: {
    id: "revenue",
    type: "kpi",
    title: "Revenue",
    width: "1/2",
    data: { value: 100, label: "Revenue" },
  },
}
const orders: PageWidgetCatalogItem = {
  source: "builtin",
  widgetId: "orders",
  title: "Orders",
  category: "Sales",
  widget: {
    id: "orders",
    type: "kpi",
    title: "Orders",
    width: "1/2",
    data: { value: 20, label: "Orders" },
  },
}
const saved: PageWidgetCatalogItem = {
  source: "saved",
  widgetId: "42",
  title: "Late invoices",
  description: "Invoices by month",
}
const defaultValue: PageWidgetPlacement[] = [
  { id: "revenue-instance", source: "builtin", widgetId: "revenue", width: 6 },
  { id: "orders-instance", source: "builtin", widgetId: "orders", width: 6 },
]

function props(
  overrides: Partial<PageCompositionProps> = {},
): PageCompositionProps {
  return {
    value: null,
    revision: "4",
    defaultValue,
    catalog: [revenue, orders, saved],
    onSave: vi.fn().mockResolvedValue(undefined),
    children: <p>Original module dashboard</p>,
    ...overrides,
  }
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name, exact: true }))
}

function placementOrder() {
  return [
    ...screen
      .getByTestId("page-composition-grid")
      .querySelectorAll("[data-placement-id]"),
  ].map((element) => element.getAttribute("data-placement-id"))
}

afterEach(() => {
  cleanup()
  sensor.props = undefined
})

describe("PageComposition adding and editing", () => {
  it("previews custom page blocks as metadata without mounting their native controllers", () => {
    const controller = vi.fn(() => (
      <button type="button">Native operation</button>
    ))
    const block: PageWidgetCatalogItem = {
      source: "builtin",
      widgetId: "existing-workspace",
      title: "Existing workspace",
      widget: {
        id: "existing-workspace",
        title: "",
        type: "custom",
        width: "full",
        useCard: false,
        component: controller,
        data: null,
      },
    }
    render(
      <PageComposition {...props({ defaultValue: [], catalog: [block] })} />,
    )
    click("Edit page")
    click("Add widget")
    const gallery = screen.getByRole("dialog")
    expect(
      within(gallery).getByText(
        "This page block becomes available in the layout.",
      ),
    ).toBeTruthy()
    expect(controller).not.toHaveBeenCalled()
    expect(screen.queryByText("Native operation")).toBeNull()
    fireEvent.click(
      within(gallery).getByRole("button", { name: "Add to page" }),
    )
    expect(controller).toHaveBeenCalled()
    expect(screen.getByText("Native operation").closest("[inert]")).toBeTruthy()
  })

  it("adds a saved widget without requiring source data in the catalog, and cancels without saving", () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onDraftChange = vi.fn()
    render(<PageComposition {...props({ onSave, onDraftChange })} />)
    expect(screen.getByText("Original module dashboard")).toBeTruthy()
    click("Edit page")
    click("Add widget")
    const gallery = screen.getByRole("dialog")
    fireEvent.change(
      within(gallery).getByRole("textbox", { name: "Search widgets" }),
      { target: { value: "Late invoices" } },
    )
    expect(
      within(gallery).getByText(
        "Live data loads when you add this widget to the page.",
      ),
    ).toBeTruthy()
    chooseSelectValue(
      within(gallery).getByRole("combobox", { name: "New widget width" }),
      "12",
    )
    fireEvent.click(
      within(gallery).getByRole("button", { name: "Add to page" }),
    )

    expect(onSave).not.toHaveBeenCalled()
    expect(onDraftChange).toHaveBeenLastCalledWith([
      ...defaultValue,
      expect.objectContaining({ source: "saved", widgetId: "42", width: 12 }),
    ])
    expect(
      screen.getByText(
        "Data for this widget is unavailable. You can keep its place or edit the page to choose another widget.",
      ),
    ).toBeTruthy()
    const unload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)

    click("Cancel")
    expect(onDraftChange).toHaveBeenLastCalledWith(null)
    expect(screen.getByText("Original module dashboard")).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
    const cleanUnload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(cleanUnload)
    expect(cleanUnload.defaultPrevented).toBe(false)
  })

  it("reorders, resizes, removes and undoes changes locally, then saves one layout at its original revision", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<PageComposition {...props({ onSave })} />)
    click("Edit page")
    click("Move Orders earlier")
    expect(placementOrder()).toEqual(["orders-instance", "revenue-instance"])
    chooseSelectValue(
      screen.getByRole("combobox", { name: "Width of Orders" }),
      "3",
    )
    click("Remove Revenue")
    expect(placementOrder()).toEqual(["orders-instance"])
    click("Undo")
    expect(placementOrder()).toEqual(["orders-instance", "revenue-instance"])
    click("Redo")
    expect(placementOrder()).toEqual(["orders-instance"])
    expect(onSave).not.toHaveBeenCalled()
    click("Done")
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledExactlyOnceWith(
        [{ ...defaultValue[1], width: 3 }],
        "4",
      ),
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit page" })).toBeTruthy(),
    )
  })

  it("uses drag drops to change order and ignores drops after edit permission is withdrawn", () => {
    const initial = props()
    const view = render(<PageComposition {...initial} />)
    click("Edit page")
    act(() =>
      sensor.props?.onDragEnd?.({
        active: { id: "orders-instance" },
        over: { id: "revenue-instance" },
      } as DragEndEvent),
    )
    expect(placementOrder()).toEqual(["orders-instance", "revenue-instance"])
    view.rerender(<PageComposition {...initial} canEdit={false} />)
    act(() =>
      sensor.props?.onDragEnd?.({
        active: { id: "revenue-instance" },
        over: { id: "orders-instance" },
      } as DragEndEvent),
    )
    expect(placementOrder()).toEqual(["orders-instance", "revenue-instance"])
    expect(
      (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    click("Cancel")
    expect(screen.queryByRole("button", { name: "Edit page" })).toBeNull()
  })

  it("keeps the draft on failure, blocks duplicate saves, and retries without losing changes", async () => {
    let rejectSave!: (error: Error) => void
    const onSave = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectSave = reject
          }),
      )
      .mockResolvedValue(undefined)
    render(
      <PageComposition {...props({ onSave, value: [defaultValue[0]!] })} />,
    )
    click("Edit page")
    click("Remove Revenue")
    click("Done")
    expect(
      (screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }))
    expect(onSave).toHaveBeenCalledTimes(1)
    await act(async () => {
      rejectSave(new Error("Connection lost. Try again."))
    })
    expect(screen.getByRole("alert").textContent).toContain("Connection lost")
    expect(
      screen.getByRole("button", { name: "Add your first widget" }),
    ).toBeTruthy()
    click("Done")
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    expect(onSave).toHaveBeenNthCalledWith(1, [], "4")
    expect(onSave).toHaveBeenNthCalledWith(2, [], "4")
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })

  it("resets to the module template as null and supports undoing that reset", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<PageComposition {...props({ value: [], onSave })} />)
    click("Edit page")
    click("Reset to default")
    expect(placementOrder()).toEqual(["revenue-instance", "orders-instance"])
    click("Undo")
    expect(
      screen.getByRole("button", { name: "Add your first widget" }),
    ).toBeTruthy()
    click("Redo")
    click("Done")
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledExactlyOnceWith(null, "4"),
    )
  })

  it("adds a newly created widget and can configure that placement without replacing others", async () => {
    const created: PageWidgetCatalogItem = {
      ...saved,
      widgetId: "43",
      title: "Invoice trend",
      widget: { ...orders.widget!, id: "43", title: "Invoice trend" },
    }
    const configured: PageWidgetCatalogItem = {
      ...created,
      widgetId: "44",
      title: "Invoice trend by week",
      widget: { ...orders.widget!, id: "44", title: "Invoice trend by week" },
    }
    const onCreateWidget = vi.fn().mockResolvedValue(created)
    const onConfigureWidget = vi.fn().mockResolvedValue(configured)
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <PageComposition
        {...props({ onCreateWidget, onConfigureWidget, onSave })}
      />,
    )
    click("Edit page")
    click("Add widget")
    click("Create new widget")
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Configure Invoice trend" }),
      ).toBeTruthy(),
    )
    expect(onCreateWidget).toHaveBeenCalledTimes(1)
    const originalIds = placementOrder()
    chooseSelectValue(
      screen.getByRole("combobox", { name: "Width of Invoice trend" }),
      "8",
    )
    click("Configure Invoice trend")
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Configure Invoice trend by week" }),
      ).toBeTruthy(),
    )
    expect(placementOrder()).toEqual(originalIds)
    click("Done")
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledExactlyOnceWith(
        [
          ...defaultValue,
          { id: originalIds[2], source: "saved", widgetId: "44", width: 8 },
        ],
        "4",
      ),
    )
  })

  it("stages a harness add request once, and opens the gallery for an unknown widget", () => {
    const onRequestHandled = vi.fn()
    const initial = props({
      request: { id: "request-1", kind: "add_widget", widgetKey: "saved:42" },
      onRequestHandled,
    })
    const view = render(<PageComposition {...initial} />)
    expect(placementOrder()).toHaveLength(3)
    expect(onRequestHandled).toHaveBeenCalledExactlyOnceWith("request-1")
    view.rerender(
      <PageComposition {...initial} request={{ ...initial.request! }} />,
    )
    expect(placementOrder()).toHaveLength(3)
    expect(initial.onSave).not.toHaveBeenCalled()
    view.rerender(
      <PageComposition
        {...initial}
        request={{
          id: "request-2",
          kind: "add_widget",
          widgetKey: "saved:unknown",
          prompt: "Late invoices",
        }}
      />,
    )
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(
      (
        screen.getByRole("textbox", {
          name: "Search widgets",
        }) as HTMLInputElement
      ).value,
    ).toBe("")
    expect(screen.getByText("Requested widget: Late invoices")).toBeTruthy()
    expect(onRequestHandled).toHaveBeenLastCalledWith("request-2")
  })

  it("does not overwrite a layout changed elsewhere while a draft is open", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const initial = props({ onSave })
    const view = render(<PageComposition {...initial} />)
    click("Edit page")
    click("Remove Revenue")
    const latest: PageWidgetPlacement[] = [{ ...defaultValue[0]!, width: 12 }]
    view.rerender(<PageComposition {...initial} value={latest} revision="5" />)
    expect(screen.getByRole("alert").textContent).toContain(
      "This page changed while you were editing",
    )
    expect(
      (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(placementOrder()).toEqual(["orders-instance"])
    click("Cancel")
    click("Edit page")
    expect(placementOrder()).toEqual(["revenue-instance"])
    chooseSelectValue(
      screen.getByRole("combobox", { name: "Width of Revenue" }),
      "6",
    )
    click("Done")
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledExactlyOnceWith(
        [{ ...latest[0], width: 6 }],
        "5",
      ),
    )
  })

  it("caps manual and harness additions at 64 while leaving removal and reset available", () => {
    const full: PageWidgetPlacement[] = Array.from(
      { length: 64 },
      (_, index) => ({
        id: `instance-${index}`,
        source: "saved",
        widgetId: "42",
        width: 6,
      }),
    )
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onCreateWidget = vi.fn().mockResolvedValue(saved)
    const onRequestHandled = vi.fn()
    const initial = props({
      value: full,
      onSave,
      onCreateWidget,
      onRequestHandled,
      request: { id: "full-page", kind: "add_widget", widgetKey: "saved:42" },
    })
    const view = render(<PageComposition {...initial} />)
    expect(placementOrder()).toHaveLength(64)
    expect(
      (screen.getByRole("button", { name: "Add widget" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      screen.getAllByText(
        "This page supports up to 64 widgets. Remove a widget before adding another.",
      ).length,
    ).toBeGreaterThan(0)
    expect(onRequestHandled).toHaveBeenCalledExactlyOnceWith("full-page")
    fireEvent.click(
      screen.getAllByRole("button", { name: "Remove Late invoices" })[0]!,
    )
    expect(
      (screen.getByRole("button", { name: "Add widget" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
    view.rerender(
      <PageComposition
        {...initial}
        request={{
          id: "space-available",
          kind: "add_widget",
          widgetKey: "saved:42",
        }}
      />,
    )
    expect(placementOrder()).toHaveLength(64)
    expect(
      screen.getAllByRole("button", { name: "Remove Late invoices" }),
    ).toHaveLength(64)
    click("Reset to default")
    expect(placementOrder()).toHaveLength(2)
    expect(onCreateWidget).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it("focuses an existing builtin instead of duplicating it, while saved widgets remain repeatable", () => {
    const onRequestHandled = vi.fn()
    const initial = props({
      request: {
        id: "existing-builtin",
        kind: "add_widget",
        widgetKey: "builtin:revenue",
      },
      onRequestHandled,
    })
    const view = render(<PageComposition {...initial} />)
    expect(placementOrder()).toEqual(["revenue-instance", "orders-instance"])
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Drag Revenue" }),
    )
    expect(onRequestHandled).toHaveBeenCalledExactlyOnceWith("existing-builtin")
    click("Add widget")
    const gallery = screen.getByRole("dialog")
    fireEvent.change(
      within(gallery).getByRole("textbox", { name: "Search widgets" }),
      { target: { value: "Revenue" } },
    )
    expect(
      (
        within(gallery).getByRole("button", {
          name: "Add to page",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    fireEvent.click(within(gallery).getByRole("button", { name: "Cancel" }))
    click("Remove Revenue")
    click("Add widget")
    const reopened = screen.getByRole("dialog")
    fireEvent.change(
      within(reopened).getByRole("textbox", { name: "Search widgets" }),
      { target: { value: "Revenue" } },
    )
    fireEvent.click(
      within(reopened).getByRole("button", { name: "Add to page" }),
    )
    expect(placementOrder()).toHaveLength(2)
    expect(
      screen.getAllByRole("button", { name: "Remove Revenue" }),
    ).toHaveLength(1)
    view.rerender(
      <PageComposition
        {...initial}
        request={{
          id: "saved-first",
          kind: "add_widget",
          widgetKey: "saved:42",
        }}
      />,
    )
    view.rerender(
      <PageComposition
        {...initial}
        request={{
          id: "saved-second",
          kind: "add_widget",
          widgetKey: "saved:42",
        }}
      />,
    )
    expect(placementOrder()).toHaveLength(4)
    expect(new Set(placementOrder()).size).toBe(4)
    expect(
      screen.getAllByRole("button", { name: "Remove Late invoices" }),
    ).toHaveLength(2)
    expect(initial.onSave).not.toHaveBeenCalled()
  })
})
