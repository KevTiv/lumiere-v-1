import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createContext, useContext, type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { EntityRowAction, EntityTableConfig } from "../lib/entity-view-types"
import { decodeFacetValues, encodeFacetValues } from "../lib/entity-table-engine"
import { RBACProvider } from "../lib/rbac-context"
import { EntityTable } from "./entity-table"

// Base UI's checkbox reads `PointerEvent`, which jsdom does not provide.
if (typeof globalThis.PointerEvent === "undefined") {
  Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true })
}

vi.mock("../lib/workflow-toast", () => ({ showWorkflowToast: vi.fn() }))

vi.mock("../components/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

// Selects render their items as buttons that pick the value.
const SelectContext = createContext<(value: string) => void>(() => undefined)
vi.mock("../components/select", () => ({
  Select: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (value: string) => void }) => (
    <SelectContext.Provider value={(value) => onValueChange?.(value)}>{children}</SelectContext.Provider>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => {
    const pick = useContext(SelectContext)
    return (
      <button type="button" data-testid={`select-item-${value}`} onClick={() => pick(value)}>
        {children}
      </button>
    )
  },
  SelectTrigger: ({ children, ...props }: { children: ReactNode; "data-testid"?: string }) => (
    <div data-testid={props["data-testid"]}>{children}</div>
  ),
  SelectValue: () => null,
}))

// Popovers and menus are always open, so their content can be clicked directly.
vi.mock("../components/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock("../components/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuCheckboxItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
    ...props
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    "data-testid"?: string
  }) => (
    <button type="button" disabled={disabled} onClick={onClick} data-testid={props["data-testid"]}>
      {children}
    </button>
  ),
}))

const rows = [
  { id: "1", name: "Alpha", state: { tag: "Done" }, priority: "2" },
  { id: "2", name: "Beta", state: { tag: "InProgress" }, priority: "0" },
  { id: "3", name: "Gamma", state: { tag: "Done" }, priority: "3" },
  { id: "4", name: "Delta", state: { tag: "Cancelled" }, priority: "2" },
]

function renderTable(extra: Partial<EntityTableConfig>, data = rows) {
  const config: EntityTableConfig = {
    mode: "table",
    rowKey: "id",
    columns: [
      { key: "name", label: "Name" },
      { key: "state", label: "Status" },
    ],
    ...extra,
  }
  return render(
    <RBACProvider>
      <EntityTable config={config} data={data} />
    </RBACProvider>,
  )
}

const visibleNames = () =>
  screen
    .queryAllByTestId(/^entity-row-\d+$/)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "")

afterEach(cleanup)

describe("facet values", () => {
  it("round-trip through one stored filter value", () => {
    expect(decodeFacetValues(encodeFacetValues(["Done", "Cancelled"]))).toEqual(["Done", "Cancelled"])
    expect(encodeFacetValues([])).toBe("__all__")
    expect(decodeFacetValues("__all__")).toEqual([])
    expect(decodeFacetValues("Done")).toEqual(["Done"])
  })
})

describe("EntityTable faceted filters", () => {
  const filters: EntityTableConfig["filters"] = [
    {
      key: "state",
      label: "Status",
      type: "select",
      faceted: true,
      options: [
        { value: "InProgress", label: "In progress" },
        { value: "Done", label: "Done" },
        { value: "Cancelled", label: "Cancelled" },
      ],
    },
  ]

  it("counts rows per option and keeps rows matching any ticked option", () => {
    renderTable({ filters })
    const doneOption = screen.getByTestId("entity-facet-option-state-Done").closest("label")!
    expect(doneOption.lastElementChild?.textContent).toBe("2")

    fireEvent.click(screen.getByTestId("entity-facet-option-state-Done"))
    expect(visibleNames().sort()).toEqual(["Alpha", "Gamma"])

    fireEvent.click(screen.getByTestId("entity-facet-option-state-Cancelled"))
    expect(visibleNames().sort()).toEqual(["Alpha", "Delta", "Gamma"])

    fireEvent.click(screen.getByTestId("entity-facet-clear-state"))
    expect(visibleNames()).toHaveLength(4)
  })
})

describe("EntityTable selection and row actions", () => {
  it("shows row checkboxes for a selectable table without selection actions", () => {
    renderTable({ selectable: true })
    fireEvent.click(screen.getByTestId("entity-select-row-2"))
    expect(screen.getByText(/1 selected/)).toBeTruthy()
  })

  it("runs a row menu entry on its row and disables inapplicable ones", async () => {
    const onDone = vi.fn()
    const rowActions: EntityRowAction[] = [
      {
        id: "done",
        label: "Mark done",
        isApplicable: (row) => (row.state as { tag: string }).tag !== "Done",
        onClick: onDone,
      },
    ]
    renderTable({ rowActions })

    expect((screen.getByTestId("entity-row-action-done-1") as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId("entity-row-action-done-2"))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(rows[1]))
  })
})

describe("EntityTable rows per page", () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ id: String(index + 1), name: `Row ${index + 1}` }))

  it("pages by 25 by default and by the chosen size after a change", () => {
    renderTable({}, many)
    expect(visibleNames()).toHaveLength(25)

    fireEvent.click(screen.getByTestId("select-item-10"))
    expect(visibleNames()).toHaveLength(10)

    fireEvent.click(screen.getByTestId("select-item-50"))
    expect(visibleNames()).toHaveLength(30)
  })

  it("offers no page size choice for a short list", () => {
    renderTable({})
    expect(screen.queryByTestId("entity-rows-per-page")).toBeNull()
  })
})
