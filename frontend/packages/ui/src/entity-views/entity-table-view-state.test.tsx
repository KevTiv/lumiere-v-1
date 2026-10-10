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

const LIST_VIEW_KEY = "test-orders-view-state"

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

function renderTable() {
  return render(
    <RBACProvider>
      <EntityTable config={config} data={rows} />
    </RBACProvider>,
  )
}

describe("EntityTable saved view", () => {
  beforeEach(() => installLocalStorage())

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it("restores hidden columns from this browser's saved view", async () => {
    window.localStorage.setItem(
      `${LIST_VIEW_KEY}:view`,
      JSON.stringify({ hiddenColumns: ["reference"], groupBy: null }),
    )
    renderTable()

    expect(await screen.findByText("Status", { selector: "th" })).toBeTruthy()
    expect(screen.queryByText("Reference", { selector: "th" })).toBeNull()
    expect(screen.queryByText("SO-001")).toBeNull()
  })

  it("groups rows with a header showing each group's total", async () => {
    window.localStorage.setItem(
      `${LIST_VIEW_KEY}:view`,
      JSON.stringify({ hiddenColumns: [], groupBy: "status" }),
    )
    renderTable()

    const headers = await screen.findAllByTestId("entity-group-row")
    expect(headers.map((row) => row.textContent)).toEqual(["Confirmed1", "Draft2"])
  })

  it("saves the current filters under a name and applies them again", async () => {
    window.localStorage.setItem(
      LIST_VIEW_KEY,
      JSON.stringify({ status: "draft" }),
    )
    renderTable()
    await screen.findByText("SO-001")
    expect(screen.queryByText("SO-003")).toBeNull()

    fireEvent.click(screen.getByTestId("entity-saved-filters"))
    fireEvent.change(await screen.findByTestId("entity-saved-filter-name"), { target: { value: "Drafts" } })
    fireEvent.click(screen.getByTestId("entity-saved-filter-save"))

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(`${LIST_VIEW_KEY}:saved-filters`) ?? "[]")
      expect(stored).toEqual([{ name: "Drafts", search: "", filters: { status: "draft" } }])
    })
    expect(screen.getByTestId("entity-saved-filter-apply-Drafts")).toBeTruthy()
  })

  it("keeps a group together across pages and totals currency columns for the whole group", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: String(i + 1),
      reference: `SO-${i + 1}`,
      status: i % 2 === 0 ? "draft" : "confirmed",
      total: 10,
    }))
    window.localStorage.setItem(
      `${LIST_VIEW_KEY}:view`,
      JSON.stringify({ hiddenColumns: [], groupBy: "status" }),
    )
    render(
      <RBACProvider>
        <EntityTable
          config={{
            ...config,
            columns: [...config.columns, { key: "total", label: "Total", type: "currency", align: "right" }],
          }}
          data={many}
        />
      </RBACProvider>,
    )

    const headers = await screen.findAllByTestId("entity-group-row")
    // Groups run in value order: "confirmed" fills the first page before "draft" starts.
    expect(headers[0]?.textContent).toContain("Confirmed15")
    expect(screen.getAllByTestId("entity-group-sum-total")[0]?.textContent).toBe("$150.00")
  })
})
