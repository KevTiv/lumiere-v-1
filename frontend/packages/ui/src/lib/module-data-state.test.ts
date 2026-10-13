import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { canUseModuleData, mergeModuleStates, moduleCollection, moduleQueryState } from "./module-data-state"

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

describe("module collection helpers", () => {
  it("returns rows only while the collection is usable", () => {
    const query = { isLoading: false, isError: false, data: [1, 2], refetch() {} }
    assert.deepEqual(moduleCollection(query).rows, [1, 2])
    assert.deepEqual(moduleCollection({ ...query, isError: true, error: { status: 403 } }).rows, [])
    assert.deepEqual(moduleCollection({ ...query, isError: true }).rows, [])
    assert.equal(moduleCollection({ ...query, isError: true }).rows, moduleCollection({ ...query, isError: true }).rows)
    const partial = moduleCollection({ ...query, isError: true, error: { status: 503 } })
    assert.equal(partial.state.status, "partial")
    assert.deepEqual(partial.rows, [1, 2])
  })
  it("merges composed views: denial wins, failures retry every failed read", () => {
    let retries = 0
    const retry = () => { retries++ }
    assert.equal(mergeModuleStates([{ status: "ready" }, { status: "denied" }, { status: "error", onRetry: retry }]).status, "denied")
    const failed = mergeModuleStates([{ status: "partial", onRetry: retry }, { status: "loading" }, { status: "error", onRetry: retry }])
    assert.equal(failed.status, "error")
    if ("onRetry" in failed) failed.onRetry?.()
    assert.equal(retries, 2)
    assert.equal(mergeModuleStates([{ status: "ready" }, { status: "loading" }]).status, "loading")
    assert.equal(mergeModuleStates([]).status, "ready")
  })
})
