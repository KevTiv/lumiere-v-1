import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { canUseModuleData, moduleQueryState } from "./module-data-state"

describe("module query status", () => {
  it("distinguishes a failed empty read from successful empty results", () => {
    const query = { isLoading: false, isError: false, data: [], refetch() {} }
    assert.equal(moduleQueryState(query).status, "ready")
    assert.equal(moduleQueryState({ ...query, isError: true }).status, "error")
  })
  it("labels cached records partial when refresh fails and retries the same query", () => {
    let retries = 0
    const state = moduleQueryState({ isLoading: false, isError: true, error: { status: 503 }, data: [{}], refetch() { retries++ } })
    assert.equal(state.status, "partial")
    if ("onRetry" in state) state.onRetry?.()
    assert.equal(retries, 1)
  })
  it("hides cached records on revoked access or an unclassified failure", () => {
    const query = { isLoading: false, isError: true, data: [{}], refetch() {} }
    assert.equal(moduleQueryState({ ...query, error: { status: 403 } }).status, "denied")
    assert.equal(moduleQueryState({ ...query, error: { status: 401 } }).status, "denied")
    assert.equal(moduleQueryState(query).status, "error")
  })
  it("keeps loading separate from empty results", () => {
    assert.equal(moduleQueryState({ isLoading: true, isError: false, refetch() {} }).status, "loading")
  })
})

it("blocks unavailable cached rows from dialog and join consumers while retaining partial rows", () => {
  assert.equal(canUseModuleData({ status: "denied" }), false)
  assert.equal(canUseModuleData({ status: "error" }), false)
  assert.equal(canUseModuleData({ status: "partial" }), true)
  assert.equal(canUseModuleData({ status: "ready" }), true)
})
