import assert from "node:assert/strict"
import test from "node:test"
import { parseHistoryReferences } from "./history-references"

test("accepts exact references and deduplicates repeated selectors", () => {
  const source = {
    kind: "message",
    sessionKey: "thread-1",
    messageId: "18446744073709551615",
  }
  const decision = {
    kind: "decision",
    sessionKey: "thread-1",
    messageId: "7",
    decisionId: "a".repeat(32),
    revision: 2,
  }
  assert.deepEqual(parseHistoryReferences([source, source, decision]), [
    source,
    decision,
  ])
})

test("rejects context text, malformed IDs and excessive reference counts", () => {
  const source = { kind: "message", sessionKey: "thread-1", messageId: "1" }
  for (const invalid of [
    [{ ...source, excerpt: "untrusted text" }],
    [{ ...source, messageId: "18446744073709551616" }],
    [{ ...source, messageId: "optimistic-turn" }],
    [{ ...source, sessionKey: "../another-thread" }],
    Array.from({ length: 5 }, () => source),
  ])
    assert.throws(
      () => parseHistoryReferences(invalid),
      /valid saved chat references/,
    )
})

test("accepts native import mapping and approval receipt selectors", () => {
  const mapping = {
    kind: "import_mapping",
    sessionKey: "thread-1",
    taskId: "b".repeat(32),
    batchId: "8",
    itemId: "12",
    revision: 2,
  }
  const approval = {
    kind: "approval_receipt",
    taskId: "17",
    eventId: "11",
    revision: "4",
    workScope: "purchasing",
    idempotencyKey: "decision-test",
    inputHash: "sha256:" + "a".repeat(64),
  }
  assert.deepEqual(parseHistoryReferences([mapping, approval]), [
    mapping,
    approval,
  ])
})
