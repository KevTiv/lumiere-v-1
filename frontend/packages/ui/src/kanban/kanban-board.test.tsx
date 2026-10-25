import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type {
  DndContextProps,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { KanbanBoardProps } from "../lib/kanban-board-types"
import { KanbanBoard } from "./kanban-board"

// Drive the sensor boundary without depending on jsdom's nonexistent layout.
// The actual draggable/droppable hooks still render the card affordances.
const sensor = vi.hoisted(() => ({
  props: undefined as DndContextProps | undefined,
  pointerStarts: [] as string[],
}))

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>()
  return {
    ...actual,
    DndContext: (props: DndContextProps) => {
      sensor.props = props
      return <actual.DndContext {...props} />
    },
    DragOverlay: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="drag-overlay">{children}</div>
    ),
    useDraggable: (props: Parameters<typeof actual.useDraggable>[0]) => {
      const draggable = actual.useDraggable(props)
      return {
        ...draggable,
        listeners: {
          ...draggable.listeners,
          onPointerDown: (event: React.PointerEvent) => {
            sensor.pointerStarts.push(String(props.id))
            draggable.listeners?.onPointerDown?.(event)
          },
        },
      }
    },
  }
})

interface Item {
  id: string
  columnId: string
  title: string
}

const item: Item = {
  id: "invoice-review:1",
  columnId: "ready",
  title: "Review invoice",
}
const props: KanbanBoardProps<Item> = {
  columns: [
    { id: "ready", title: "Ready" },
    { id: "working", title: "Working" },
    { id: "done", title: "Done" },
  ],
  items: [item],
  getItemId: (row) => row.id,
  getColumnId: (row) => row.columnId,
  renderCard: (row) => <span>{row.title}</span>,
}

function startDrag() {
  sensor.props?.onDragStart?.({ active: { id: item.id } } as DragStartEvent)
}

function drop(columnId = "working") {
  sensor.props?.onDragEnd?.({
    active: { id: item.id },
    over: { id: columnId },
  } as DragEndEvent)
}

function move(columnId = "working") {
  act(() => {
    startDrag()
    drop(columnId)
  })
}

const card = () => screen.getByTestId(`kanban-card-${item.id}`)

afterEach(() => {
  cleanup()
  sensor.props = undefined
  sensor.pointerStarts = []
})

describe("KanbanBoard permitted interactions", () => {
  it("keeps read-only cards clickable and keyboard accessible without dragging", () => {
    const onItemClick = vi.fn()
    render(<KanbanBoard {...props} onItemClick={onItemClick} />)

    expect(card().getAttribute("data-draggable")).toBe("false")
    expect(card().getAttribute("tabindex")).toBe("0")
    fireEvent.click(card())
    fireEvent.keyDown(card(), { key: "Enter" })
    fireEvent.keyDown(card(), { key: " " })
    expect(onItemClick).toHaveBeenCalledTimes(3)
    expect(onItemClick).toHaveBeenLastCalledWith(item)
    act(startDrag)
    expect(screen.getByTestId("drag-overlay").textContent).toBe("")
  })

  it("rejects a denied destination while allowing an authorized destination", async () => {
    const onMove = vi.fn()
    render(
      <KanbanBoard
        {...props}
        onMove={onMove}
        canMove={(_, to) => to === "working"}
      />,
    )

    move("done")
    expect(onMove).not.toHaveBeenCalled()
    move("working")
    await waitFor(() =>
      expect(onMove).toHaveBeenCalledExactlyOnceWith({
        itemId: item.id,
        fromColumnId: "ready",
        toColumnId: "working",
        item,
      }),
    )
  })

  it.each([
    { isItemDraggable: () => false },
    { isItemPending: () => true },
    {
      moveDisabledReason: () => "Only the assigned reviewer can move this task",
    },
  ])(
    "blocks a locked card without disabling record access: %o",
    async (lock) => {
      const onMove = vi.fn()
      const onItemClick = vi.fn()
      render(
        <KanbanBoard
          {...props}
          {...lock}
          onMove={onMove}
          onItemClick={onItemClick}
        />,
      )

      expect(card().getAttribute("data-draggable")).toBe("false")
      move()
      expect(onMove).not.toHaveBeenCalled()
      fireEvent.keyDown(card(), { key: "Enter" })
      expect(onItemClick).toHaveBeenCalledWith(item)
      if ("moveDisabledReason" in lock) {
        expect(screen.getByText(lock.moveDisabledReason())).toBeTruthy()
        expect(card().getAttribute("aria-describedby")).toBeTruthy()
      }
    },
  )

  it("rechecks current permissions on drop after a drag has started", () => {
    const onMove = vi.fn()
    const view = render(
      <KanbanBoard {...props} onMove={onMove} canMove={() => true} />,
    )
    act(startDrag)
    view.rerender(
      <KanbanBoard {...props} onMove={onMove} canMove={() => false} />,
    )
    act(() => drop())
    expect(onMove).not.toHaveBeenCalled()
  })

  it("rejects a drag whose source column changed meanwhile", () => {
    const onMove = vi.fn()
    const view = render(<KanbanBoard {...props} onMove={onMove} />)
    act(startDrag)
    view.rerender(
      <KanbanBoard
        {...props}
        items={[{ ...item, columnId: "done" }]}
        onMove={onMove}
      />,
    )
    act(() => drop())
    expect(onMove).not.toHaveBeenCalled()
  })

  it("uses the current row and callback rather than the drag-start snapshot", async () => {
    const oldMove = vi.fn()
    const currentMove = vi.fn()
    const currentItem = { ...item, title: "Updated review details" }
    const view = render(<KanbanBoard {...props} onMove={oldMove} />)
    act(startDrag)
    view.rerender(
      <KanbanBoard {...props} items={[currentItem]} onMove={currentMove} />,
    )
    act(() => drop())
    expect(oldMove).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(currentMove).toHaveBeenCalledExactlyOnceWith({
        itemId: item.id,
        fromColumnId: "ready",
        toColumnId: "working",
        item: currentItem,
      }),
    )
  })

  it("blocks duplicate moves before a render and until the pending request settles", async () => {
    let resolveMove!: () => void
    const onMove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveMove = resolve
        }),
    )
    render(<KanbanBoard {...props} onMove={onMove} />)

    act(() => {
      startDrag()
      drop()
      startDrag()
      drop("done")
    })
    expect(onMove).toHaveBeenCalledTimes(1)
    expect(card().getAttribute("aria-busy")).toBe("true")
    expect(card().getAttribute("data-draggable")).toBe("false")
    move("done")
    expect(onMove).toHaveBeenCalledTimes(1)
    await act(async () => resolveMove())
    expect(card().getAttribute("aria-busy")).toBeNull()
    expect(card().getAttribute("data-draggable")).toBe("true")
  })

  it("reports a failed move, releases its lock and leaves canonical card placement unchanged", async () => {
    const onMove = vi
      .fn()
      .mockRejectedValue(new Error("Permission was revoked"))
    render(
      <KanbanBoard
        {...props}
        onMove={onMove}
        labels={{ moveFailed: "Move was rejected" }}
      />,
    )
    move()

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Move was rejected",
    )
    expect(screen.getByTestId("kanban-column-ready").contains(card())).toBe(
      true,
    )
    expect(card().getAttribute("aria-busy")).toBeNull()
  })

  it("contains rejection from an asynchronous error reporter too", async () => {
    const error = new Error("Permission was revoked")
    const onMoveError = vi
      .fn()
      .mockRejectedValue(new Error("Reporter unavailable"))
    render(
      <KanbanBoard
        {...props}
        onMove={() => Promise.reject(error)}
        onMoveError={onMoveError}
      />,
    )
    move()

    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(onMoveError).toHaveBeenCalledExactlyOnceWith(error, {
      itemId: item.id,
      fromColumnId: "ready",
      toColumnId: "working",
      item,
    })
    expect(card().getAttribute("aria-busy")).toBeNull()
  })

  it("clears the overlay and prevents a move after drag cancellation", () => {
    const onMove = vi.fn()
    render(<KanbanBoard {...props} onMove={onMove} />)
    act(startDrag)
    expect(screen.getByTestId("drag-overlay").textContent).toBe(item.title)
    act(() =>
      sensor.props?.onDragCancel?.({ active: { id: item.id } } as DragEndEvent),
    )
    expect(screen.getByTestId("drag-overlay").textContent).toBe("")
    act(() => drop())
    expect(onMove).not.toHaveBeenCalled()
  })

  it("keeps nested action buttons independent of card activation and drag listeners", () => {
    const onItemClick = vi.fn()
    const onAction = vi.fn()
    render(
      <KanbanBoard
        {...props}
        onMove={vi.fn()}
        onItemClick={onItemClick}
        renderCard={(row) => (
          <>
            <span>{row.title}</span>
            <button onClick={onAction}>Assign</button>
          </>
        )}
      />,
    )

    const action = screen.getByRole("button", { name: "Assign" })
    fireEvent.pointerDown(action)
    fireEvent.keyDown(action, { key: "Enter" })
    fireEvent.click(action)
    expect(sensor.pointerStarts).toEqual([])
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onItemClick).not.toHaveBeenCalled()
    fireEvent.click(card())
    expect(onItemClick).toHaveBeenCalledWith(item)
  })
})
