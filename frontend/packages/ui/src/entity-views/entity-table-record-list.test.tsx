import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { EntityTableConfig } from "../lib/entity-view-types"
import { RBACProvider } from "../lib/rbac-context"
import { readRecordListContext } from "../lib/record-list-context"
import { EntityTable } from "./entity-table"

vi.mock("../components/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const config: EntityTableConfig = {
  mode: "table",
  rowKey: "id",
  searchable: true,
  searchKeys: ["name"],
  columns: [
    {
      key: "name",
      label: "Name",
      sortable: true,
      render: (_v, row) => (
        <a href={`/purchasing/orders/${String(row.id)}`} onClick={(e) => e.preventDefault()}>
          {String(row.name)}
        </a>
      ),
    },
  ],
}

const rows = [
  { id: "1", name: "Charlie" },
  { id: "2", name: "Alpha" },
  { id: "3", name: "Bravo" },
]

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

describe("EntityTable record list context", () => {
  it("files the keys in the shown order when a record link is clicked", () => {
    render(
      <RBACProvider>
        <EntityTable config={config} data={rows} />
      </RBACProvider>,
    )
    fireEvent.click(screen.getByText("Name"))
    fireEvent.click(screen.getByText("Alpha"))
    expect(readRecordListContext("/purchasing/orders")).toEqual(["2", "3", "1"])
  })

  it("files only the rows the search leaves", () => {
    render(
      <RBACProvider>
        <EntityTable config={config} data={rows} />
      </RBACProvider>,
    )
    fireEvent.change(screen.getByLabelText("Search records"), { target: { value: "bravo" } })
    fireEvent.click(screen.getByText("Bravo"))
    expect(readRecordListContext("/purchasing/orders")).toEqual(["3"])
  })
})
