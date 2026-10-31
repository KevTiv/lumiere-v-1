import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { i18n } from "@lumiere/i18n"
import { RBACProvider } from "../lib/rbac-context"
import { productDetailConfig, stockLocationDetailConfig, stockLocationsTableConfig } from "../lib/inventory-entity-configs"
import { EntityDetail } from "./entity-detail"

const source = {
  version: 1,
  source_file: "farm, July.csv",
  source_row: 42,
  source_sha256: "b".repeat(64),
  row_basis: "source_line",
  batch_id: "31",
  item_id: "9007199254740993",
  revision: 7,
  decision_reason: "<img src=x onerror=alert(1)> Confirmed the recorded price",
}

afterEach(cleanup)

describe("recorded source in production record details", () => {
  it("shows exact product provenance as text without disclosing other metadata", () => {
    const { container } = render(
      <RBACProvider>
        <EntityDetail config={productDetailConfig(i18n.t)} data={{
          id: "101", name: "Sausage",
          metadata: JSON.stringify({ secret: "unrelated metadata", source_review: source }),
        }} />
      </RBACProvider>,
    )
    const panel = within(screen.getByRole("region", { name: "Recorded import source" }))
    for (const value of [source.source_file, source.source_sha256, source.item_id, source.decision_reason, "42", "31", "7"]) {
      expect(panel.getByText(value, { exact: true })).toBeTruthy()
    }
    expect(panel.getByText("Source line")).toBeTruthy()
    expect(container.querySelector("img")).toBeNull()
    expect(screen.queryByText("unrelated metadata")).toBeNull()
    expect(panel.queryByRole("link")).toBeNull()
  })

  it("labels import rows honestly and removes evidence when current authorized metadata disappears", () => {
    const config = stockLocationDetailConfig(i18n.t)
    const record = { id: "202", name: "Farm store", usage: "internal", active: true }
    const { rerender } = render(
      <RBACProvider>
        <EntityDetail config={config} data={{ ...record, metadata: { some: JSON.stringify({ source_review: { ...source, row_basis: "import_row" } }) } }} />
      </RBACProvider>,
    )
    expect(screen.getByRole("region", { name: "Recorded import source" })).toBeTruthy()
    expect(screen.getByText("Import row")).toBeTruthy()
    expect(screen.queryByText("Source line")).toBeNull()
    rerender(<RBACProvider><EntityDetail config={config} data={record} /></RBACProvider>)
    expect(screen.queryByRole("region", { name: "Recorded import source" })).toBeNull()
    expect(screen.queryByText(source.source_file)).toBeNull()
    rerender(<RBACProvider><EntityDetail config={config} data={{ ...record, metadata: JSON.stringify({ source_review: { ...source, version: 2 } }) }} /></RBACProvider>)
    expect(screen.queryByRole("region", { name: "Recorded import source" })).toBeNull()
  })

  it("keeps imported locations identifiable when no complete location path was recorded", () => {
    const config = stockLocationsTableConfig(i18n.t)
    if (config.view.mode !== "table") throw new Error("location table expected")
    const name = config.view.columns.find((column) => column.key === "completeName")
    expect(name?.render?.(undefined, { id: "202", name: "Farm store" })).toBe("Farm store")
    expect(name?.render?.({ none: [] }, { id: "202", name: "Farm store" })).toBe("Farm store")
    expect(name?.render?.("Farm / Main store", { id: "202", name: "Farm store" })).toBe("Farm / Main store")
  })
})
