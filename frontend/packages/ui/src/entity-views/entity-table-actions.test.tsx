import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { EntityAction, EntityTableConfig } from "../lib/entity-view-types"
import { RBACProvider } from "../lib/rbac-context"
import { EntityTable } from "./entity-table"

// Base UI's checkbox reads `PointerEvent`, which jsdom does not provide.
if (typeof globalThis.PointerEvent === "undefined") {
  Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true })
}

const toast = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock("../lib/workflow-toast", () => ({ showWorkflowToast: toast.show }))

vi.mock("../components/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}))

vi.mock("../components/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const rows = [
  { id: "1", reference: "SO-001", state: "open" },
  { id: "2", reference: "SO-002", state: "open" },
  { id: "3", reference: "SO-003", state: "closed" },
]

function renderTable(actions: EntityAction[]) {
  const config: EntityTableConfig = {
    mode: "table",
    rowKey: "id",
    columns: [
      { key: "id", label: "ID" },
      { key: "reference", label: "Reference" },
    ],
    actions,
  }
  return render(
    <RBACProvider>
      <EntityTable config={config} data={rows} />
    </RBACProvider>,
  )
}

const selectRow = (id: string) => fireEvent.click(screen.getByTestId(`entity-select-row-${id}`))

afterEach(() => {
  cleanup()
  toast.show.mockReset()
})

describe("EntityTable selection", () => {
  it("ticks rows with checkboxes and can untick the last one", () => {
    renderTable([{ id: "close", label: "Close", requiresSelection: true, onClick: vi.fn() }])

    selectRow("1")
    expect(screen.getByText("1 selected")).toBeTruthy()

    selectRow("1")
    expect(screen.queryByText("1 selected")).toBeNull()
  })

  it("selects every row on the page from the header and clears the selection", () => {
    renderTable([{ id: "close", label: "Close", requiresSelection: true, onClick: vi.fn() }])

    fireEvent.click(screen.getByTestId("entity-select-all"))
    expect(screen.getByText("3 selected")).toBeTruthy()

    fireEvent.click(screen.getByTestId("entity-selection-clear"))
    expect(screen.queryByText("3 selected")).toBeNull()
  })

  it("has no checkbox column when no action works on a selection", () => {
    renderTable([{ id: "new", label: "New", onClick: vi.fn() }])

    expect(screen.queryByTestId("entity-select-all")).toBeNull()
  })

  it("disables single-row actions while several rows are selected", () => {
    const single = vi.fn()
    const multiple = vi.fn()
    renderTable([
      { id: "edit", label: "Edit", requiresSelection: true, onClick: single },
      { id: "bulk", label: "Close all", requiresSelection: true, selection: "multiple", onClick: multiple },
    ])

    selectRow("1")
    expect((screen.getByTestId("entity-action-edit") as HTMLButtonElement).disabled).toBe(false)

    selectRow("2")
    expect((screen.getByTestId("entity-action-edit") as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId("entity-action-bulk") as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByTestId("entity-action-bulk"))
    expect(multiple).toHaveBeenCalledWith([rows[0], rows[1]])
    expect(single).not.toHaveBeenCalled()
  })
})

describe("EntityTable action execution", () => {
  it("keeps the button pending until the action settles", async () => {
    let finish: () => void = () => {}
    const onClick = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    renderTable([{ id: "post", label: "Post", requiresSelection: true, onClick }])

    selectRow("1")
    fireEvent.click(screen.getByTestId("entity-action-post"))

    const button = screen.getByTestId("entity-action-post") as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute("aria-busy")).toBe("true")

    // A second click while pending does not start the action again.
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)

    finish()
    await waitFor(() =>
      expect((screen.getByTestId("entity-action-post") as HTMLButtonElement).disabled).toBe(false),
    )
  })

  it("reports a rejected action as an error toast and re-enables the button", async () => {
    const onClick = vi.fn(() => Promise.reject(new Error("Order is locked")))
    renderTable([{ id: "post", label: "Post", requiresSelection: true, onClick }])

    selectRow("1")
    fireEvent.click(screen.getByTestId("entity-action-post"))

    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        kind: "error",
        title: "Post failed",
        description: "Order is locked",
      }),
    )
    expect((screen.getByTestId("entity-action-post") as HTMLButtonElement).disabled).toBe(false)
  })

  it("shows the success message only when the action resolves", async () => {
    renderTable([
      {
        id: "close",
        label: "Close",
        requiresSelection: true,
        successMessage: "Closed",
        onClick: vi.fn(async () => {}),
      },
    ])

    selectRow("1")
    fireEvent.click(screen.getByTestId("entity-action-close"))

    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ kind: "success", title: "Closed" }))
  })

  it("does not run a confirm-gated action until it is confirmed", async () => {
    const onClick = vi.fn(async () => {})
    renderTable([
      {
        id: "delete",
        label: "Delete",
        requiresSelection: true,
        confirm: { title: "Delete?", description: "Cannot be undone", confirmLabel: "Delete it", cancelLabel: "Keep" },
        onClick,
      },
    ])

    selectRow("1")
    fireEvent.click(screen.getByTestId("entity-action-delete"))
    expect(onClick).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByText("Delete it"))
    await waitFor(() => expect(onClick).toHaveBeenCalledWith([rows[0]]))
  })

  it("disables an action whose isApplicable rejects the selection", () => {
    renderTable([
      {
        id: "reopen",
        label: "Reopen",
        requiresSelection: true,
        isApplicable: (selected) => selected.every((row) => row.state === "closed"),
        onClick: vi.fn(),
      },
    ])

    selectRow("1")
    expect((screen.getByTestId("entity-action-reopen") as HTMLButtonElement).disabled).toBe(true)

    selectRow("1")
    selectRow("3")
    expect((screen.getByTestId("entity-action-reopen") as HTMLButtonElement).disabled).toBe(false)
  })
})
