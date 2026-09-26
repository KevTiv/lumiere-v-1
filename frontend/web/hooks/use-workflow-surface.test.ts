import assert from "node:assert/strict"
import { describe, it } from "node:test"
import React from "react"

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
})
