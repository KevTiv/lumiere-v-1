import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./entity-table", () => ({ EntityTable: () => <div data-testid="table" /> }))
vi.mock("../lib/rbac-context", () => ({ useRBAC: () => ({ checkPermission: () => true }) }))

import { EntityView } from "./entity-view"
import { withReadOnlyStateBoard } from "../lib/entity-state-board"
import type { EntityViewConfig } from "../lib/entity-view-types"

const t = ((key: string, o?: Record<string, unknown>) => {
  let text = (o?.defaultValue as string | undefined) ?? key
  for (const [k, v] of Object.entries(o ?? {})) text = text.replace(`{{${k}}}`, String(v))
  return text
}) as never

const base: EntityViewConfig = {
  id: "pivot-test",
  title: "Orders",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: ["reference", "partnerName"],
    filters: [
      {
        key: "state",
        label: "State",
        type: "select",
        options: [
          { value: "Draft", label: "Draft" },
          { value: "Sale", label: "Confirmed" },
        ],
      },
    ],
    columns: [
      { key: "state", label: "State", type: "badge", badgeLabels: { Draft: "Draft", Sale: "Confirmed" } },
      { key: "amountTotal", label: "Total", type: "currency" },
    ],
  },
}

const config = withReadOnlyStateBoard(t, base, {
  groupKey: "state",
  card: { titleKey: "reference", title: (row) => `Name ${String(row.reference)}` },
  pivot: { groupKeys: ["state"], measureKeys: ["amountTotal"], currencyKey: "currencyId" },
})

const rows = [
  { id: 1, reference: "SO1", partnerName: "Acme", state: "Draft", amountTotal: 10, currencyId: "USD" },
  { id: 2, reference: "SO2", partnerName: "Zed", state: "Sale", amountTotal: 30, currencyId: "USD" },
  { id: 3, reference: "SO3", partnerName: "Acme", state: "Weird", amountTotal: 5, currencyId: "USD" },
]

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe("read-only board", () => {
  it("shows rows with an unknown state in an Other column, titled by the display name", () => {
    render(<EntityView config={config} data={rows} />)
    fireEvent.click(screen.getByRole("button", { name: "Board" }))
    const card = screen.getByTestId("entity-board-card-3")
    expect(card.textContent).toContain("Name SO3")
    expect(screen.getByText("Other")).toBeTruthy()
  })

  it("hides the Other column when every row has a column", () => {
    render(<EntityView config={config} data={rows.slice(0, 2)} />)
    fireEvent.click(screen.getByRole("button", { name: "Board" }))
    expect(screen.queryByText("Other")).toBeNull()
  })

  it("filters cards by the table's search keys", () => {
    render(<EntityView config={config} data={rows} />)
    fireEvent.click(screen.getByRole("button", { name: "Board" }))
    fireEvent.change(screen.getByTestId("entity-board-search"), { target: { value: "zed" } })
    expect(screen.queryByTestId("entity-board-card-1")).toBeNull()
    expect(screen.getByTestId("entity-board-card-2")).toBeTruthy()
  })
})

describe("pivot view", () => {
  it("is a third mode with counts, sums, a total row and a remembered choice", () => {
    const { unmount } = render(<EntityView config={config} data={rows} />)
    fireEvent.click(screen.getByRole("button", { name: "Summary" }))
    const sale = screen.getByTestId("entity-pivot-row-Sale")
    expect(within(sale).getByText("Confirmed")).toBeTruthy()
    expect(within(sale).getByText("$30.00")).toBeTruthy()
    expect(within(screen.getByTestId("entity-pivot-total")).getByText("$45.00")).toBeTruthy()
    expect(screen.queryByTestId("entity-pivot-currency-note")).toBeNull()
    expect(screen.getByTestId("entity-pivot-bar-Sale").getAttribute("style")).toContain("100%")

    unmount()
    render(<EntityView config={config} data={rows} />)
    expect(screen.getByTestId("entity-pivot")).toBeTruthy()
  })

  it("notes mixed currencies", () => {
    render(<EntityView config={config} data={[...rows, { ...rows[0], id: 4, currencyId: "EUR" }]} />)
    fireEvent.click(screen.getByRole("button", { name: "Summary" }))
    expect(screen.getByTestId("entity-pivot-currency-note").textContent).toContain("EUR, USD")
  })

  it("is not offered when the config has no pivot", () => {
    render(<EntityView config={withReadOnlyStateBoard(t, base, { groupKey: "state", card: { titleKey: "name" } })} data={rows} />)
    expect(screen.queryByRole("button", { name: "Summary" })).toBeNull()
  })
})
