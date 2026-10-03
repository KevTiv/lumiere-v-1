import assert from "node:assert/strict"
import test from "node:test"

import { queryBuilderSourceState } from "./query-builder-source-state"

test("keeps an unselected report source distinct from loading", () => {
  assert.equal(queryBuilderSourceState("", false, 0), "unselected")
  assert.equal(queryBuilderSourceState("sale_order", true, 0), "loading")
})

test("reports a successfully loaded empty source truthfully", () => {
  assert.equal(queryBuilderSourceState("sale_order", false, 0), "empty")
  assert.equal(queryBuilderSourceState("sale_order", false, 3), "ready")
})
