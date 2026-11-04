import assert from "node:assert/strict"
import { describe, it } from "node:test"
import React from "react"
import { inventoryWorkspaceModule } from "../lib/inventory-workspace-navigation"

// The UI package includes legacy classic-JSX modules in its public barrel. The application build
// supplies React for them; mirror that runtime before importing the hook through Node's test runner.
;(globalThis as typeof globalThis & { React: typeof React }).React = React

const { workflowRecordHref } = await import("./use-workflow-surface")

describe("workflowRecordHref", () => {
  const saleOrder = { resource: "sale_order", id: "42", module: "sales" }

  it("builds the canonical filtered route without a presentation permission gate", () => {
    assert.equal(workflowRecordHref(saleOrder), "/sales?tab=orders&filter=id%3A42")
  })

  it("uses the canonical owner for cross-module records", () => {
    assert.equal(
      workflowRecordHref({ resource: "account_move", id: "7", module: "accounting", context: "sales" }),
      "/accounting?tab=journal-entries&filter=id%3A7",
    )
  })

  it("does not navigate an empty or unknown record reference", () => {
    assert.equal(workflowRecordHref({ resource: "sale_order", id: "", module: "sales" }), undefined)
    assert.equal(workflowRecordHref({ resource: "unknown", id: "1", module: "" }), undefined)
  })

  it("keeps alpha stock, picking and product results in their bounded workspaces with exact filters", () => {
    for (const [resource, tab, module] of [
      ["stock_quant", "stock", "warehouse"],
      ["stock_picking", "transfers", "warehouse"],
      ["stock_production_serial", "serials", "warehouse"],
      ["replenishment_rule", "replenishment", "warehouse"],
      ["product", "products", "products"],
    ]) {
      const ref = { resource: resource!, id: "9007199254740993", module: "inventory" }
      assert.equal(workflowRecordHref(ref, "finance-alpha"), `/${module}?tab=${tab}&filter=id%3A9007199254740993`)
      assert.equal(workflowRecordHref(ref, "full"), `/inventory?tab=${tab}&filter=id%3A9007199254740993`)
    }
  })

  it("does not remap excluded Inventory tabs or unrelated Finance owners", () => {
    assert.equal(inventoryWorkspaceModule("finance-alpha", "inventory", "quality"), "inventory")
    assert.equal(workflowRecordHref({ resource: "quality_check", id: "7", module: "inventory" }, "finance-alpha"), undefined)
    assert.equal(workflowRecordHref(saleOrder, "finance-alpha"), "/sales?tab=orders&filter=id%3A42")
  })
})
