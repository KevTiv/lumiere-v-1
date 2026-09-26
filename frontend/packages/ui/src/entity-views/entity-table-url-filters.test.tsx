import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { EntityTableConfig } from "../lib/entity-view-types"
import { RBACProvider } from "../lib/rbac-context"
import { EntityTable } from "./entity-table"

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

const LIST_VIEW_KEY = "test-orders-list-view"

const config: EntityTableConfig = {
  mode: "table",
  rowKey: "id",
  listViewKey: LIST_VIEW_KEY,
  columns: [
    { key: "id", label: "ID" },
    { key: "reference", label: "Reference" },
    { key: "status", label: "Status" },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "draft", label: "Draft" },
        { value: "confirmed", label: "Confirmed" },
      ],
    },
  ],
}

const rows = [
  { id: "1", reference: "SO-001", status: "draft" },
  { id: "2", reference: "SO-002", status: "draft" },
  { id: "3", reference: "SO-003", status: "confirmed" },
]

function renderTable(initialFilters?: Record<string, string>) {
  return render(
    <RBACProvider>
      <EntityTable config={config} data={rows} initialFilters={initialFilters} />
    </RBACProvider>,
  )
}

function installLocalStorage(): void {
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage })
}

describe("EntityTable route filters", () => {
  beforeEach(() => installLocalStorage())

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it("applies route filters added after mount", async () => {
    const { rerender } = renderTable()

    expect(screen.getByText("SO-001")).toBeTruthy()
    expect(screen.getByText("SO-002")).toBeTruthy()
    expect(screen.getByText("SO-003")).toBeTruthy()

    rerender(
      <RBACProvider>
        <EntityTable config={config} data={rows} initialFilters={{ id: "2" }} />
      </RBACProvider>,
    )

    await waitFor(() => {
      expect(screen.queryByText("SO-001")).toBeNull()
      expect(screen.getByText("SO-002")).toBeTruthy()
      expect(screen.queryByText("SO-003")).toBeNull()
    })
  })

  it("replaces and removes route filters when navigation changes", async () => {
    const { rerender } = renderTable({ id: "1" })

    await waitFor(() => expect(screen.getByText("SO-001")).toBeTruthy())
    expect(screen.queryByText("SO-002")).toBeNull()

    rerender(
      <RBACProvider>
        <EntityTable config={config} data={rows} initialFilters={{ id: "2" }} />
      </RBACProvider>,
    )

    await waitFor(() => expect(screen.getByText("SO-002")).toBeTruthy())
    expect(screen.queryByText("SO-001")).toBeNull()

    rerender(
      <RBACProvider>
        <EntityTable config={config} data={rows} />
      </RBACProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("SO-001")).toBeTruthy()
      expect(screen.getByText("SO-002")).toBeTruthy()
      expect(screen.getByText("SO-003")).toBeTruthy()
    })
  })

  it("keeps route filters out of persisted list preferences", async () => {
    window.localStorage.setItem(LIST_VIEW_KEY, JSON.stringify({ status: "draft" }))

    const { rerender } = renderTable({ id: "2" })

    await waitFor(() => {
      expect(screen.queryByText("SO-001")).toBeNull()
      expect(screen.getByText("SO-002")).toBeTruthy()
      expect(screen.queryByText("SO-003")).toBeNull()
    })
    expect(JSON.parse(window.localStorage.getItem(LIST_VIEW_KEY) ?? "null")).toEqual({
      status: "draft",
    })

    rerender(
      <RBACProvider>
        <EntityTable config={config} data={rows} />
      </RBACProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("SO-001")).toBeTruthy()
      expect(screen.getByText("SO-002")).toBeTruthy()
      expect(screen.queryByText("SO-003")).toBeNull()
    })
    expect(JSON.parse(window.localStorage.getItem(LIST_VIEW_KEY) ?? "null")).toEqual({
      status: "draft",
    })
  })

  it("delegates clearing a route-owned hidden filter without changing saved preferences", async () => {
    const onInitialFilterClear = vi.fn()
    window.localStorage.setItem(LIST_VIEW_KEY, JSON.stringify({ status: "draft" }))

    render(
      <RBACProvider>
        <EntityTable
          config={config}
          data={rows}
          initialFilters={{ id: "2" }}
          onInitialFilterClear={onInitialFilterClear}
        />
      </RBACProvider>,
    )

    await waitFor(() => expect(screen.getByText("SO-002")).toBeTruthy())
    fireEvent.click(screen.getByTestId("entity-active-filter-id"))

    expect(onInitialFilterClear).toHaveBeenCalledOnce()
    expect(onInitialFilterClear).toHaveBeenCalledWith("id")
    expect(JSON.parse(window.localStorage.getItem(LIST_VIEW_KEY) ?? "null")).toEqual({
      status: "draft",
    })
  })
})
