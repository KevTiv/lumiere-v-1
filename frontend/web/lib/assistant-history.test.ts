import assert from "node:assert/strict"
import test from "node:test"
import { assistantHistoryScope, saveAssistantHistory, scopedAssistantSession } from "./assistant-history"

test("browser conversation keys stay separate by actor, organization and company", () => {
  const data = new Map([["lumiere:erp-ai-chat-session-key", "legacy-unscoped"]])
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  const a = assistantHistoryScope("alice", 7, 12)!
  const b = assistantHistoryScope("bob", 7, 12)!
  const c = assistantHistoryScope("alice", 7, 13)!
  assert.equal(scopedAssistantSession(storage, a, () => "alice-company12"), "alice-company12")
  assert.equal(scopedAssistantSession(storage, a, () => "unused"), "alice-company12")
  assert.equal(scopedAssistantSession(storage, b, () => "bob-company12"), "bob-company12")
  assert.equal(scopedAssistantSession(storage, c, () => "alice-company13"), "alice-company13")
  assert.equal(data.get("lumiere:erp-ai-chat-session-key"), "legacy-unscoped")
  assert.equal(assistantHistoryScope(null, 7, 12), null)
  assert.equal(assistantHistoryScope("alice", 7, null), null)
})

test("history failure leaves the answer owner alone and never replays a partial exchange", async () => {
  const calls: string[] = []
  const result = await saveAssistantHistory({
    ensureSession: async () => { calls.push("session") },
    appendUser: async () => { calls.push("user") },
    appendAssistant: async () => { calls.push("assistant"); throw new Error("offline") },
    isCurrent: () => true,
  })
  assert.equal(result, "failed")
  assert.deepEqual(calls, ["session", "user", "assistant"])
})

test("a failed session does not append messages", async () => {
  let appended = false
  assert.equal(await saveAssistantHistory({
    ensureSession: async () => { throw new Error("denied") },
    appendUser: async () => { appended = true },
    appendAssistant: async () => { appended = true },
    isCurrent: () => true,
  }), "failed")
  assert.equal(appended, false)
})

test("switching actor/company while saving stops the remaining history writes", async () => {
  let current = true
  const calls: string[] = []
  assert.equal(await saveAssistantHistory({
    ensureSession: async () => { calls.push("session") },
    appendUser: async () => { calls.push("user"); current = false },
    appendAssistant: async () => { calls.push("assistant") },
    isCurrent: () => current,
  }), "scope-changed")
  assert.deepEqual(calls, ["session", "user"])
})
