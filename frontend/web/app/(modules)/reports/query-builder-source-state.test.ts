import assert from "node:assert/strict"
import test from "node:test"

import { queryBuilderSourceState } from "./query-builder-source-state"

test("keeps an unselected report source distinct from loading", () => {
  assert.equal(queryBuilderSourceState(""), "unselected")
  assert.equal(queryBuilderSourceState("sale_order"), "loading")
})

test("reports ready and empty source states truthfully", () => {
  assert.equal(
    queryBuilderSourceState("sale_order", { status: "empty", rowCount: 0 }),
    "empty",
  )
  assert.equal(
    queryBuilderSourceState("sale_order", { status: "ready", rowCount: 3 }),
    "ready",
  )
})

test("preserves unavailable and partial per-source states", () => {
  assert.equal(
    queryBuilderSourceState("sale_order", { status: "unavailable", rowCount: 0 }),
    "unavailable",
  )
  assert.equal(
    queryBuilderSourceState("sale_order", { status: "partial", rowCount: 3 }),
    "partial",
  )
})

test("reports background readback separately from cached rows", () => {
  assert.equal(
    queryBuilderSourceState("sale_order", { status: "ready", rowCount: 3 }, true),
    "refreshing",
  )
})
