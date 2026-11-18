import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { assistantHistoryScope, reclassifyWithheldHistoryRow, saveAssistantHistory, scopedAssistantSession } from "./assistant-history"
import { WITHHELD_ANSWER_NOTICE, WITHHELD_VERIFICATION_OUTCOMES } from "../../packages/erp-shared/src/ai-withheld-notice"

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

test("withheld notices and blocked verdicts saved as completed read as failed", () => {
  const notice = `${WITHHELD_ANSWER_NOTICE}: structured answer must identify at least one material claim`
  const old = { id: 1, role: "assistant", status: "completed", content: notice, metadata: null }
  assert.equal(reclassifyWithheldHistoryRow(old).status, "failed")
  assert.equal(old.status, "completed")
  for (const outcome of ["blocked", "requires_review"]) {
    const row = { role: "assistant", status: "completed", content: "text", metadata: JSON.stringify({ answerVerification: { outcome } }) }
    assert.equal(reclassifyWithheldHistoryRow(row).status, "failed", outcome)
  }
})

test("released answers, user messages and unreadable metadata keep their status", () => {
  const admitted = { role: "assistant", status: "completed", content: "Stock is 4", metadata: JSON.stringify({ answerVerification: { outcome: "admitted" } }) }
  assert.equal(reclassifyWithheldHistoryRow(admitted), admitted)
  const user = { role: "user", status: "completed", content: `${WITHHELD_ANSWER_NOTICE}.`, metadata: null }
  assert.equal(reclassifyWithheldHistoryRow(user), user)
  const broken = { role: "assistant", status: "completed", content: "ok", metadata: "{nope" }
  assert.equal(reclassifyWithheldHistoryRow(broken), broken)
})

test("TypeScript withheld constants mirror the Rust gate source of truth", () => {
  const rust = readFileSync(new URL("../../../crates/policy-core/src/withheld_answer.rs", import.meta.url), "utf8")
  assert.ok(rust.includes(`WITHHELD_ANSWER_NOTICE: &str = "${WITHHELD_ANSWER_NOTICE}"`))
  assert.ok(rust.includes(`WITHHELD_VERIFICATION_OUTCOMES: [&str; 2] = [${WITHHELD_VERIFICATION_OUTCOMES.map(o => `"${o}"`).join(", ")}]`))
})
