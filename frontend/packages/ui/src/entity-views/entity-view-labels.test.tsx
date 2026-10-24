import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { RBACProvider } from "../lib/rbac-context"
import { EntityLabelsProvider, labelsFromOptions } from "../lib/entity-labels-context"
import type { EntityTableConfig } from "../lib/entity-view-types"
import { EntityTable } from "./entity-table"
import { useScopedEntityTableConfig } from "./entity-view"

const config: EntityTableConfig = {
  mode: "table",
  rowKey: "id",
  columns: [
    { key: "name", label: "Name" },
    { key: "partnerId", label: "Partner" },
    { key: "productId", label: "Product", render: () => "custom" },
  ],
}
const rows = [
  { id: 1, name: "A", partnerId: 7n, productId: 1 },
  { id: 2, name: "B", partnerId: "99", productId: 1 },
  { id: 3, name: "C", partnerId: null, productId: 1 },
]

function Table() {
  return <EntityTable config={useScopedEntityTableConfig(config)} data={rows} />
}

afterEach(cleanup)

describe("related-record columns", () => {
  it("shows names for known ids, #id for unknown ones and a dash when empty", () => {
    render(
      <RBACProvider>
        <EntityLabelsProvider value={{ partnerId: labelsFromOptions([{ value: "7", label: "Acme Ltd" }, { value: "", label: "x" }, { value: "8", label: "Hidden", disabled: true }]), productId: new Map([["1", "Widget"]]) }}>
          <Table />
        </EntityLabelsProvider>
      </RBACProvider>,
    )
    expect(screen.getByText("Acme Ltd")).toBeTruthy()
    expect(screen.getByText("#99")).toBeTruthy()
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
    // A column that renders itself is left alone.
    expect(screen.getAllByText("custom").length).toBe(3)
    expect(screen.queryByText("Widget")).toBeNull()
  })

  it("leaves id columns as they were without a provider", () => {
    render(
      <RBACProvider>
        <Table />
      </RBACProvider>,
    )
    expect(screen.getByText("99")).toBeTruthy()
  })
})
