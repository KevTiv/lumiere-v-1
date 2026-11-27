import assert from "node:assert/strict"
import test from "node:test"
import { importReviewCheckpointKey, resolveImportReviewCheckpoint, type ReviewCheckpoint } from "./use-import-review-checkpoint"

const saved: ReviewCheckpoint = {
  reviewId: "42",
  group: "missing:quantity",
  itemId: "9007199254740993",
  itemRevision: 3,
  revision: 9,
}
const row = { id: "9007199254740993", revision: 3, state: "needs_review" }
const groups = [{ key: "missing:quantity", itemIds: [row.id] }]

test("resume restores the exact question even when the row is beyond the first page", () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({ id: String(index + 1), revision: 3, state: "needs_review" }))
  assert.deepEqual(resolveImportReviewCheckpoint(saved, "42", [...rows, row], groups), { group: saved.group, item: row })
  assert.deepEqual(resolveImportReviewCheckpoint({ ...saved, itemId: null, itemRevision: null }, "42", [row], groups),
    { group: saved.group, item: null })
})

test("a moved, resolved, revised or missing issue never reopens an old editor", () => {
  for (const current of [
    { ...row, id: "3" }, { ...row, revision: 4 },
    { ...row, state: "confirmed" }, { ...row, state: "excluded" },
  ]) assert.equal(resolveImportReviewCheckpoint(saved, "42", [current], groups), null)
  assert.equal(resolveImportReviewCheckpoint(saved, "43", [row], groups), null)
  assert.equal(resolveImportReviewCheckpoint(saved, "42", [row], [{ ...groups[0]!, itemIds: [] }]), null)
  assert.equal(resolveImportReviewCheckpoint(saved, "42", [row], []), null)
})

test("checkpoint query keys separate actors, organizations, companies and tasks", () => {
  const scope = { identity: "0xAB", organizationId: 7, companyId: 2 }
  const key = importReviewCheckpointKey(scope, "task")
  assert.deepEqual(importReviewCheckpointKey({ ...scope, identity: "ab" }, "task"), key)
  for (const change of [{ identity: "cd" }, { organizationId: 8 }, { companyId: 3 }])
    assert.notDeepEqual(importReviewCheckpointKey({ ...scope, ...change }, "task"), key)
  assert.notDeepEqual(importReviewCheckpointKey(scope, "other"), key)
})
