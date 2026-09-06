import assert from "node:assert/strict"
import { test } from "node:test"
import { checkBrowserReady } from "./readiness.mjs"

test("browser readiness checks connectivity and version", async () => {
  let called = false
  await checkBrowserReady(async () => ({
    isConnected: () => true,
    version: async () => { called = true; return "Chrome/1" },
  }))
  assert.equal(called, true)
})

test("browser readiness rejects disconnected browser", async () => {
  await assert.rejects(
    checkBrowserReady(async () => ({ isConnected: () => false, version: async () => "never" })),
    /disconnected/,
  )
})

test("browser readiness rejects a hung browser within the bound", async () => {
  await assert.rejects(
    checkBrowserReady(() => new Promise(() => {}), 10),
    /timeout/,
  )
})
